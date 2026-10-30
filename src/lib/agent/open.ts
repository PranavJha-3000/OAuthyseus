import type { Guide, ProbeResult } from "../types";
import { GuideDraftSchema, type GuideDraft } from "../schema";
import { chat, pickResponsiveModel, resolveModel, type ChatMessage, type ChatTool, type LlmConfig } from "../llm";
import { probeAuthorize, probeDiscovery, probePage } from "./probes";
import { excerpt, fetchPage, webSearch } from "./web";
import { createTracker, finalizeGuide, normUrl, RULES, type Emit, type FetchedText } from "./common";

// Provider-neutral engine for free-tier models (Gemini, Groq, OpenRouter...).
// Phase 1: a tool-calling research loop with our own search, page reader and probes.
// Phase 2: a separate JSON-mode call that writes the guide from the gathered evidence.
// (Gemini rejects tool calling and JSON mode in the same request, so the phases are split.)

type OpenCfg = Extract<LlmConfig, { kind: "openai" }>;

const RESEARCH_SYSTEM = `You are OAuthseus, a research agent that finds out what it really takes for a developer to register an OAuth app with a provider and get it approved so that their end users can connect their accounts to the developer's AI agent.

Investigate the app you are given from scratch using the tools. Work efficiently but thoroughly: about 4-6 searches and 5-8 page reads (read at least 4 official pages before finishing: app registration, scopes/permissions, tokens/refresh, and any app review, marketplace, partner or publishing page). The developer is watching live.
1. web_search for the official developer docs, then fetch_page the most relevant official pages. Use "focus" terms (e.g. ["redirect", "scope", "review"]) on long pages.
2. Find: where and how an OAuth app/client is registered (console URL, fields, redirect URI rules, scopes, credentials, token lifetime/refresh).
3. Find: what is required before other people's accounts can connect (app review, verification, marketplace listing, security assessment, partner program, paid plan, install caps, admin consent) and any published timelines.
4. Probe what you can without credentials: probe_console on the app registration URL, probe_oidc_discovery on the issuer if it might support OpenID Connect, probe_authorize on the OAuth authorize endpoint. You may call several tools at once.
5. When you have enough, call finish_research with concise notes: key facts, each tagged with the source id (s1, s2... from fetch_page results, p1, p2... from probes) and, for important facts, a short verbatim quote copied exactly from the page.
Prefer official provider domains. If the provider has no third-party OAuth, say so; that is a valid finding.`;

