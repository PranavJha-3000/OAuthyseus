import type { Metadata } from "next";
import { LEVEL, LevelGlyph } from "@/components/marks";

export const metadata: Metadata = { title: "How we verify" };

export default function MethodPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">How we verify</h1>
      <p className="mt-4 text-lg text-muted">
        A guide that's confidently wrong costs a developer weeks. So every claim carries a mark saying how we know it,
        and the parts we couldn't confirm are listed, not hidden.
      </p>

      <h2 className="mt-10 font-display text-2xl font-semibold">The four evidence levels</h2>
      <ul className="mt-4 space-y-4">
        {(Object.keys(LEVEL) as Array<keyof typeof LEVEL>).map((l) => (
          <li key={l} className="flex gap-3">
            <span className="mt-1.5"><LevelGlyph level={l} /></span>
            <span><strong>{LEVEL[l].label}.</strong> {LEVEL[l].long}.</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 font-display text-2xl font-semibold">What the agent actually tests</h2>
      <p className="mt-3">Without anyone's credentials, the agent can still check real things:</p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>That the developer console exists, and that it sits behind sign-in (where you take over).</li>
        <li>The OpenID Connect discovery document: real endpoints, PKCE support and advertised scopes.</li>
        <li>The authorize endpoint, called with a fake client ID. A live endpoint rejects it in a recognisable way.</li>
        <li>That the documentation pages it cites load.</li>
      </ul>
      <p className="mt-3 text-muted">
        It does not create accounts, sign in, or submit apps for review. Approval timelines therefore come from published
        provider statements or, where none exist, community reports clearly marked unverified.
      </p>

      <h2 className="mt-10 font-display text-2xl font-semibold">Quotes are checked mechanically</h2>
      <p className="mt-3">
        When the agent marks a claim as documented, it must include a short verbatim quote from an official page it fetched.
        After the guide is written, code searches the fetched page text for that quote. If it isn't there, the claim is
        downgraded to inferred and the guide's verification log says so. Claims marked tested must cite a probe that
        actually ran.
      </p>

      <h2 className="mt-10 font-display text-2xl font-semibold">Curated guides</h2>
      <p className="mt-3">
        Library guides were researched by agents against official docs, then checked: each quote was matched against its
        source page, URLs were probed, and the agent's output for the same provider was compared with the curated version.
        Each guide's “What we checked” section lists the checks and anything we corrected.
      </p>
    </div>
  );
}
