# Guide JSON schema (v1)

Every guide — hand-curated or agent-generated — is one JSON file with this shape.
The web app, the live agent and the Chrome pointer extension all read it.

```ts
type EvidenceLevel =
  | "tested"      // we (or the agent) actually exercised it: HTTP probe, real console walk-through
  | "documented"  // stated in an official provider source we read (cite it, quote <= 15 words)
  | "inferred"    // reasonable conclusion from evidence, not stated outright (explain why)
  | "unverified"; // reported by community / could not confirm — treat with caution

interface Evidence {
  level: EvidenceLevel;
  sources: string[];   // ids from guide.sources
  quote?: string;      // short verbatim snippet (<= 15 words) from the first source supporting the claim
  note?: string;       // why this level; for inferred: the reasoning
}

interface Duration { min: number; max: number; unit: "minutes" | "hours" | "days" | "weeks" }

interface Guide {
  schemaVersion: 1;
  slug: string;                 // "google", "slack"
  name: string;                 // "Google (Gmail, Drive, Calendar)"
  website: string;              // "https://google.com"
  category: string;             // "Productivity", "Communication", "Developer tools", "CRM", "Social"
  brandColor: string;           // hex, for the avatar
  origin: "curated" | "agent";
  updatedAt: string;            // ISO date
  summary: string;              // 2-3 sentence bottom line a developer reads first

  verdict: {
    difficulty: "easy" | "moderate" | "hard" | "gated"; // gated = paywall / partner program / invite only
    headline: string;           // "Under an hour for testing; 4-8+ weeks to launch with Gmail read access"
    rationale: string;
    evidence: Evidence;
  };

  effort: {
    activeTime: Duration;       // hands-on developer work for the default (most common) path
    approvalRequired: "no" | "conditional" | "yes";
    approvalWait: Duration | null; // null when no approval
    approvalNote: string;       // what triggers review, who reviews
    evidence: Evidence;
  };

  // Difficulty depends on what you ask for. Each path is a distinct launch scenario.
  paths: Array<{
    id: string;                 // "internal", "public-basic", "public-restricted"
    name: string;               // "Public app, restricted Gmail scopes"
    when: string;               // when this path applies to you
    difficulty: "easy" | "moderate" | "hard" | "gated";
    activeTime: Duration;
    approvalWait: Duration | null;
    whatChanges: string;        // extra requirements vs. the simplest path
    evidence: Evidence;
  }>;

  // How the provider "app" maps onto the developer's integration and their users' connections.
  appModel: {
    providerTerm: string;       // "OAuth client in a Google Cloud project", "Slack app"
    explanation: string;        // one provider app <-> your product; each end-user connection = one grant/token
    tokenNotes: string;         // refresh tokens, expiry, per-workspace installs, etc.
    evidence: Evidence;
  };

  requirements: Array<{
    item: string;               // "Verified domain", "Privacy policy URL", "Security assessment (CASA)"
    detail: string;
    neededFor: string[];        // path ids this applies to
    evidence: Evidence;
  }>;

  steps: Array<{
    id: string;
    title: string;
    actor: "you" | "agent" | "both"; // who can do this step: agent = an AI agent can do it unattended
    actorNote: string;          // why: "requires your Google login", "agent can draft this text"
    duration: Duration;
    pathIds: string[];          // which paths need this step ([] = all)
    instructions: string[];     // ordered, concrete, provider-specific UI wording
    values?: Array<{ field: string; value: string; note?: string }>; // e.g. redirect URI to paste
    links: Array<{ label: string; url: string }>;
    pointer?: {                 // used by the Chrome extension to highlight the real console UI
      urlPattern: string;       // regex tested against location.href on the provider console
      startUrl: string;         // where to send the developer for this step
      targets: Array<{ text: string; kind: "button" | "link" | "field" | "tab" | "menu" | "any"; hint: string }>;
    };
    evidence: Evidence;
  }>;

  blockers: Array<{
    title: string;              // "Verification stuck: 'domain not verified'"
    symptom: string;
    fix: string;
    severity: "low" | "medium" | "high";
    evidence: Evidence;
  }>;

  agentCan: string[];           // what an AI agent can do for you
  youMust: string[];            // where a human must take over (logins, legal attestations, payment, video recording...)
  nextActions: string[];        // the first 3-5 things to do right now

  uncertainties: string[];      // what we could not confirm
  verificationLog: Array<{      // what was actually checked, and what changed as a result
    date: string;
    check: string;
    method: "http-probe" | "doc-review" | "console-walkthrough" | "agent-vs-curated";
    result: "confirmed" | "corrected" | "unverifiable";
    detail: string;
  }>;

  sources: Array<{
    id: string;                 // "s1"
    title: string;
    url: string;
    kind: "official-docs" | "official-policy" | "official-blog" | "community" | "probe";
    accessed: string;           // ISO date
  }>;
}
```

Rules:
- Never invent approval times. If the provider publishes none, say so, give the community-reported range with level `unverified`, or set `approvalWait` with an evidence note explaining the basis.
- Every step needs at least one official link.
- `quote` must be a real, verbatim, short snippet — it is mechanically checked.
