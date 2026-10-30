import { assertPublicHttps } from "./probes";

// Search and page reading for the provider-neutral agent. Everything here works without
// an API key; Tavily or Brave are used instead when their (free-tier) keys are set.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  // Prefer the main content region when the page marks one.
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `)
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

async function ddgLite(query: string): Promise<SearchResult[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
  const html = await res.text();
  const out: SearchResult[] = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    const href = decodeEntities(m[1]);
    const url = href.includes("uddg=") ? decodeURIComponent(href.match(/uddg=([^&]+)/)![1]) : href.startsWith("//") ? `https:${href}` : href;
    if (url.includes("duckduckgo.com/y.js")) continue; // ads
    out.push({ url, title: stripTags(m[2]), snippet: stripTags(m[3]) });
  }
  return out;
}

async function bing(query: string): Promise<SearchResult[]> {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=us`, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
  const html = await res.text();
  const out: SearchResult[] = [];
  for (const block of html.split('<li class="b_algo"').slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decodeEntities(a[1]);
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try {
        url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {}
    }
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ url, title: stripTags(a[2]), snippet: p ? stripTags(p[1]) : "" });
    if (out.length >= 8) break;
  }
  return out;
}

async function tavily(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 8 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const j = (await res.json()) as { results: Array<{ title: string; url: string; content: string }> };
  return j.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 300) }));
}

async function brave(query: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = (await res.json()) as { web?: { results: Array<{ title: string; url: string; description: string }> } };
  return (j.web?.results ?? []).map((r) => ({ title: stripTags(r.title), url: r.url, snippet: stripTags(r.description) }));
}

export async function webSearch(query: string): Promise<{ engine: string; results: SearchResult[] }> {
  const engines: Array<[string, (q: string) => Promise<SearchResult[]>]> = [];
  if (process.env.TAVILY_API_KEY) engines.push(["tavily", tavily]);
  if (process.env.BRAVE_API_KEY) engines.push(["brave", brave]);
  engines.push(["duckduckgo", ddgLite], ["bing", bing]);
  for (const [name, fn] of engines) {
    try {
      const results = await fn(query);
      if (results.length > 0) return { engine: name, results };
    } catch (err) {
      console.warn(`search engine ${name} failed:`, (err as Error).message);
    }
  }
  return { engine: "none", results: [] };
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  via: "direct" | "reader";
}

/** Fetch a page as text. Falls back to the free Jina reader for client-rendered docs. */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const url = await assertPublicHttps(rawUrl);
  let page: FetchedPage | null = null;
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && /html|text|json|markdown/.test(type)) {
      const body = (await res.text()).slice(0, 3_000_000);
      const { title, text } = type.includes("html") ? htmlToText(body) : { title: res.url, text: body };
      page = { url: res.url || url.toString(), title: title || url.hostname, text, via: "direct" };
    }
  } catch {}
  if (!page || page.text.length < 1200) {
    try {
      const res = await fetch(`https://r.jina.ai/${url.toString()}`, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(25_000) });
      if (res.ok) {
        const body = await res.text();
        const title = body.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? page?.title ?? url.hostname;
        const text = body.split(/^Markdown Content:\s*$/m)[1] ?? body;
        if (text.length > (page?.text.length ?? 0)) page = { url: url.toString(), title, text: text.trim(), via: "reader" };
      }
    } catch {}
  }
  if (!page) throw new Error("page could not be loaded");
  // Soft 404s: the server says 200 (or the reader renders the error page) but it's a not-found page.
  if (/(^|\b)(404|page not found|couldn't find that page|could not find that page|page doesn't exist)\b/i.test(`${page.title} ${page.text.slice(0, 300)}`) && page.text.length < 4000) {
    throw new Error(`not found ("${page.title}")`);
  }
  return page;
}

/** What the model sees: the page head plus windows around the terms it is looking for. */
export function excerpt(page: FetchedPage, focus: string[] | undefined, budget = 9000): string {
  const text = page.text;
  if (text.length <= budget) return text;
  const terms = (focus ?? []).map((t) => t.toLowerCase()).filter((t) => t.length > 2);
  if (terms.length === 0) return `${text.slice(0, budget)}\n[...truncated; call fetch_page again with focus terms to see more]`;
  const lower = text.toLowerCase();
  const windows: Array<[number, number]> = [[0, 1500]];
  for (const term of terms) {
    let from = 0;
    let hits = 0;
    while (hits < 4) {
      const i = lower.indexOf(term, from);
      if (i < 0) break;
      windows.push([Math.max(0, i - 700), Math.min(text.length, i + 900)]);
      from = i + term.length;
      hits++;
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  let out = "";
  for (const [a, b] of merged) {
    let chunk = text.slice(a, b);
    if (out.length + chunk.length > budget) {
      if (out.length > 0) break;
      chunk = chunk.slice(0, budget);
    }
    out += (a > 0 ? "\n[...]\n" : "") + chunk;
  }
  return out;
}
