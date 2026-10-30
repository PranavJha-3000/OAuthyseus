import Anthropic from "@anthropic-ai/sdk";
import type { Guide, InvestigationEvent, InvestigationRecord, PhaseStatus, ProbeResult, Source } from "../types";
import { GuideDraftSchema, guideDraftJsonSchema, type GuideDraft } from "../schema";
import { probeAuthorize, probeDiscovery, probePage } from "./probes";
import { ground } from "./ground";

export const MODEL = "claude-opus-5-5";

type Emit = (e: InvestigationEvent) => void;

const PHASES = [
  { id: "discover", label: "Find the official developer docs" },
  { id: "register", label: "Work out how an OAuth app is registered" },
  { id: "review", label: "Check review, verification and launch limits" },
  { id: "probe", label: "Test the live console and OAuth endpoints" },
  { id: "write", label: "Write the guide" },
  { id: "ground", label: "Check every quote against its source" },
] as const;
type PhaseId = (typeof PHASES)[number]["id"];

const SYSTEM = `You are OAuthyseus, a research agent that tells developers building AI agents what it really takes to register an OAuth app with a provider and get it approved so that their end users can connect accounts.

You are given an app name or website. Investigate it from scratch, then call submit_guide exactly once.

How to investigate (be efficient: roughly 6 searches and 8 page fetches is enough; the developer is watching live):
1. Identify the provider's official developer documentation. Prefer official domains over blogs.
2. Find how a third-party developer registers an OAuth app/client: where (console URL), what fields, redirect URI rules, scopes, credentials, token lifetime/refresh.
3. Find what is needed to let *other people's* accounts connect: app review, verification, marketplace listing, security assessment, partner program, paid plan, install caps, admin consent. Find timelines if published. If the provider does not support third-party OAuth at all (API keys only, partner-only), say so plainly: that is a valid and valuable finding.
4. Test what you can without credentials, using the probe tools:
   - probe_console on the developer console / app-registration URL (shows whether it exists and that it sits behind login),
   - probe_oidc_discovery on the identity issuer if the provider might support OpenID Connect,
   - probe_authorize on the OAuth authorize endpoint (a fake client_id shows the endpoint is live).
   Call independent probes in parallel in one turn. Each probe result has an id (p1, p2, ...) you can cite as a source.
5. Call submit_guide with the complete guide.

Evidence rules (these are checked mechanically, so follow them exactly):
- level "tested": only for facts established by a probe; cite the probe id (p1...).
- level "documented": stated on an official page you actually fetched. Put a verbatim quote of at most 15 words, copied character-for-character from that page, in "quote", and cite that page's source id first. Quotes that cannot be found in the fetched page are downgraded automatically.
- level "inferred": your reasoning from evidence; explain in "note".
- level "unverified": community reports or things you could not confirm; explain in "note".
- Never invent approval times. If none is published, use approvalWait null or a range marked unverified, and list it in uncertainties.
- Steps must use the provider's real UI labels (button and menu text) and include at least one official link. Add "pointer" for steps done in a web console: urlPattern is a JavaScript regex for the console page, startUrl where to go, targets are exact visible labels to click/fill.
- actor: "agent" when an AI agent could do the step unattended (drafting a privacy policy, writing scope justifications, generating a demo-video script, writing code); "you" when it needs the developer's login, legal attestation, payment, identity verification; "both" when an agent can prepare and the developer submits.
- Difficulty: easy (self-serve, no review, under ~1 hour), moderate (some review or setup friction, days), hard (formal verification/security assessment, weeks), gated (paywall, partnership, invite-only, or no third-party OAuth).
- Paths: describe 2-4 distinct launch scenarios (e.g. testing only, public basic scopes, public sensitive scopes, marketplace) with their own time/approval.
- Write for a developer who will act on this today. Be concrete, short, and honest about what you could not verify.`;

const PROBE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "probe_console",
    description: "Load a developer console / app registration URL without credentials and report whether it exists and where it redirects (e.g. to a login page).",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "probe_oidc_discovery",
    description: "Fetch the OpenID Connect discovery document for an issuer (e.g. https://accounts.example.com) and report endpoints, PKCE support and scopes.",
    input_schema: { type: "object", properties: { issuer: { type: "string" } }, required: ["issuer"] },
  },
  {
    name: "probe_authorize",
    description: "Send one GET to an OAuth authorize endpoint with a fake client_id and report how it responds. Proves the endpoint is live.",
    input_schema: { type: "object", properties: { authorize_url: { type: "string" } }, required: ["authorize_url"] },
  },
  {
    name: "probe_page",
    description: "Check that a documentation page URL loads and get its title.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_guide",
  description: "Submit the finished setup guide. Call exactly once, after investigating.",
  input_schema: guideDraftJsonSchema() as Anthropic.Beta.BetaTool["input_schema"],
  eager_input_streaming: true,
};

