import type { Guide, InvestigationEvent, InvestigationRecord, PhaseStatus, ProbeResult, Source } from "../types";
import type { GuideDraft } from "../schema";
import { ground } from "./ground";

export type Emit = (e: InvestigationEvent) => void;
export type FetchedText = { url: string; title: string; text: string };

export const PHASES = [
  { id: "discover", label: "Find the official developer docs" },
  { id: "register", label: "Work out how an OAuth app is registered" },
  { id: "review", label: "Check review, verification and launch limits" },
  { id: "probe", label: "Test the live console and OAuth endpoints" },
  { id: "write", label: "Write the guide" },
  { id: "ground", label: "Check every quote against its source" },
] as const;
export type PhaseId = (typeof PHASES)[number]["id"];

export function normUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

const REVIEW_WORDS = /(review|verif|approv|marketplace|listing|security|assessment|partner|publish|distribut|certif|pricing|tier|consent)/i;

/** Phases are inferred from what the agent is actually doing, in order. */
export function createTracker(emit: Emit) {
  const state = new Map<PhaseId, { status: PhaseStatus; detail: string }>(PHASES.map((p) => [p.id, { status: "pending", detail: "" }]));
  const set = (id: PhaseId, status: PhaseStatus, detail = "") => {
    const cur = state.get(id)!;
    if (cur.status === status && !detail) return;
    state.set(id, { status, detail: detail || cur.detail });
    emit({ type: "phase", id, label: PHASES.find((p) => p.id === id)!.label, status, detail: detail || cur.detail });
  };
  const advanceTo = (id: PhaseId) => {
    const idx = PHASES.findIndex((p) => p.id === id);
    PHASES.forEach((p, i) => {
      const st = state.get(p.id)!.status;
      if (i < idx && (st === "pending" || st === "running")) set(p.id, "done");
    });
    if (state.get(id)!.status === "pending") set(id, "running");
  };
  PHASES.forEach((p) => emit({ type: "phase", id: p.id, label: p.label, status: "pending" }));
  advanceTo("discover");
  return {
    set,
    advanceTo,
    status: (id: PhaseId) => state.get(id)!.status,
    onSearch(query: string) {
      if (REVIEW_WORDS.test(query) && state.get("register")!.status !== "pending") advanceTo("review");
    },
    onRead(url: string) {
      if (state.get("discover")!.status === "running") advanceTo("register");
      if (REVIEW_WORDS.test(url)) advanceTo("review");
    },
    snapshot: () => PHASES.map((p) => ({ id: p.id, label: p.label, ...state.get(p.id)! })),
  };
}
export type Tracker = ReturnType<typeof createTracker>;

export const RULES = `Evidence rules (checked mechanically, follow exactly):
- level "tested": only for facts established by a probe; cite the probe id (p1, p2...).
- level "documented": stated on an official page you actually read. Put a verbatim quote of at most 15 words, copied character-for-character from that page, in "quote", and cite that page's source id first. Quotes not found in the page are downgraded automatically.
- level "inferred": your reasoning from evidence; explain in "note".
- level "unverified": community reports or things you could not confirm; explain in "note".
- Never invent approval times. If none is published, use approvalWait null or a range marked unverified, and list it in uncertainties.
- Steps use the provider's real UI labels (button and menu text) and include at least one official link. Add "pointer" for steps done in a web console: urlPattern is a JavaScript regex for the console page, startUrl where to go, targets are exact visible labels to click or fill.
- actor: "agent" when an AI agent could do it unattended (drafting a privacy policy, scope justifications, a demo-video script, code); "you" when it needs the developer's login, legal attestation, payment or identity verification; "both" when an agent prepares and the developer submits.
- Difficulty: easy (self-serve, no review, under ~1 hour), moderate (some review or setup friction, days), hard (formal verification or security assessment, weeks), gated (paywall, partnership, invite-only, or no third-party OAuth at all).
- Paths: 2-4 distinct launch scenarios (e.g. testing only, public basic scopes, public sensitive scopes, marketplace), each with its own time and approval wait.
- If the provider does not offer third-party OAuth (API keys only, partner-only), say so plainly: that is a valid finding.
- Write for a developer who will act on this today. Concrete, short, honest about what you could not verify.`;

