import fs from "node:fs";
import path from "node:path";
import type { Guide } from "./types";
import { loadGenerated } from "./store";

const GUIDE_DIR = path.join(process.cwd(), "data", "guides");

let cache: Guide[] | null = null;

export function curatedGuides(): Guide[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const files = fs.existsSync(GUIDE_DIR) ? fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith(".json")) : [];
  const guides: Guide[] = [];
  for (const f of files) {
    try {
      guides.push(JSON.parse(fs.readFileSync(path.join(GUIDE_DIR, f), "utf8")) as Guide);
    } catch (err) {
      console.error(`Skipping unreadable guide ${f}:`, err);
    }
  }
  const order = { easy: 0, moderate: 1, hard: 2, gated: 3 } as const;
  guides.sort((a, b) => order[a.verdict.difficulty] - order[b.verdict.difficulty] || a.name.localeCompare(b.name));
  cache = guides;
  return guides;
}

export function curatedGuide(slug: string): Guide | undefined {
  return curatedGuides().find((g) => g.slug === slug);
}

// Curated slugs first, then agent-generated ids.
export async function anyGuide(id: string): Promise<Guide | undefined> {
  return curatedGuide(id) ?? (await loadGenerated(id)) ?? undefined;
}

// Rough match of a free-text query ("gmail", "https://slack.com") to a curated guide.
export function matchCurated(query: string): Guide | undefined {
  const q = query.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].trim();
  if (!q) return undefined;
  return curatedGuides().find((g) => {
    const host = g.website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return g.slug === q || host === q || g.name.toLowerCase().split(/[\s(,)]+/).includes(q);
  });
}
