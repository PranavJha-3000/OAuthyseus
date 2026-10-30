import type { Evidence, Guide } from "../types";

// Mechanical honesty check. Every "documented" claim carries a short verbatim quote;
// if that quote is not in the page the agent actually fetched, the claim is downgraded.
// "tested" claims must cite a probe the agent actually ran.

type FetchedPage = { url: string; title: string; text: string };

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[*_`#>|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export function collectEvidence(node: unknown, out: Evidence[] = []): Evidence[] {
  if (Array.isArray(node)) node.forEach((n) => collectEvidence(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.level === "string" && Array.isArray(o.sources)) out.push(o as unknown as Evidence);
    else Object.values(o).forEach((v) => collectEvidence(v, out));
  }
  return out;
}

export function ground(guide: Guide, fetched: Map<string, FetchedPage>) {
  const sourceUrl = new Map(guide.sources.map((s) => [s.id, s.url]));
  const probeIds = new Set(guide.sources.filter((s) => s.kind === "probe").map((s) => s.id));
  const allText = [...fetched.values()].map((p) => normalizeText(p.text)).join("\n");
  let quotesChecked = 0;
  let quotesFound = 0;
  let downgraded = 0;

  for (const ev of collectEvidence({ ...guide, sources: [] })) {
    if (ev.level === "tested" && !ev.sources.some((id) => probeIds.has(id))) {
      ev.level = "inferred";
      ev.note = `Marked tested but no probe backs it; downgraded. ${ev.note ?? ""}`.trim();
      downgraded++;
    }
    if (!ev.quote) {
      ev.quoteCheck = "unchecked";
      if (ev.level === "documented" && ev.sources.length === 0) {
        ev.level = "inferred";
        ev.note = `No source cited; downgraded from documented. ${ev.note ?? ""}`.trim();
        downgraded++;
      }
      continue;
    }
    quotesChecked++;
    const q = normalizeText(ev.quote);
    const cited = ev.sources.map((id) => sourceUrl.get(id)).filter(Boolean).map((u) => fetched.get(normUrl(u!)));
    const citedText = cited.filter(Boolean).map((p) => normalizeText(p!.text)).join("\n");
    // Prefer the cited page; fall back to any fetched page (the agent sometimes cites the parent URL).
    const found = (citedText && citedText.includes(q)) || allText.includes(q);
    ev.quoteCheck = found ? "found" : "not-found";
    if (found) quotesFound++;
    else if (ev.level === "documented") {
      ev.level = "inferred";
      ev.note = `Quote not found verbatim in the fetched source; downgraded from documented. ${ev.note ?? ""}`.trim();
      downgraded++;
    }
  }
  return { quotesChecked, quotesFound, downgraded };
}
