"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Guide, GuideStep } from "@/lib/types";
import { formatDuration } from "@/lib/duration";
import { DifficultyMark, EvidenceMark, LEVEL, LevelGlyph } from "./marks";
import { RouteBar } from "./RouteBar";
import { WalkthroughButton } from "./WalkthroughButton";
import { collectEvidence } from "@/lib/agent/ground";

const ACTOR: Record<GuideStep["actor"], { label: string; cls: string }> = {
  you: { label: "You do this", cls: "border-ink/30 text-ink" },
  agent: { label: "An agent can do this", cls: "border-ok text-ok bg-ok-soft" },
  both: { label: "Agent prepares, you submit", cls: "border-sea text-sea bg-sea-soft" },
};

function Section({ id, title, children, aside }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Avatar({ guide, size = 48 }: { guide: Guide; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-display font-bold text-white ring-1 ring-line"
      style={{ width: size, height: size, background: guide.brandColor || "var(--sea)", fontSize: size * 0.45 }}
    >
      {guide.name.trim()[0]?.toUpperCase()}
    </span>
  );
}

export { Avatar };

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-sea hover:text-ink"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function GuideView({ guide, shareUrl }: { guide: Guide; shareUrl: string }) {
  const [pathId, setPathId] = useState<string>("all");
  const [copied, setCopied] = useState(false);
  const S = guide.sources;

  const steps = useMemo(
    () => guide.steps.filter((s) => pathId === "all" || s.pathIds.length === 0 || s.pathIds.includes(pathId)),
    [guide.steps, pathId],
  );
  const requirements = guide.requirements.filter((r) => pathId === "all" || r.neededFor.length === 0 || r.neededFor.includes(pathId));
  const selectedPath = guide.paths.find((p) => p.id === pathId);

  const counts = useMemo(() => {
    const c = { tested: 0, documented: 0, inferred: 0, unverified: 0 };
    collectEvidence({ ...guide, sources: [], investigation: undefined }).forEach((e) => c[e.level]++);
    return c;
  }, [guide]);

  const pointerSteps = guide.steps.filter((s) => s.pointer);

  return (
    <article className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pt-8">
        <div className="flex items-center gap-4">
          <Avatar guide={guide} />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{guide.name}</h1>
            <p className="text-sm text-muted">
              {guide.origin === "curated" ? "Curated guide, researched and checked" : "Generated live by the investigation agent"}
              {", updated "}
              {guide.updatedAt}
              {" · "}
              <a href={guide.website} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {guide.website.replace(/^https?:\/\//, "")}
              </a>
            </p>
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(shareUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm hover:border-sea"
          >
            {copied ? "Link copied" : "Copy share link"}
          </button>
          <a href={`/api/guides/${guide.slug}/markdown`} className="rounded-md border border-line bg-surface px-3 py-2 text-sm hover:border-sea">
            Download Markdown
          </a>
          {pointerSteps.length > 0 && <WalkthroughButton guide={guide} />}
        </div>
      </div>

      {/* Verdict */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <DifficultyMark difficulty={guide.verdict.difficulty} size="lg" />
            <EvidenceMark evidence={guide.verdict.evidence} sources={S} />
          </div>
          <p className="mt-3 max-w-3xl font-display text-2xl leading-snug tracking-tight sm:text-[1.7rem]">{guide.verdict.headline}</p>
          <p className="mt-4 max-w-[70ch] text-muted">{guide.summary}</p>
          {/* Routes */}
          <section className="mt-8 rounded-xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">How long until your users can connect</h2>
              <span className="text-sm text-muted">Depends on who connects and what you ask for</span>
            </div>
            <div className="mt-5">
              <RouteBar active={selectedPath?.activeTime ?? guide.effort.activeTime} wait={selectedPath ? selectedPath.approvalWait : guide.effort.approvalWait} />
            </div>
            <p className="mt-3 text-sm text-muted">
              {selectedPath ? selectedPath.whatChanges : guide.effort.approvalNote} <EvidenceMark evidence={selectedPath?.evidence ?? guide.effort.evidence} sources={S} />
            </p>
            <div className="mt-6" role="radiogroup" aria-label="Choose your launch path">
              <p className="mb-2 text-sm font-medium">Choose your launch path to filter the steps</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <PathOption active={pathId === "all"} onSelect={() => setPathId("all")} title="Show everything" sub="All steps across every path" />
                {guide.paths.map((p) => (
                  <PathOption
                    key={p.id}
                    active={pathId === p.id}
                    onSelect={() => setPathId(p.id)}
                    title={p.name}
                    sub={p.when}
                    right={
                      <span className="flex flex-col items-end gap-1">
                        <DifficultyMark difficulty={p.difficulty} />
                        <span className="text-xs text-muted">
                          {formatDuration(p.activeTime)}
                          {p.approvalWait ? ` + ${formatDuration(p.approvalWait)} wait` : ", no wait"}
                        </span>
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
        <aside className="h-fit rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-6">
          <h2 className="font-display text-lg font-semibold">Where you'll need to take over</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {guide.youMust.slice(0, 5).map((t) => (
              <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />{t}</li>
            ))}
          </ul>
          <h3 className="mt-5 font-display text-base font-semibold">What an agent can do for you</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {guide.agentCan.slice(0, 5).map((t) => (
              <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />{t}</li>
            ))}
          </ul>
        </aside>
      </div>


      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_17rem]">
        <div className="min-w-0 space-y-10">
          <Section id="next" title="Do these first">
            <ol className="space-y-3">
              {guide.nextActions.map((a, i) => (
                <li key={a} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper">{i + 1}</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="model" title="What you're actually registering" aside={<EvidenceMark evidence={guide.appModel.evidence} sources={S} />}>
            <p className="max-w-[70ch]">
              <strong>{guide.appModel.providerTerm}.</strong> {guide.appModel.explanation}
            </p>
            <p className="mt-3 max-w-[70ch] text-muted">{guide.appModel.tokenNotes}</p>
          </Section>

          <Section id="requirements" title="What you'll need" aside={selectedPath && <span className="text-sm text-muted">For: {selectedPath.name}</span>}>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {requirements.map((r) => (
                <li key={r.item} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.item}</span>
                    <EvidenceMark evidence={r.evidence} sources={S} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{r.detail}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="steps" title="Step by step" aside={<span className="text-sm text-muted">{steps.length} steps</span>}>
            <ol className="space-y-6">
              {steps.map((s, i) => (
                <li key={s.id} id={`step-${s.id}`} className="rounded-xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="font-display text-2xl font-bold text-sea tabular-nums">{i + 1}</span>
                      <div>
                        <h3 className="font-display text-lg font-semibold leading-tight">{s.title}</h3>
                        <p className="mt-1 text-sm text-muted">About {formatDuration(s.duration)}</p>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${ACTOR[s.actor].cls}`} title={s.actorNote}>
                      {ACTOR[s.actor].label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{s.actorNote}</p>
                  <ol className="mt-4 list-decimal space-y-2 pl-5 marker:text-muted">
                    {s.instructions.map((ins) => (
                      <li key={ins}>{ins}</li>
                    ))}
                  </ol>
                  {s.values && s.values.length > 0 && (
                    <dl className="mt-4 space-y-2 rounded-lg bg-sunken p-3 text-sm">
                      {s.values.map((v) => (
                        <div key={v.field + v.value} className="flex flex-wrap items-center gap-2">
                          <dt className="min-w-32 text-muted">{v.field}</dt>
                          <dd className="flex min-w-0 flex-1 items-center gap-2">
                            <code className="min-w-0 flex-1 break-all font-mono text-[0.82rem]">{v.value}</code>
                            <CopyValue value={v.value} />
                          </dd>
                          {v.note && <dd className="w-full text-xs text-muted">{v.note}</dd>}
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <EvidenceMark evidence={s.evidence} sources={S} />
                    {s.links.map((l) => (
                      <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-sea underline underline-offset-2">
                        {l.label}
                      </a>
                    ))}
                    {s.pointer && (
                      <span className="text-xs text-muted">Pointer ready: highlights “{s.pointer.targets[0]?.text}”</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="blockers" title="What can block you, and the way around">
            <ul className="space-y-3">
              {guide.blockers.map((b) => (
                <li key={b.title} className="rounded-xl border border-line bg-surface p-4" style={{ borderLeft: `4px solid ${b.severity === "high" ? "var(--block)" : b.severity === "medium" ? "var(--wait)" : "var(--line)"}` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{b.title}</span>
                    <EvidenceMark evidence={b.evidence} sources={S} />
                  </div>
                  <p className="mt-1 text-sm"><span className="text-muted">You'll see: </span>{b.symptom}</p>
                  <p className="mt-1 text-sm"><span className="text-muted">Do this: </span>{b.fix}</p>
                </li>
              ))}
            </ul>
          </Section>

          {guide.investigation && <InvestigationPanel guide={guide} />}

          <Section id="verification" title="What we checked">
            <div className="mb-4 flex flex-wrap gap-4 text-sm">
              {(Object.keys(counts) as Array<keyof typeof counts>).map((l) => (
                <span key={l} className="inline-flex items-center gap-1.5">
                  <LevelGlyph level={l} /> {counts[l]} {LEVEL[l].label.toLowerCase()}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
              {guide.verificationLog.map((v, i) => (
                <li key={i} className="grid gap-1 p-4 sm:grid-cols-[7rem_1fr]">
                  <span
                    className={`h-fit w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                      v.result === "confirmed" ? "bg-ok-soft text-ok" : v.result === "corrected" ? "bg-wait-soft text-wait" : "bg-sunken text-muted"
                    }`}
                  >
                    {v.result === "confirmed" ? "Confirmed" : v.result === "corrected" ? "Corrected" : "Couldn't verify"}
                  </span>
                  <span>
                    <span className="font-medium">{v.check}</span>
                    <span className="block text-muted">{v.detail}</span>
                    <span className="block text-xs text-muted">
                      {v.method === "http-probe" ? "Live HTTP probe" : v.method === "doc-review" ? "Read against official docs" : v.method === "console-walkthrough" ? "Walked through the real console" : "Agent output compared with curated guide"}
                      {", "}
                      {v.date}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {guide.uncertainties.length > 0 && (
            <Section id="unknowns" title="What we couldn't confirm">
              <ul className="space-y-2">
                {guide.uncertainties.map((u) => (
                  <li key={u} className="flex gap-2"><span className="mt-1"><LevelGlyph level="unverified" /></span>{u}</li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="sources" title="Sources">
            <ol className="space-y-1.5 text-sm">
              {guide.sources.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span className="w-7 shrink-0 text-muted tabular-nums">{s.id}</span>
                  <span className="min-w-0">
                    <a href={s.url} target="_blank" rel="noreferrer" className="break-words text-sea underline underline-offset-2">{s.title}</a>
                    <span className="text-muted"> ({s.kind.replace("official-", "official ")}, accessed {s.accessed})</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <nav aria-label="On this page" className="no-print hidden lg:block">
          <div className="sticky top-6 space-y-1 text-sm">
            <p className="mb-2 font-medium">On this page</p>
            {[
              ["next", "Do these first"],
              ["model", "What you're registering"],
              ["requirements", "What you'll need"],
              ["steps", "Step by step"],
              ["blockers", "Blockers"],
              ...(guide.investigation ? [["investigation", "Agent investigation"]] : []),
              ["verification", "What we checked"],
              ["unknowns", "Unknowns"],
              ["sources", "Sources"],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block text-muted hover:text-sea">{label}</a>
            ))}
            <div className="mt-6 rounded-lg border border-line p-3 text-xs text-muted">
              <p className="mb-1 font-medium text-ink">Reading the evidence marks</p>
              {(Object.keys(LEVEL) as Array<keyof typeof LEVEL>).map((l) => (
                <p key={l} className="mt-1.5 flex gap-1.5"><span className="mt-1"><LevelGlyph level={l} /></span><span><strong className="text-ink">{LEVEL[l].label}:</strong> {LEVEL[l].long}</span></p>
              ))}
              <Link href="/method" className="mt-2 block text-sea underline underline-offset-2">How we verify</Link>
            </div>
          </div>
        </nav>
      </div>
    </article>
  );
}

function PathOption({ active, onSelect, title, sub, right }: { active: boolean; onSelect: () => void; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${active ? "border-sea bg-sea-soft" : "border-line hover:border-sea"}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{sub}</span>
      </span>
      {right}
    </button>
  );
}

function InvestigationPanel({ guide }: { guide: Guide }) {
  const inv = guide.investigation!;
  const secs = Math.round((new Date(inv.finishedAt).getTime() - new Date(inv.startedAt).getTime()) / 1000);
  return (
    <Section id="investigation" title="How the agent investigated this" aside={<span className="text-sm text-muted">{Math.floor(secs / 60)}m {secs % 60}s, {inv.model}</span>}>
      <ol className="space-y-2 text-sm">
        {inv.phases.map((p) => (
          <li key={p.id} className="flex gap-3">
            <span className={`w-20 shrink-0 text-xs font-medium ${p.status === "done" ? "text-ok" : p.status === "partial" ? "text-wait" : p.status === "failed" ? "text-block" : "text-muted"}`}>
              {p.status === "done" ? "Completed" : p.status === "partial" ? "Partial" : p.status === "skipped" ? "Skipped" : p.status === "failed" ? "Failed" : p.status}
            </span>
            <span>{p.label}{p.detail && <span className="text-muted">: {p.detail}</span>}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="font-medium">Searches ({inv.searches.length})</p>
          <ul className="mt-2 space-y-1 text-muted">{inv.searches.map((q) => <li key={q}>“{q}”</li>)}</ul>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="font-medium">Pages read ({inv.pagesRead.length})</p>
          <ul className="mt-2 space-y-1">{inv.pagesRead.map((u) => <li key={u} className="truncate"><a href={u} className="text-sea underline underline-offset-2" target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, "")}</a></li>)}</ul>
        </div>
      </div>
      {inv.probes.length > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="font-medium">Live probes (no credentials used)</p>
          <ul className="mt-2 space-y-2">
            {inv.probes.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1"><LevelGlyph level={p.ok ? "tested" : "unverified"} /></span>
                <span><code className="break-all font-mono text-xs">{p.url}</code><span className="block text-muted">{p.summary}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
