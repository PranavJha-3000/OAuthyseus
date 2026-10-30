// Run a live investigation from the terminal and save the guide like the web app does.
//   npx tsx --env-file=.env scripts/investigate.mts "Calendly"
import { runInvestigation } from "../src/lib/agent/investigate";
import { saveGenerated } from "../src/lib/store";

const query = process.argv.slice(2).join(" ") || "Calendly";
const t0 = Date.now();
const stamp = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`;

const guide = await runInvestigation(query, (e) => {
  if (e.type === "phase" && e.status !== "pending") console.log(`${stamp()} [phase] ${e.label}: ${e.status}${e.detail ? ` (${e.detail})` : ""}`);
  else if (e.type === "search") console.log(`${stamp()} [search] ${e.query}`);
  else if (e.type === "read") console.log(`${stamp()} [read] ${e.title ?? e.url}`);
  else if (e.type === "probe") console.log(`${stamp()} [probe] ${e.probe.url}: ${e.probe.summary}`);
  else if (e.type === "note") console.log(`${stamp()} [note] ${e.text.replace(/\s+/g, " ").slice(0, 200)}`);
});
await saveGenerated(guide);
console.log(`\nSaved /g/${guide.slug} in ${stamp()}`);
console.log(`Verdict: ${guide.verdict.difficulty}. ${guide.verdict.headline}`);
console.log(`Steps ${guide.steps.length}, blockers ${guide.blockers.length}, sources ${guide.sources.length}, grounding ${JSON.stringify(guide.investigation?.grounding)}`);
