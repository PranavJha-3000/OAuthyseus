import Anthropic from "@anthropic-ai/sdk";
import type { Guide, ProbeResult } from "../types";
import { GuideDraftSchema, guideDraftJsonSchema, type GuideDraft } from "../schema";
import { probeAuthorize, probeDiscovery, probePage } from "./probes";
import { createTracker, finalizeGuide, normUrl, RULES, type Emit, type FetchedText } from "./common";

// Claude engine: server-side web_search/web_fetch plus our probe tools and a validated submit_guide tool.

export const CLAUDE_MODEL = "claude-opus-5-5";

const SYSTEM = `You are OAuthseus, a research agent that tells developers building AI agents what it really takes to register an OAuth app with a provider and get it approved so that their end users can connect accounts.

You are given an app name or website. Investigate it from scratch, then call submit_guide exactly once.

How to investigate (roughly 6 searches and 8 page fetches is enough; the developer is watching live):
1. Identify the provider's official developer documentation.
2. Find how a third-party developer registers an OAuth app: console URL, fields, redirect URI rules, scopes, credentials, token lifetime and refresh.
3. Find what is needed to let other people's accounts connect: app review, verification, marketplace listing, security assessment, partner program, paid plan, install caps, admin consent, and published timelines.
4. Test what you can without credentials, in parallel: probe_console on the app-registration URL, probe_oidc_discovery on the issuer if OIDC is plausible, probe_authorize on the authorize endpoint. Each probe result has an id (p1, p2...) you can cite.
5. Call submit_guide with the complete guide.

${RULES}`;

const PROBE_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "probe_console", description: "Load a developer console / app registration URL without credentials and report whether it exists and where it redirects.", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "probe_oidc_discovery", description: "Fetch the OpenID Connect discovery document for an issuer and report endpoints, PKCE support and scopes.", input_schema: { type: "object", properties: { issuer: { type: "string" } }, required: ["issuer"] } },
  { name: "probe_authorize", description: "Send one GET to an OAuth authorize endpoint with a fake client_id and report how it responds.", input_schema: { type: "object", properties: { authorize_url: { type: "string" } }, required: ["authorize_url"] } },
];

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_guide",
  description: "Submit the finished setup guide. Call exactly once, after investigating.",
  input_schema: guideDraftJsonSchema() as Anthropic.Beta.BetaTool["input_schema"],
  eager_input_streaming: true,
};

export async function runClaudeInvestigation(query: string, emit: Emit, signal?: AbortSignal): Promise<Guide> {
  const client = new Anthropic();
  const startedAt = new Date().toISOString();
  const tracker = createTracker(emit);
  const searches: string[] = [];
  const fetched = new Map<string, FetchedText>();
  const probes: Array<ProbeResult & { id: string }> = [];
  const short = (t: string) => (t.length > 400 ? `${t.slice(0, 400)}…` : t);

  const handleBlock = (block: Anthropic.Beta.BetaContentBlock) => {
    if (block.type === "server_tool_use") {
      const input = block.input as { query?: string; url?: string };
      if (block.name === "web_search" && input.query) {
        searches.push(input.query);
        emit({ type: "search", query: input.query });
        tracker.onSearch(input.query);
      } else if (block.name === "web_fetch" && input.url) {
        emit({ type: "read", url: input.url });
        tracker.onRead(input.url);
      }
    } else if (block.type === "web_fetch_tool_result") {
      const c = block.content as unknown as { type?: string; url?: string; content?: { title?: string; source?: { data?: string; type?: string } } };
      if (c?.type === "web_fetch_result" && c.url) {
        const data = c.content?.source?.type === "text" ? (c.content.source.data ?? "") : "";
        fetched.set(normUrl(c.url), { url: c.url, title: c.content?.title ?? c.url, text: data });
      }
    } else if (block.type === "thinking" && block.thinking?.trim()) {
      emit({ type: "note", text: short(block.thinking.trim()) });
    } else if (block.type === "text" && block.text.trim()) {
      emit({ type: "note", text: short(block.text.trim()) });
    }
  };

  const runProbe = async (name: string, input: Record<string, string>) => {
    tracker.advanceTo("probe");
    const r =
      name === "probe_console" ? await probePage(input.url, "console") : name === "probe_oidc_discovery" ? await probeDiscovery(input.issuer) : await probeAuthorize(input.authorize_url);
    const withId = { ...r, id: `p${probes.length + 1}` };
    probes.push(withId);
    emit({ type: "probe", probe: r });
    return withId;
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `Investigate the OAuth app setup and approval process for: ${query}` }];
  let draft: GuideDraft | null = null;
  let nudges = 0;
  let jsonRetries = 0;

  for (let iter = 0; iter < 16 && !draft; iter++) {
    if (signal?.aborted) throw new Error("Investigation cancelled.");
    const stream = client.beta.messages.stream(
      {
        model: CLAUDE_MODEL,
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
        tracker.advanceTo("write");
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
  return finalizeGuide({ draft, query, model: CLAUDE_MODEL, startedAt, searches, fetched, probes, tracker });
}
