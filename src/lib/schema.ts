import { z } from "zod";

// Runtime validation for guides. The agent's submit_guide tool uses GuideDraft
// (everything the model writes); code adds origin, dates, verification log and grounding.

const Level = z.enum(["tested", "documented", "inferred", "unverified"]);
const Difficulty = z.enum(["easy", "moderate", "hard", "gated"]);

export const EvidenceSchema = z.object({
  level: Level,
  sources: z.array(z.string()).describe("ids from sources[], e.g. [\"s1\"]; probe results are p1, p2..."),
  quote: z.string().optional().describe("verbatim snippet (<= 15 words) copied exactly from the FIRST source; omit if none"),
  note: z.string().optional().describe("why this evidence level; required for inferred/unverified"),
});

export const DurationSchema = z.object({
  min: z.number(),
  max: z.number(),
  unit: z.enum(["minutes", "hours", "days", "weeks"]),
});

export const GuideDraftSchema = z.object({
  slug: z.string().describe("lowercase-hyphenated provider name, e.g. 'zoom'"),
  name: z.string(),
  website: z.string(),
  category: z.string(),
  brandColor: z.string().describe("hex color of the provider brand, e.g. #2D8CFF"),
  summary: z.string().describe("2-3 sentence bottom line for a developer"),
  verdict: z.object({
    difficulty: Difficulty,
    headline: z.string(),
    rationale: z.string(),
    evidence: EvidenceSchema,
  }),
  effort: z.object({
    activeTime: DurationSchema,
    approvalRequired: z.enum(["no", "conditional", "yes"]),
    approvalWait: DurationSchema.nullable(),
    approvalNote: z.string(),
    evidence: EvidenceSchema,
  }),
  paths: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      when: z.string(),
      difficulty: Difficulty,
      activeTime: DurationSchema,
      approvalWait: DurationSchema.nullable(),
      whatChanges: z.string(),
      evidence: EvidenceSchema,
    }),
  ),
  appModel: z.object({
    providerTerm: z.string(),
    explanation: z.string(),
    tokenNotes: z.string(),
    evidence: EvidenceSchema,
  }),
  requirements: z.array(
    z.object({ item: z.string(), detail: z.string(), neededFor: z.array(z.string()), evidence: EvidenceSchema }),
  ),
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      actor: z.enum(["you", "agent", "both"]),
      actorNote: z.string(),
      duration: DurationSchema,
      pathIds: z.array(z.string()),
      instructions: z.array(z.string()),
      values: z.array(z.object({ field: z.string(), value: z.string(), note: z.string().optional() })).optional(),
      links: z.array(z.object({ label: z.string(), url: z.string() })),
      pointer: z
        .object({
          urlPattern: z.string(),
          startUrl: z.string(),
          targets: z.array(
            z.object({
              text: z.string().describe("exact visible label of the button/link/field in the provider console"),
              kind: z.enum(["button", "link", "field", "tab", "menu", "any"]),
              hint: z.string(),
            }),
          ),
        })
        .optional(),
      evidence: EvidenceSchema,
    }),
  ),
  blockers: z.array(
    z.object({
      title: z.string(),
      symptom: z.string(),
      fix: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      evidence: EvidenceSchema,
    }),
  ),
  agentCan: z.array(z.string()),
  youMust: z.array(z.string()),
  nextActions: z.array(z.string()),
  uncertainties: z.array(z.string()),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      kind: z.enum(["official-docs", "official-policy", "official-blog", "community", "probe"]),
    }),
  ),
});

export type GuideDraft = z.infer<typeof GuideDraftSchema>;

export function guideDraftJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(GuideDraftSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