const TOOLS: ChatTool[] = [
  { type: "function", function: { name: "web_search", description: "Search the web. Returns titles, URLs and snippets.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description: "Read a web page as text. Returns a source id (s1, s2...) to cite. For long pages pass focus terms to get the relevant passages.",
      parameters: { type: "object", properties: { url: { type: "string" }, focus: { type: "array", items: { type: "string" } } }, required: ["url"] },
    },
  },
  { type: "function", function: { name: "probe_console", description: "Load a developer console / app registration URL without credentials; reports whether it exists and whether it redirects to sign-in.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "probe_oidc_discovery", description: "Fetch the OpenID Connect discovery document for an issuer URL (e.g. https://accounts.example.com).", parameters: { type: "object", properties: { issuer: { type: "string" } }, required: ["issuer"] } } },
  { type: "function", function: { name: "probe_authorize", description: "Send one GET to an OAuth authorize endpoint with a fake client_id to show it is live.", parameters: { type: "object", properties: { authorize_url: { type: "string" } }, required: ["authorize_url"] } } },
  { type: "function", function: { name: "finish_research", description: "Stop researching and hand over your notes.", parameters: { type: "object", properties: { notes: { type: "string" } }, required: ["notes"] } } },
];

const GUIDE_TYPE = `{
  slug: string; name: string; website: string; category: string; brandColor: string /* hex */;
  summary: string /* 2-3 sentence bottom line */;
  verdict: { difficulty: "easy"|"moderate"|"hard"|"gated"; headline: string; rationale: string; evidence: Evidence };
  effort: { activeTime: Duration; approvalRequired: "no"|"conditional"|"yes"; approvalWait: Duration|null; approvalNote: string; evidence: Evidence };
  paths: Array<{ id: string; name: string; when: string; difficulty: "easy"|"moderate"|"hard"|"gated"; activeTime: Duration; approvalWait: Duration|null; whatChanges: string; evidence: Evidence }>;
  appModel: { providerTerm: string; explanation: string /* how one provider app relates to your product and each end-user connection */; tokenNotes: string; evidence: Evidence };
  requirements: Array<{ item: string; detail: string; neededFor: string[] /* path ids, [] = all */; evidence: Evidence }>;
  steps: Array<{ id: string; title: string; actor: "you"|"agent"|"both"; actorNote: string; duration: Duration; pathIds: string[]; instructions: string[];
    values?: Array<{ field: string; value: string; note?: string }>; links: Array<{ label: string; url: string }>;
    pointer?: { urlPattern: string; startUrl: string; targets: Array<{ text: string; kind: "button"|"link"|"field"|"tab"|"menu"|"any"; hint: string }> };
    evidence: Evidence }>;
  blockers: Array<{ title: string; symptom: string; fix: string; severity: "low"|"medium"|"high"; evidence: Evidence }>;
  agentCan: string[]; youMust: string[]; nextActions: string[] /* first 3-5 things to do now */; uncertainties: string[];
  sources: Array<{ id: string /* use the s# ids given */; title: string; url: string; kind: "official-docs"|"official-policy"|"official-blog"|"community"|"probe" }>;
}
type Duration = { min: number; max: number; unit: "minutes"|"hours"|"days"|"weeks" };
type Evidence = { level: "tested"|"documented"|"inferred"|"unverified"; sources: string[] /* s# or p# ids */; quote?: string /* verbatim, <= 15 words */; note?: string };`;

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return JSON.parse(start >= 0 ? body.slice(start, end + 1) : body);
}

export async function runOpenInvestigation(cfg: OpenCfg, query: string, emit: Emit, signal?: AbortSignal): Promise<Guide> {
  const startedAt = new Date().toISOString();
  emit({ type: "note", text: `Checking which ${cfg.label} models are responding…` });
  const model = (await pickResponsiveModel(cfg)) ?? (await resolveModel(cfg));
  emit({ type: "note", text: `Using ${cfg.label} (${model}).` });
  const tracker = createTracker(emit);
  const searches: string[] = [];
  const fetched = new Map<string, FetchedText>();
  const sourceIds = new Map<string, string>(); // normUrl -> s#
  const probes: Array<ProbeResult & { id: string }> = [];
  const snippets: string[] = [];
  let usedModel = model;
  const llmOpts = {
    signal,
    onWait: (s: number) => emit({ type: "note", text: `Free-tier rate limit reached; waiting ${s}s before continuing.` }),
    onSwitch: (from: string, to: string, why: string) => emit({ type: "note", text: `${from} is ${why}; switching to ${to}.` }),
  };

  const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (name === "web_search") {
      const q = String(args.query ?? "").slice(0, 200);
      // Weaker models can loop on searching; make them read what they found.
      if (searches.length >= 10 || (searches.length >= 5 && fetched.size === 0)) {
        return "Search budget used. Call fetch_page on the most relevant official URLs from the results you already have.";
      }
      searches.push(q);
      emit({ type: "search", query: q });
      tracker.onSearch(q);
      const { engine, results } = await webSearch(q);
      if (results.length === 0) return "No results (search engines unavailable). Try fetch_page on a likely docs URL.";
      results.slice(0, 5).forEach((r) => snippets.push(`- ${r.title} (${r.url}): ${r.snippet}`));
      return `Results (${engine}):\n` + results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
    }
    if (name === "fetch_page") {
      const url = String(args.url ?? "");
      emit({ type: "read", url });
      tracker.onRead(url);
      try {
        const page = await fetchPage(url);
        const key = normUrl(page.url);
        if (!fetched.has(key)) fetched.set(key, { url: page.url, title: page.title, text: page.text });
        if (!sourceIds.has(key)) sourceIds.set(key, `s${sourceIds.size + 1}`);
        emit({ type: "read", url: page.url, title: page.title });
        const focus = Array.isArray(args.focus) ? (args.focus as unknown[]).map(String) : undefined;
        return `Source id: ${sourceIds.get(key)}\nTitle: ${page.title}\nURL: ${page.url}\n\n${excerpt(page, focus)}`;
      } catch (err) {
        return `Could not read ${url}: ${(err as Error).message}`;
      }
    }
    if (name === "probe_console" || name === "probe_oidc_discovery" || name === "probe_authorize") {
      tracker.advanceTo("probe");
      const r =
        name === "probe_console"
          ? await probePage(String(args.url ?? ""), "console")
          : name === "probe_oidc_discovery"
            ? await probeDiscovery(String(args.issuer ?? ""))
            : await probeAuthorize(String(args.authorize_url ?? ""));
      const withId = { ...r, id: `p${probes.length + 1}` };
      probes.push(withId);
      emit({ type: "probe", probe: r });
      return `Probe id: ${withId.id}\n${r.summary} (HTTP ${r.status ?? "n/a"})`;
    }
    return `Unknown tool ${name}.`;
  };

  // ---- Phase 1: research loop ----
  // Free tiers allow only a few requests a minute, so the code runs the obvious first search itself.
  const seed = await runTool("web_search", { query: `${query} OAuth app developer documentation` });
  const messages: ChatMessage[] = [
    { role: "system", content: RESEARCH_SYSTEM },
    {
      role: "user",
      content: `Investigate the OAuth app setup and approval process for: ${query}\n\nA first search has already been run for you:\n${seed}\n\nEach turn, call several tools at once (for example 2-4 fetch_page calls on the most relevant official pages) so the research finishes in a few turns.`,
    },
  ];
  let notes = "";
  for (let turn = 0; turn < 12; turn++) {
    if (signal?.aborted) throw new Error("Investigation cancelled.");
    if (turn === 8) messages.push({ role: "user", content: "Time is nearly up. Run any probes you still need, then call finish_research with your notes." });
    const { message, model: m } = await chat(cfg, { messages, tools: TOOLS, maxTokens: 8000, effort: "low", timeoutMs: 45_000 }, llmOpts);
    usedModel = m;
    messages.push(message);
    if (message.content && typeof message.content === "string" && message.content.trim()) {
      const t = message.content.trim();
      emit({ type: "note", text: t.length > 400 ? `${t.slice(0, 400)}…` : t });
    }
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      notes = typeof message.content === "string" ? message.content : "";
      break;
    }
    const finish = calls.find((c) => c.function.name === "finish_research");
    const results = await Promise.all(
      calls.map(async (c) => {
        const content = c.function.name === "finish_research" ? "Noted." : await runTool(c.function.name, parseArgs(c.function.arguments));
        return { role: "tool" as const, tool_call_id: c.id, content };
      }),
    );
    messages.push(...results);
    if (finish) {
      notes = String(parseArgs(finish.function.arguments).notes ?? "");
      break;
    }
  }

  // ---- Phase 2: write the guide in JSON mode from the gathered evidence ----
  tracker.advanceTo("write");
  const writer = await pickResponsiveModel(cfg, { fullOnly: true });
  emit({ type: "note", text: `Writing the guide from what was found${writer ? ` (${writer})` : ""}…` });
  const evidence = [...sourceIds.entries()]
    .map(([key, id]) => {
      const p = fetched.get(key)!;
      return `### ${id}: ${p.title}\nURL: ${p.url}\n${excerpt({ ...p, via: "direct" }, ["oauth", "redirect", "scope", "review", "verif", "approv", "client", "token", "publish", "marketplace", "install"], 6000)}`;
    })
    .join("\n\n");
  const probeText = probes.map((p) => `- ${p.id} (${p.kind}) ${p.url}: ${p.summary}`).join("\n") || "(none)";

  const writeMessages: ChatMessage[] = [
    {
      role: "system",
      content: `You write OAuth app setup guides for developers building AI agents. Output a single JSON object that matches this TypeScript type exactly:\n${GUIDE_TYPE}\n\n${RULES}\n\nOnly cite source ids that appear in the evidence below. Quotes must be copied character-for-character from the source text shown.

Completeness (a developer must be able to follow this without other docs):
- 6-12 steps covering: developer account/sign-in, creating the app, redirect URIs, scopes, credentials and secret storage, implementing the authorization-code flow (PKCE, state, token exchange, refresh), testing with a real account, and any publishing/review/marketplace/verification step. Each step has 2-6 concrete instructions using the provider's UI labels.
- 3-6 blockers a developer is likely to hit (redirect URI mismatch, scope or plan restrictions, admin approval, review rejection, rate limits, token expiry), each with symptom and fix.
- 2-4 paths, 4-8 requirements, 3-6 agentCan, 3-6 youMust, 3-5 nextActions, and honest uncertainties (at least 2: what could not be confirmed).`,
    },
    {
      role: "user",
      content: `App investigated: ${query}\n\nResearch notes:\n${notes || "(none)"}\n\nProbe results:\n${probeText}\n\nSearch snippets (NOT sources: never quote them; facts known only from these must be marked inferred or unverified):\n${snippets.slice(0, 30).join("\n") || "(none)"}\n\nSource pages (excerpts):\n${evidence || "(no pages could be read)"}\n\nWrite the guide JSON now.`,
    },
  ];

  let draft: GuideDraft | null = null;
  for (let attempt = 0; attempt < 3 && !draft; attempt++) {
    const { message, finishReason, model: m } = await chat(cfg, { messages: writeMessages, json: true, maxTokens: 32000, effort: "medium", timeoutMs: 150_000, avoidLite: true }, llmOpts);
    usedModel = m;
    const text = typeof message.content === "string" ? message.content : "";
    let issues: string;
    try {
      const parsed = GuideDraftSchema.safeParse(extractJson(text));
      if (parsed.success) {
        draft = parsed.data;
        break;
      }
      issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    } catch (err) {
      issues = finishReason === "length" ? "The JSON was cut off. Be more concise: shorter instructions, at most 10 steps." : `Invalid JSON: ${(err as Error).message}`;
    }
    emit({ type: "note", text: "Guide failed validation; asking the model to fix it." });
    writeMessages.push({ role: "assistant", content: text.slice(0, 60000) }, { role: "user", content: `Fix these problems and output the complete corrected JSON object:\n${issues}` });
  }
  if (!draft) throw new Error("The model could not produce a valid guide after 3 attempts.");

  return finalizeGuide({ draft, query, model: `${cfg.label} ${usedModel}`, startedAt, searches, fetched, probes, tracker, sourceIdsForFetched: sourceIds });
}
