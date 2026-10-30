import type { Evidence, Guide } from "./types";
import { formatDuration } from "./duration";

const tag = (e: Evidence) => `_[${e.level}${e.sources.length ? ` ${e.sources.join(",")}` : ""}]_`;

export function guideToMarkdown(g: Guide, url: string): string {
  const L: string[] = [];
  L.push(`# ${g.name}: OAuth app setup guide`, "");
  L.push(`> ${g.origin === "curated" ? "Curated" : "Agent-generated"} guide, updated ${g.updatedAt}. Source: ${url}`, "");
  L.push(`**Difficulty:** ${g.verdict.difficulty}. ${g.verdict.headline} ${tag(g.verdict.evidence)}`, "");
  L.push(g.summary, "");
  L.push(`**Your work:** ${formatDuration(g.effort.activeTime)}. **Waiting on provider:** ${formatDuration(g.effort.approvalWait)} (${g.effort.approvalRequired === "no" ? "no review" : g.effort.approvalRequired === "yes" ? "review required" : "review depends on path"}).`, "");
  L.push(g.effort.approvalNote, "");
  L.push("## Launch paths", "");
  L.push("| Path | Difficulty | Your work | Provider wait |", "|---|---|---|---|");
  g.paths.forEach((p) => L.push(`| ${p.name} | ${p.difficulty} | ${formatDuration(p.activeTime)} | ${formatDuration(p.approvalWait)} |`));
  L.push("", "## Do these first", "");
  g.nextActions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
  L.push("", "## What you're registering", "", `**${g.appModel.providerTerm}.** ${g.appModel.explanation}`, "", g.appModel.tokenNotes, "");
  L.push("## What you'll need", "");
  g.requirements.forEach((r) => L.push(`- **${r.item}**: ${r.detail} ${tag(r.evidence)}`));
  L.push("", "## Steps", "");
  g.steps.forEach((s, i) => {
    L.push(`### ${i + 1}. ${s.title} (${formatDuration(s.duration)}, ${s.actor === "you" ? "you" : s.actor === "agent" ? "agent can do" : "agent prepares, you submit"})`, "");
    s.instructions.forEach((x, j) => L.push(`${j + 1}. ${x}`));
    s.values?.forEach((v) => L.push(`   - ${v.field}: \`${v.value}\`${v.note ? ` (${v.note})` : ""}`));
    L.push("", s.links.map((l) => `[${l.label}](${l.url})`).join(" · ") + ` ${tag(s.evidence)}`, "");
  });
  L.push("## Blockers", "");
  g.blockers.forEach((b) => L.push(`- **${b.title}** (${b.severity}). Symptom: ${b.symptom} Fix: ${b.fix} ${tag(b.evidence)}`));
  L.push("", "## Agent vs. you", "", "**An agent can:**");
  g.agentCan.forEach((a) => L.push(`- ${a}`));
  L.push("", "**You must:**");
  g.youMust.forEach((a) => L.push(`- ${a}`));
  L.push("", "## What we couldn't confirm", "");
  g.uncertainties.forEach((u) => L.push(`- ${u}`));
  L.push("", "## Verification log", "");
  g.verificationLog.forEach((v) => L.push(`- ${v.date} · ${v.method} · **${v.result}**: ${v.check}. ${v.detail}`));
  L.push("", "## Sources", "");
  g.sources.forEach((s) => L.push(`- ${s.id}: [${s.title}](${s.url}) (${s.kind}, accessed ${s.accessed})`));
  L.push("", "Evidence tags: tested = exercised live; documented = official source, quote checked; inferred = reasoning; unverified = unconfirmed.");
  return L.join("\n");
}
