import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Guide } from "./types";

// Generated guides need to outlive the request so their URL can be shared.
// Production: Upstash Redis over REST (free tier is plenty). Local dev: JSON files.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const LOCAL_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "oauthyseus")
  : path.join(process.cwd(), ".data", "generated");

const KEY = (id: string) => `guide:${id}`;
const INDEX = "guides:recent";

export function storageMode(): "upstash" | "local" {
  return UPSTASH_URL && UPSTASH_TOKEN ? "upstash" : "local";
}

async function upstash(command: unknown[]): Promise<unknown> {
  const res = await fetch(UPSTASH_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { result: unknown }).result;
}

export async function saveGenerated(guide: Guide): Promise<void> {
  const id = guide.slug;
  if (storageMode() === "upstash") {
    await upstash(["SET", KEY(id), JSON.stringify(guide)]);
    await upstash(["LPUSH", INDEX, id]);
    await upstash(["LTRIM", INDEX, 0, 49]);
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(guide, null, 2));
}

export async function loadGenerated(id: string): Promise<Guide | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return null;
  try {
    if (storageMode() === "upstash") {
      const raw = (await upstash(["GET", KEY(id)])) as string | null;
      return raw ? (JSON.parse(raw) as Guide) : null;
    }
    return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) as Guide;
  } catch {
    return null;
  }
}

export async function recentGenerated(limit = 8): Promise<Guide[]> {
  try {
    let ids: string[];
    if (storageMode() === "upstash") {
      ids = [...new Set((await upstash(["LRANGE", INDEX, 0, 30])) as string[])];
    } else {
      const files = await fs.readdir(LOCAL_DIR).catch(() => [] as string[]);
      const stats = await Promise.all(
        files.filter((f) => f.endsWith(".json")).map(async (f) => ({ f, t: (await fs.stat(path.join(LOCAL_DIR, f))).mtimeMs })),
      );
      ids = stats.sort((a, b) => b.t - a.t).map((s) => s.f.replace(/\.json$/, ""));
    }
    const guides = await Promise.all(ids.slice(0, limit).map(loadGenerated));
    return guides.filter((g): g is Guide => g !== null);
  } catch {
    return [];
  }
}
