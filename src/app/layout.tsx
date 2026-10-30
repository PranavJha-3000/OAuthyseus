import type { Metadata } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OAuthyseus: OAuth app setup guides", template: "%s · OAuthyseus" },
  description:
    "How long until your users can connect? Evidence-backed guides for registering and getting OAuth apps approved, plus an agent that investigates any app live.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${publicSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
            <Link href="/" className="flex items-baseline gap-2" aria-label="OAuthyseus home">
              <span className="font-display text-xl font-bold tracking-tight">OAuthyseus</span>
              <span className="hidden text-sm text-muted lg:inline">the long way home, mapped</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <Link href="/#library" className="hover:text-sea">Library</Link>
              <Link href="/investigate" className="hover:text-sea">Investigate an app</Link>
              <Link href="/extension" className="hover:text-sea">Pointer extension</Link>
              <Link href="/method" className="hidden hover:text-sea sm:inline">How we verify</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-24 border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted sm:px-6">
            Guides describe provider processes as researched on the date shown. Providers change their rules; every claim
            links to its source and says how it was checked.
          </div>
        </footer>
      </body>
    </html>
  );
}
