import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Console pointer extension" };

export default function ExtensionPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Point me at the button</h1>
      <p className="mt-4 text-lg text-muted">
        Most people don't get stuck on what OAuth is. They get stuck in the provider's console, hunting for the menu where
        redirect URIs live. The pointer runs in your own signed-in browser, so it never sees or needs your password, and it
        highlights the exact control for each step of a guide.
      </p>

      <h2 className="mt-10 font-display text-2xl font-semibold">Install it (about a minute)</h2>
      <ol className="mt-4 list-decimal space-y-3 pl-5">
        <li>
          Get the <code className="font-mono text-sm">extension</code> folder from the{" "}
          <a className="text-sea underline underline-offset-2" href="https://github.com/">source repository</a>.
        </li>
        <li>In Chrome, open <code className="font-mono text-sm">chrome://extensions</code> and turn on Developer mode (top right).</li>
        <li>Click <strong>Load unpacked</strong> and choose the <code className="font-mono text-sm">extension</code> folder.</li>
        <li>Reload this site. Guide pages now show <strong>Walk me through it in the console</strong>.</li>
      </ol>

      <h2 className="mt-10 font-display text-2xl font-semibold">How it works</h2>
      <ul className="mt-4 space-y-3">
        <li>
          <strong>Label matching first.</strong> Every console step in a guide lists the exact visible labels to act on
          (“Create credentials”, “OAuth &amp; Permissions”). The pointer finds those on the live page, dims everything else and
          rings the element. Click it and the ring moves to the next one.
        </li>
        <li>
          <strong>Screenshot fallback.</strong> Providers rename things. If a label isn't found, press{" "}
          <strong>Point for me</strong>: the extension screenshots the visible tab and asks the vision model to find the closest match,
          or to tell you that you're on the wrong page. Screenshots are only taken when you press the button.
        </li>
        <li>
          <strong>Works on agent-generated guides too.</strong> For consoles outside the built-in list, open the console and
          click the OAuthseus toolbar icon. That grants access to that one tab only.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-2xl font-semibold">What it won't do</h2>
      <p className="mt-3 text-muted">
        It never types passwords, clicks submit for you, or accepts terms. Those steps are yours by design: they're the
        points where a provider is asking a human to take responsibility.
      </p>

      <p className="mt-10">
        <Link href="/guides/google" className="text-sea underline underline-offset-2">Try it with the Google guide</Link>
      </p>
    </div>
  );
}
