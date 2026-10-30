import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { loadGenerated } from "@/lib/store";
import { GuideView } from "@/components/GuideView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const g = await loadGenerated((await params).id);
  return g ? { title: `${g.name} OAuth setup (agent-generated)`, description: g.verdict.headline } : {};
}

export default async function GeneratedGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guide = await loadGenerated(id);
  if (!guide) notFound();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return (
    <>
      <div className="border-b border-line bg-sea-soft">
        <p className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6">
          An agent researched and wrote this guide in one live session. Its claims are marked with how they were checked; the
          agent could not sign in to provider consoles.
        </p>
      </div>
      <GuideView guide={guide} shareUrl={`${origin}/g/${id}`} />
    </>
  );
}
