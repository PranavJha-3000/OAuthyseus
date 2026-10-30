import { curatedGuides } from "@/lib/guides";
import { recentGenerated } from "@/lib/store";
import { toHours } from "@/lib/duration";
import type { Guide } from "@/lib/types";
import { Library, type LibraryItem } from "@/components/Library";
import { LEVEL, LevelGlyph } from "@/components/marks";

export const dynamic = "force-dynamic";

function toItem(g: Guide): LibraryItem {
  // The bar shows the guide's default path (what most agent builders need), matching its headline.
  const waits = g.paths.map((p) => p.approvalWait).filter((w): w is NonNullable<typeof w> => !!w);
  const maxWait = waits.sort((a, b) => toHours(b) - toHours(a))[0] ?? null;
  return {
    href: g.origin === "curated" ? `/guides/${g.slug}` : `/g/${g.slug}`,
    name: g.name,
    website: g.website,
    category: g.category,
    brandColor: g.brandColor,
    origin: g.origin,
    difficulty: g.verdict.difficulty,
    headline: g.verdict.headline,
    active: g.effort.activeTime,
    wait: g.effort.approvalWait,
    maxWait,
    updatedAt: g.updatedAt,
  };
}

export default async function Home() {
  const curated = curatedGuides().map(toItem);
  const generated = (await recentGenerated(8)).map(toItem);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="pt-14 pb-10 sm:pt-20">
        <h1 className="max-w-4xl font-display text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-7xl">
          How long until your users can connect?
        </h1>
        <p className="mt-6 max-w-[62ch] text-lg text-muted">
          Before your agent can act on someone's Gmail, Slack or Notion, you register an OAuth app with that provider, and
          sometimes wait weeks for it to be approved. Look up a provider to see the real route: your hands-on work, the
          provider's review, what can block you, and which parts an agent can do for you.
        </p>
      </section>

      <Library curated={curated} generated={generated} />

      <section className="mt-16 grid gap-8 border-t border-line pt-10 md:grid-cols-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Every claim says how we know</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(Object.keys(LEVEL) as Array<keyof typeof LEVEL>).map((l) => (
              <li key={l} className="flex gap-2">
                <span className="mt-1.5"><LevelGlyph level={l} /></span>
                <span><strong>{LEVEL[l].label}.</strong> <span className="text-muted">{LEVEL[l].long}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold">Not listed? Investigate it live</h2>
          <p className="mt-3 text-sm text-muted">
            Type any app name or website. An agent finds the official developer docs, works out registration and review
            rules, probes the live console and OAuth endpoints, then writes a guide in the same format, with a link you can share.
            Quotes it cites are checked against the pages it read; any it can't back up are downgraded.
          </p>
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold">Point me at the button</h2>
          <p className="mt-3 text-sm text-muted">
            Provider consoles are where people get lost. The pointer extension opens the console in your own signed-in
            browser and highlights the exact button or field for each step. If a provider has changed its UI, it falls back
            to finding the element from a screenshot.
          </p>
        </div>
      </section>
    </div>
  );
}
