"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Difficulty, Duration } from "@/lib/types";
import { formatDuration } from "@/lib/duration";
import { DifficultyMark } from "./marks";
import { RouteBar } from "./RouteBar";

export interface LibraryItem {
  href: string;
  name: string;
  website: string;
  category: string;
  brandColor: string;
  origin: "curated" | "agent";
  difficulty: Difficulty;
  headline: string;
  active: Duration;
  wait: Duration | null;
  maxWait: Duration | null;
  updatedAt: string;
}

const FILTERS: Array<{ id: "all" | Difficulty; label: string }> = [
  { id: "all", label: "All" },
  { id: "easy", label: "Easy" },
  { id: "moderate", label: "Moderate" },
  { id: "hard", label: "Hard" },
  { id: "gated", label: "Gated" },
];

export function Library({ curated, generated }: { curated: LibraryItem[]; generated: LibraryItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Difficulty>("all");
  const router = useRouter();

  const match = (i: LibraryItem) => {
    const s = q.trim().toLowerCase();
    return (
      (filter === "all" || i.difficulty === filter) &&
      (!s || i.name.toLowerCase().includes(s) || i.website.toLowerCase().includes(s) || i.category.toLowerCase().includes(s))
    );
  };
  const rows = useMemo(() => curated.filter(match), [curated, q, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const genRows = useMemo(() => generated.filter(match), [generated, q, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const investigate = () => q.trim().length > 1 && router.push(`/investigate?q=${encodeURIComponent(q.trim())}`);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (rows.length === 1 && q.trim()) router.push(rows[0].href);
          else investigate();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="lookup" className="sr-only">App name or website</label>
        <input
          id="lookup"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Look up an app: Gmail, slack.com, Zoom, Linear…"
          autoComplete="off"
          className="h-12 flex-1 rounded-lg border border-line bg-surface px-4 text-base outline-none placeholder:text-muted focus:border-sea"
        />
        <button type="button" onClick={investigate} disabled={q.trim().length < 2} className="h-12 rounded-lg bg-ink px-5 font-medium text-paper disabled:opacity-40">
          Investigate with the agent
        </button>
      </form>

      <div id="library" className="mt-8 flex flex-wrap items-center justify-between gap-3 scroll-mt-6">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Guide library</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by difficulty">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-sm ${filter === f.id ? "border-ink bg-ink text-paper" : "border-line hover:border-sea"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Rows items={rows} />

      {rows.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-line p-6">
          <p className="font-medium">No curated guide for “{q}” yet.</p>
          <p className="mt-1 text-sm text-muted">The agent can investigate it now: it reads the provider's docs, probes the live console and endpoints, and writes a guide you can share. It takes two to four minutes.</p>
          <button type="button" onClick={investigate} className="mt-3 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper">
            Investigate “{q}”
          </button>
        </div>
      )}

      {genRows.length > 0 && (
        <>
          <h2 className="mt-12 font-display text-xl font-semibold tracking-tight">Recently investigated by the agent</h2>
          <p className="mt-1 text-sm text-muted">Generated live, not reviewed by a person. Each one shows what the agent tested and what it couldn't confirm.</p>
          <Rows items={genRows} />
        </>
      )}
    </div>
  );
}

function Rows({ items }: { items: LibraryItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className="grid gap-3 p-4 hover:bg-sunken sm:grid-cols-[minmax(12rem,1.3fr)_7rem_minmax(10rem,1fr)] sm:items-center sm:gap-6">
            <span className="flex items-center gap-3">
              <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-lg font-bold text-white ring-1 ring-line" style={{ background: i.brandColor }}>
                {i.name.trim()[0]}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{i.name}</span>
                <span className="block truncate text-sm text-muted">{i.headline}</span>
              </span>
            </span>
            <DifficultyMark difficulty={i.difficulty} />
            <span className="block">
              <RouteBar active={i.active} wait={i.wait} compact label={i.name} />
              <span className="mt-1.5 block text-xs text-muted">
                {formatDuration(i.active)} of work, {i.wait ? `then ${formatDuration(i.wait)} waiting` : "no review"}
                {i.maxWait && !i.wait ? ` (longest path: ${formatDuration(i.maxWait)})` : ""}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