type FetchedPage = { url: string; title: string; text: string };

function normUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export async function runInvestigation(query: string, emit: Emit, signal?: AbortSignal): Promise<Guide> {
  const client = new Anthropic();
  const startedAt = new Date().toISOString();
  const searches: string[] = [];
  const fetched = new Map<string, FetchedPage>();
  const probes: Array<ProbeResult & { id: string }> = [];
  const phaseState = new Map<PhaseId, { status: PhaseStatus; detail: string }>(PHASES.map((p) => [p.id, { status: "pending", detail: "" }]));

  const setPhase = (id: PhaseId, status: PhaseStatus, detail = "") => {
    const cur = phaseState.get(id)!;
    if (cur.status === status && !detail) return;
    phaseState.set(id, { status, detail: detail || cur.detail });
    emit({ type: "phase", id, label: PHASES.find((p) => p.id === id)!.label, status, detail: detail || cur.detail });
  };
  // Phases are inferred from what the agent is actually doing, in order.
  const advanceTo = (id: PhaseId) => {
    const idx = PHASES.findIndex((p) => p.id === id);
    PHASES.forEach((p, i) => {
      const st = phaseState.get(p.id)!.status;
      if (i < idx && (st === "pending" || st === "running")) setPhase(p.id, "done");
    });
    if (phaseState.get(id)!.status === "pending") setPhase(id, "running");
  };

  PHASES.forEach((p) => emit({ type: "phase", id: p.id, label: p.label, status: "pending" }));
  advanceTo("discover");

  const REVIEW_WORDS = /(review|verif|approv|marketplace|listing|security|assessment|partner|publish|distribut|certif|pricing|tier|consent)/i;
  const noteActivity = (text: string) => {
    if (REVIEW_WORDS.test(text) && phaseState.get("register")!.status !== "pending") advanceTo("review");
  };

  const handleBlock = (block: Anthropic.Beta.BetaContentBlock) => {
    switch (block.type) {
      case "server_tool_use": {
        const input = block.input as { query?: string; url?: string };
        if (block.name === "web_search" && input.query) {
          searches.push(input.query);
          emit({ type: "search", query: input.query });
          noteActivity(input.query);
        } else if (block.name === "web_fetch" && input.url) {
          emit({ type: "read", url: input.url });
          if (phaseState.get("discover")!.status === "running") advanceTo("register");
          noteActivity(input.url);
        }
        break;
      }
      case "web_fetch_tool_result": {
        const content = block.content as unknown as {
          type?: string;
          url?: string;
          content?: { title?: string; source?: { data?: string; type?: string } };
        };
        if (content?.type === "web_fetch_result" && content.url) {
          const data = content.content?.source?.type === "text" ? (content.content.source.data ?? "") : "";
          fetched.set(normUrl(content.url), { url: content.url, title: content.content?.title ?? content.url, text: data });
          if (content.content?.title) emit({ type: "read", url: content.url, title: content.content.title });
        }
        break;
      }
      case "thinking": {
        const t = (block.thinking ?? "").trim();
        if (t) emit({ type: "note", text: t.length > 400 ? `${t.slice(0, 400)}…` : t });
        break;
      }
      case "text": {
        const t = block.text.trim();
        if (t) emit({ type: "note", text: t.length > 400 ? `${t.slice(0, 400)}…` : t });
        break;
      }
    }
  };

  const runProbe = async (name: string, input: Record<string, string>): Promise<ProbeResult & { id: string }> => {
    advanceTo("probe");
    let r: ProbeResult;
    if (name === "probe_console") r = await probePage(input.url, "console");
    else if (name === "probe_oidc_discovery") r = await probeDiscovery(input.issuer);
    else if (name === "probe_authorize") r = await probeAuthorize(input.authorize_url);
    else r = await probePage(input.url, "page");
    const withId = { ...r, id: `p${probes.length + 1}` };
    probes.push(withId);
    emit({ type: "probe", probe: r });
    return withId;
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Investigate the OAuth app setup and approval process for: ${query}` },
  ];

  let draft: GuideDraft | null = null;
  let nudges = 0;
  let jsonRetries = 0;

  for (let iter = 0; iter < 16 && !draft; iter++) {
    if (signal?.aborted) throw new Error("Investigation cancelled.");
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        system: SYSTEM,
        cache_control: { type: "ephemeral" },
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "medium" },
        betas: ["thinking-display-updates-2026-08-18", "server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10, max_content_tokens: 30000 },
          ...PROBE_TOOLS,
          SUBMIT_TOOL,
        ],
        messages,
      },
      { signal },
    );
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use" && ev.content_block.name === "submit_guide") {
        advanceTo("write");
        emit({ type: "note", text: "Writing the guide from what was found…" });
      }
    });
    stream.on("contentBlock", handleBlock);

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      emit({ type: "note", text: "The guide came back malformed; asking the agent to resend it." });
      continue;
    }

    if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "max_tokens") throw new Error("The guide was too long to finish in one response.");

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: message.content });

    if (toolUses.length === 0) {
      if (nudges++ >= 2) break;
      messages.push({ role: "user", content: "Please call submit_guide now with the complete guide." });
      continue;
    }

    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        if (tu.name === "submit_guide") {
          const parsed = GuideDraftSchema.safeParse(tu.input);
          if (parsed.success) {
            draft = parsed.data;
            return { type: "tool_result", tool_use_id: tu.id, content: "Guide accepted." };
          }
          const issues = parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
          emit({ type: "note", text: "Guide failed schema validation; the agent is fixing it." });
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Schema validation failed. Fix these and call submit_guide again:\n${issues}` };
        }
        const probe = await runProbe(tu.name, tu.input as Record<string, string>);
        return { type: "tool_result", tool_use_id: tu.id, content: `${probe.id}: ${probe.summary} (HTTP ${probe.status ?? "n/a"})` };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  if (!draft) throw new Error("The agent stopped without producing a guide.");
  const finalDraft: GuideDraft = draft;

  if (probes.length === 0) setPhase("probe", "skipped", "No endpoints were probed.");
  else setPhase("probe", probes.some((p) => p.ok) ? "done" : "partial", `${probes.filter((p) => p.ok).length} of ${probes.length} probes succeeded.`);
  setPhase("write", "done");
  setPhase("ground", "running");

  const today = new Date().toISOString().slice(0, 10);
  const probeSources: Source[] = probes.map((p) => ({
    id: p.id,
    title: `Live probe: ${p.summary.slice(0, 90)}`,
    url: p.url,
    kind: "probe",
    accessed: today,
  }));
  const modelSources: Source[] = finalDraft.sources
    .filter((s) => !/^p\d+$/.test(s.id))
    .map((s) => ({ ...s, accessed: today }));

  const id = `${finalDraft.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
  const guide: Guide = {
    schemaVersion: 1,
    ...finalDraft,
    slug: id,
    origin: "agent",
    updatedAt: today,
    sources: [...modelSources, ...probeSources],
    verificationLog: [],
  };

  const grounding = ground(guide, fetched);
  setPhase(
    "ground",
    grounding.downgraded > 0 ? "partial" : "done",
    `${grounding.quotesFound} of ${grounding.quotesChecked} quotes found verbatim; ${grounding.downgraded} claims downgraded.`,
  );

  guide.verificationLog = [
    ...probes.map((p) => ({
      date: today,
      check: `${p.kind === "console" ? "Developer console" : p.kind === "oidc-discovery" ? "OIDC discovery" : p.kind === "authorize-endpoint" ? "Authorize endpoint" : "Page"}: ${p.url}`,
      method: "http-probe" as const,
      result: p.ok ? ("confirmed" as const) : ("unverifiable" as const),
      detail: p.summary,
    })),
    {
      date: today,
      check: "Quotes checked against the pages the agent fetched",
      method: "doc-review",
      result: grounding.downgraded > 0 ? "corrected" : "confirmed",
      detail:
        grounding.downgraded > 0
          ? `${grounding.downgraded} claim(s) cited a quote that does not appear in the fetched source and were downgraded from "documented" to "inferred".`
          : `All ${grounding.quotesFound} quotes appear verbatim in their sources.`,
    },
  ];

  const record: InvestigationRecord = {
    id,
    query,
    startedAt,
    finishedAt: new Date().toISOString(),
    model: MODEL,
    searches,
    pagesRead: [...fetched.values()].map((p) => p.url),
    probes,
    phases: PHASES.map((p) => ({ id: p.id, label: p.label, ...phaseState.get(p.id)! })),
    grounding,
  };
  guide.investigation = record;
  return guide;
}
