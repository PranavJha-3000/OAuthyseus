"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvestigationEvent, PhaseStatus } from "@/lib/types";

type Phase = { id: string; label: string; status: PhaseStatus; detail?: string };
type Activity = { t: number; kind: "search" | "read" | "probe" | "note" | "error"; text: string; sub?: string; ok?: boolean };

const STATUS_TEXT: Record<PhaseStatus, string> = {
  pending: "Waiting",
  running: "Working",
  done: "Completed",
  partial: "Partly verified",
  skipped: "Not tested",
  failed: "Failed",
};

function StatusIcon({ status }: { status: PhaseStatus }) {
  if (status === "running") return <span className="live-dot inline-block h-3 w-3 rounded-full bg-sea" aria-hidden />;
  if (status === "done") return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="7" fill="var(--ok)" /><path d="M4 7.2 6.1 9.2 10 5" stroke="white" strokeWidth="1.8" fill="none" /></svg>;
  if (status === "partial") return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="6" fill="none" stroke="var(--wait)" strokeWidth="2" /><path d="M7 1a6 6 0 0 1 0 12z" fill="var(--wait)" /></svg>;
  if (status === "failed") return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="7" fill="var(--block)" /></svg>;
  return <span className="inline-block h-3 w-3 rounded-full border-2 border-line" aria-hidden />;
}