export function finalizeGuide(args: {
  draft: GuideDraft;
  query: string;
  model: string;
  startedAt: string;
  searches: string[];
  fetched: Map<string, FetchedText>;
  probes: Array<ProbeResult & { id: string }>;
  tracker: Tracker;
  sourceIdsForFetched?: Map<string, string>; // normUrl -> s#, when the agent assigned ids up front
}): Guide {
  const { draft, query, model, startedAt, searches, fetched, probes, tracker } = args;

  if (probes.length === 0) tracker.set("probe", "skipped", "No endpoints were probed.");
  else tracker.set("probe", probes.some((p) => p.ok) ? "done" : "partial", `${probes.filter((p) => p.ok).length} of ${probes.length} probes succeeded.`);
  tracker.set("write", "done");
  tracker.set("ground", "running");

  const today = new Date().toISOString().slice(0, 10);
  const probeSources: Source[] = probes.map((p) => ({ id: p.id, title: `Live probe: ${p.summary.slice(0, 90)}`, url: p.url, kind: "probe", accessed: today }));
  const modelSources = new Map(draft.sources.filter((s) => !/^p\d+$/.test(s.id)).map((s) => [s.id, s]));
  const sources: Source[] = [];
  if (args.sourceIdsForFetched) {
    // Fetched pages keep the ids the agent saw while researching; the model only supplies the kind.
    for (const [key, id] of args.sourceIdsForFetched) {
      const page = fetched.get(key)!;
      const m = modelSources.get(id);
      sources.push({ id, title: m?.title || page.title, url: page.url, kind: m?.kind ?? "official-docs", accessed: today });
      modelSources.delete(id);
    }
  }
  for (const s of modelSources.values()) sources.push({ ...s, accessed: today });

  const slugBase = draft.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
  const id = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
  const guide: Guide = { schemaVersion: 1, ...draft, slug: id, origin: "agent", updatedAt: today, sources: [...sources, ...probeSources], verificationLog: [] };

  const grounding = ground(guide, fetched);

  // Approval waits are the number developers plan around. Unless a verified quote backs one,
  // label it as the agent's estimate.
  const flagWait = (wait: unknown, ev: { level: string; note?: string; quoteCheck?: string }) => {
    // A real quote that says "review is required" doesn't establish how long review takes.
    const quoteGivesTime = /\d|\b(day|week|month|hour)s?\b/i.test((ev as { quote?: string }).quote ?? "");
    if (wait && !(ev.level === "documented" && ev.quoteCheck === "found" && quoteGivesTime) && ev.level !== "unverified") {
      ev.level = "unverified";
      ev.note = `No published timeline was verified; this wait is the agent's estimate. ${ev.note ?? ""}`.trim();
      grounding.downgraded++;
    }
  };
  flagWait(guide.effort.approvalWait, guide.effort.evidence);
  guide.paths.forEach((p) => flagWait(p.approvalWait, p.evidence));
  tracker.set("ground", grounding.downgraded > 0 ? "partial" : "done", `${grounding.quotesFound} of ${grounding.quotesChecked} quotes found verbatim; ${grounding.downgraded} claims downgraded.`);

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
          ? `${grounding.downgraded} claim(s) could not be backed by the fetched source (quote not found, or "tested" without a probe) and were downgraded to "inferred".`
          : `All ${grounding.quotesFound} quotes appear verbatim in their sources.`,
    },
  ];

  const record: InvestigationRecord = {
    id,
    query,
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    searches,
    pagesRead: [...fetched.values()].map((p) => p.url),
    probes,
    phases: tracker.snapshot(),
    grounding,
  };
  guide.investigation = record;
  return guide;
}
