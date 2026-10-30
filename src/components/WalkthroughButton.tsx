"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Guide } from "@/lib/types";

// The pointer extension marks the page when installed and listens for this message.
export function WalkthroughButton({ guide }: { guide: Guide }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const check = () => setInstalled(document.documentElement.dataset.oauthseusExt === "installed");
    check();
    const t = setTimeout(check, 600);
    return () => clearTimeout(t);
  }, []);

  if (installed === false) {
    return (
      <Link href="/extension" className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90">
        Get the console pointer
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        window.postMessage({ source: "oauthseus-page", type: "start-walkthrough", guide }, window.location.origin);
        setStarted(true);
      }}
      className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"
    >
      {started ? "Walkthrough started in a new tab" : "Walk me through it in the console"}
    </button>
  );
}
