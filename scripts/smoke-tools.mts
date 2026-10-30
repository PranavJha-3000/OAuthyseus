// Exercises the agent's tools without any model: search, page reading, probes.
//   npx tsx scripts/smoke-tools.mts "Calendly"
import { webSearch, fetchPage, excerpt } from "../src/lib/agent/web";
import { probePage, probeAuthorize, probeDiscovery } from "../src/lib/agent/probes";

const app = process.argv[2] ?? "Calendly";
const { engine, results } = await webSearch(`${app} OAuth app registration developer docs`);
console.log(`search (${engine}): ${results.length} results`);
results.slice(0, 4).forEach((r) => console.log(`  - ${r.title} | ${r.url}`));
const top = results.find((r) => !/youtube|reddit|stackoverflow/.test(r.url)) ?? results[0];
if (top) {
  const page = await fetchPage(top.url);
  console.log(`fetch: "${page.title}" via ${page.via}, ${page.text.length} chars`);
  console.log(excerpt(page, ["redirect", "client"], 600).replace(/\n+/g, " ").slice(0, 600));
}
console.log((await probePage("https://calendly.com/integrations/api_webhooks", "console")).summary);
console.log((await probeAuthorize("https://auth.calendly.com/oauth/authorize")).summary);
console.log((await probeDiscovery("https://auth.calendly.com")).summary);
