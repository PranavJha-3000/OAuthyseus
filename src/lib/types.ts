// Mirrors docs/guide-schema.md. Curated and agent-generated guides share this shape.

export type EvidenceLevel = "tested" | "documented" | "inferred" | "unverified";
export type Difficulty = "easy" | "moderate" | "hard" | "gated";
export type DurationUnit = "minutes" | "hours" | "days" | "weeks";

export interface Evidence {
  level: EvidenceLevel;
  sources: string[];
  quote?: string;
  note?: string;
  // Set by the grounding check, never by the author.
  quoteCheck?: "found" | "not-found" | "unchecked";
}

export interface Duration {
  min: number;
  max: number;
  unit: DurationUnit;
}

export interface GuidePath {
  id: string;
  name: string;
  when: string;
  difficulty: Difficulty;
  activeTime: Duration;
  approvalWait: Duration | null;
  whatChanges: string;
  evidence: Evidence;
}

export interface PointerTarget {
  text: string;
  kind: "button" | "link" | "field" | "tab" | "menu" | "any";
  hint: string;
}

export interface GuideStep {
  id: string;
  title: string;
  actor: "you" | "agent" | "both";
  actorNote: string;
  duration: Duration;
  pathIds: string[];
  instructions: string[];
  values?: Array<{ field: string; value: string; note?: string }>;
  links: Array<{ label: string; url: string }>;
  pointer?: {
    urlPattern: string;
    startUrl: string;
    targets: PointerTarget[];
  };
  evidence: Evidence;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  kind: "official-docs" | "official-policy" | "official-blog" | "community" | "probe";
  accessed: string;
}

export interface VerificationEntry {
  date: string;
  check: string;
  method: "http-probe" | "doc-review" | "console-walkthrough" | "agent-vs-curated";
  result: "confirmed" | "corrected" | "unverifiable";
  detail: string;
}

export interface Guide {
  schemaVersion: 1;
  slug: string;
  name: string;
  website: string;
  category: string;
  brandColor: string;
  origin: "curated" | "agent";
  updatedAt: string;
  summary: string;
  verdict: {
    difficulty: Difficulty;
    headline: string;
    rationale: string;
    evidence: Evidence;
  };
  effort: {
    activeTime: Duration;
    approvalRequired: "no" | "conditional" | "yes";
    approvalWait: Duration | null;
    approvalNote: string;
    evidence: Evidence;
  };
  paths: GuidePath[];
  appModel: {
    providerTerm: string;
    explanation: string;
    tokenNotes: string;
    evidence: Evidence;
  };
  requirements: Array<{
    item: string;
    detail: string;
    neededFor: string[];
    evidence: Evidence;
  }>;
  steps: GuideStep[];
  blockers: Array<{
    title: string;
    symptom: string;
    fix: string;
    severity: "low" | "medium" | "high";
    evidence: Evidence;
  }>;
  agentCan: string[];
  youMust: string[];
  nextActions: string[];
  uncertainties: string[];
  verificationLog: VerificationEntry[];
  sources: Source[];
  // Present on agent-generated guides.
  investigation?: InvestigationRecord;
}

// ---- Live investigation ----

export type ProbeKind = "page" | "oidc-discovery" | "authorize-endpoint" | "console";

export interface ProbeResult {
  kind: ProbeKind;
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  summary: string;
  at: string;
}

export interface InvestigationRecord {
  id: string;
  query: string;
  startedAt: string;
  finishedAt: string;
  model: string;
  searches: string[];
  pagesRead: string[];
  probes: ProbeResult[];
  phases: Array<{ id: string; label: string; status: PhaseStatus; detail: string }>;
  grounding: { quotesChecked: number; quotesFound: number; downgraded: number };
}

export type PhaseStatus = "pending" | "running" | "done" | "partial" | "skipped" | "failed";

export type InvestigationEvent =
  | { type: "phase"; id: string; label: string; status: PhaseStatus; detail?: string }
  | { type: "search"; query: string }
  | { type: "read"; url: string; title?: string }
  | { type: "probe"; probe: ProbeResult }
  | { type: "note"; text: string }
  | { type: "match"; slug: string; name: string }
  | { type: "done"; id: string; url: string }
  | { type: "error"; message: string };