export function InvestigateLive({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [running, setRunning] = useState(false);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [match, setMatch] = useState<{ slug: string; name: string } | null>(null);
  const [done, setDone] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const feedRef = useRef<HTMLOListElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autostarted = useRef(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    feedRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activity.length]);

  const start = useCallback(
    async (q: string, force = false) => {
      if (q.trim().length < 2) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      setPhases([]);
      setActivity([]);
      setMatch(null);
      setDone(null);
      setError(null);
      setStartedAt(Date.now());
      window.history.replaceState(null, "", `/investigate?q=${encodeURIComponent(q.trim())}`);
      const add = (a: Omit<Activity, "t">) => setActivity((xs) => [...xs, { ...a, t: Date.now() }]);

      try {
        const res = await fetch("/api/investigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q.trim(), force }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Request failed (${res.status}).`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const ev = JSON.parse(line.slice(6)) as InvestigationEvent;
            switch (ev.type) {
              case "phase":
                setPhases((ps) => {
                  const i = ps.findIndex((p) => p.id === ev.id);
                  const next = { id: ev.id, label: ev.label, status: ev.status, detail: ev.detail };
                  if (i < 0) return [...ps, next];
                  const copy = ps.slice();
                  copy[i] = next;
                  return copy;
                });
                break;
              case "search":
                add({ kind: "search", text: ev.query });
                break;
              case "read":
                add({ kind: "read", text: ev.title ?? ev.url, sub: ev.title ? ev.url : undefined });
                break;
              case "probe":
                add({ kind: "probe", text: ev.probe.url, sub: ev.probe.summary, ok: ev.probe.ok });
                break;
              case "note":
                add({ kind: "note", text: ev.text });
                break;
              case "match":
                setMatch({ slug: ev.slug, name: ev.name });
                break;
              case "done":
                setDone({ url: ev.url });
                break;
              case "error":
                setError(ev.message);
                add({ kind: "error", text: ev.message });
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialQuery && !autostarted.current) {
      autostarted.current = true;
      start(initialQuery);
    }
  }, [initialQuery, start]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.push(done.url), 2500);
    return () => clearTimeout(t);
  }, [done, router]);

  const elapsed = startedAt ? Math.round(((running ? now : Date.now()) - startedAt) / 1000) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Investigate an app</h1>
      <p className="mt-3 max-w-[64ch] text-muted">
        Enter the name or website of any app your users need to connect. The agent works from scratch: it finds the official
        developer docs, checks registration and review rules, probes the live console and OAuth endpoints, and writes a
        guide you can share. Expect two to four minutes.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(query);
        }}
        className="mt-6 flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="q" className="sr-only">App name or website</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Calendly, https://linear.app, Dropbox"
          className="h-12 flex-1 rounded-lg border border-line bg-surface px-4 outline-none placeholder:text-muted focus:border-sea"
        />
        <button disabled={running || query.trim().length < 2} className="h-12 rounded-lg bg-ink px-5 font-medium text-paper disabled:opacity-40">
          {running ? "Investigating…" : "Investigate OAuth setup"}
        </button>
      </form>

      {match && (
        <div className="mt-6 rounded-xl border border-sea bg-sea-soft p-5">
          <p className="font-medium">There's already a curated guide for {match.name}.</p>
          <p className="mt-1 text-sm text-muted">It was researched and checked by hand. You can still run the agent to compare.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/guides/${match.slug}`} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper">Open the {match.name} guide</Link>
            <button type="button" onClick={() => start(query, true)} className="rounded-md border border-line bg-surface px-4 py-2 text-sm">Investigate anyway</button>
          </div>
        </div>
      )}

      {(phases.length > 0 || error) && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_1fr]">
          <section aria-label="Investigation plan" className="h-fit rounded-xl border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">Agent investigation</h2>
              <span className="text-sm tabular-nums text-muted">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
            </div>
            <ol className="mt-4 space-y-4" aria-live="polite">
              {phases.map((p) => (
                <li key={p.id} className="flex gap-3">
                  <span className="mt-1"><StatusIcon status={p.status} /></span>
                  <span>
                    <span className={`block text-sm ${p.status === "pending" ? "text-muted" : "font-medium"}`}>{p.label}</span>
                    <span className="block text-xs text-muted">{STATUS_TEXT[p.status]}{p.detail ? `: ${p.detail}` : ""}</span>
                  </span>
                </li>
              ))}
            </ol>
            {done && (
              <div className="mt-5 rounded-lg bg-ok-soft p-3 text-sm">
                <p className="font-medium text-ok">Guide ready. Opening it now…</p>
                <Link href={done.url} className="mt-1 inline-block text-sea underline underline-offset-2">Open the guide</Link>
              </div>
            )}
            {error && !running && (
              <div className="mt-5 rounded-lg bg-block-soft p-3 text-sm">
                <p className="font-medium text-block">The investigation stopped.</p>
                <p className="mt-1">{error}</p>
                <button type="button" onClick={() => start(query, true)} className="mt-2 text-sea underline underline-offset-2">Run it again</button>
              </div>
            )}
          </section>

          <section aria-label="Live activity" className={`min-w-0 rounded-xl border border-line bg-surface ${activity.length === 0 && !running ? "hidden" : ""}`}>
            <h2 className="border-b border-line px-5 py-3 text-sm font-medium">What the agent is doing</h2>
            <ol ref={feedRef} className="max-h-[32rem] space-y-0 overflow-y-auto">
              {activity.map((a, i) => (
                <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-line/60 px-5 py-2.5 text-sm last:border-0">
                  <span className={`text-xs font-medium ${a.kind === "probe" ? (a.ok ? "text-ok" : "text-wait") : a.kind === "error" ? "text-block" : a.kind === "note" ? "text-muted" : "text-sea"}`}>
                    {a.kind === "search" ? "Search" : a.kind === "read" ? "Read" : a.kind === "probe" ? "Probe" : a.kind === "error" ? "Error" : "Thinking"}
                  </span>
                  <span className="min-w-0">
                    <span className={`block break-words ${a.kind === "note" ? "text-muted" : ""}`}>{a.kind === "search" ? `“${a.text}”` : a.text}</span>
                    {a.sub && <span className="block break-all text-xs text-muted">{a.sub}</span>}
                  </span>
                </li>
              ))}
              {running && (
                <li className="px-5 py-3 text-sm text-muted">
                  <span className="live-dot mr-2 inline-block h-2 w-2 rounded-full bg-sea align-middle" aria-hidden />
                  Working…
                </li>
              )}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
