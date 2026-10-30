"use client";

import { useId, useState } from "react";
import type { Difficulty, Evidence, EvidenceLevel, Source } from "@/lib/types";

const DIFF: Record<Difficulty, { label: string; bars: number; color: string; plain: string }> = {
  easy: { label: "Easy", bars: 1, color: "var(--ok)", plain: "Self-serve, no review" },
  moderate: { label: "Moderate", bars: 2, color: "var(--sea)", plain: "Some review or setup friction" },
  hard: { label: "Hard", bars: 3, color: "var(--wait)", plain: "Formal review or security work, weeks" },
  gated: { label: "Gated", bars: 4, color: "var(--block)", plain: "Paywall, partnership or policy gate" },
};

export function DifficultyMark({ difficulty, size = "sm" }: { difficulty: Difficulty; size?: "sm" | "lg" }) {
  const d = DIFF[difficulty];
  const h = size === "lg" ? [8, 12, 16, 20] : [6, 9, 12, 15];
  return (
    <span className="inline-flex items-center gap-2" title={d.plain}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {h.map((px, i) => (
          <span
            key={i}
            style={{ height: px, width: size === "lg" ? 5 : 4, background: i < d.bars ? d.color : "var(--line)" }}
            className="rounded-[1px]"
          />
        ))}
      </span>
      <span className={size === "lg" ? "font-display text-lg font-semibold" : "text-sm font-medium"}>{d.label}</span>
    </span>
  );
}

export const LEVEL: Record<EvidenceLevel, { label: string; long: string; color: string }> = {
  tested: { label: "Tested", long: "Exercised live: an HTTP probe or a real console walkthrough", color: "var(--ok)" },
  documented: { label: "Documented", long: "Stated on an official provider page we read; quote checked", color: "var(--sea)" },
  inferred: { label: "Inferred", long: "Our reasoning from the evidence, not stated outright", color: "var(--muted)" },
  unverified: { label: "Unverified", long: "Community reports or unconfirmed; treat with caution", color: "var(--wait)" },
};

export function LevelGlyph({ level }: { level: EvidenceLevel }) {
  const c = LEVEL[level].color;
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  if (level === "tested") return <svg {...common}><circle cx="5" cy="5" r="4.5" fill={c} /></svg>;
  if (level === "documented") return <svg {...common}><circle cx="5" cy="5" r="3.8" fill="none" stroke={c} strokeWidth="1.6" /><circle cx="5" cy="5" r="1.6" fill={c} /></svg>;
  if (level === "inferred") return <svg {...common}><circle cx="5" cy="5" r="3.8" fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="2 1.6" /></svg>;
  return <svg {...common}><path d="M5 0.8 9.4 9H0.6Z" fill="none" stroke={c} strokeWidth="1.4" /></svg>;
}

/** Inline evidence chip. Click to see the quote, its check result and the sources. */
export function EvidenceMark({ evidence, sources }: { evidence: Evidence; sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const cited = evidence.sources.map((sid) => sources.find((s) => s.id === sid)).filter(Boolean) as Source[];
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-sea hover:text-ink"
      >
        <LevelGlyph level={evidence.level} />
        {LEVEL[evidence.level].label}
        {cited.length > 0 && <span className="text-muted">({cited.length})</span>}
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          className="absolute left-0 z-20 mt-2 block w-[min(22rem,80vw)] rounded-lg border border-line bg-surface p-3 text-left text-sm shadow-lg"
        >
          <span className="block text-xs text-muted">{LEVEL[evidence.level].long}</span>
          {evidence.quote && (
            <span className="mt-2 block border-l-2 border-sea pl-2 italic">
              “{evidence.quote}”
              {evidence.quoteCheck === "found" && <span className="mt-1 block text-xs not-italic text-ok">Found verbatim in the fetched source</span>}
              {evidence.quoteCheck === "not-found" && <span className="mt-1 block text-xs not-italic text-block">Not found in the fetched source</span>}
            </span>
          )}
          {evidence.note && <span className="mt-2 block text-muted">{evidence.note}</span>}
          {cited.length > 0 && (
            <span className="mt-2 block space-y-1">
              {cited.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block truncate text-sea underline underline-offset-2">
                  {s.title}
                </a>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
