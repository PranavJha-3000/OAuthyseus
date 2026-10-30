import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { curatedGuide, curatedGuides } from "@/lib/guides";
import { GuideView } from "@/components/GuideView";

export function generateStaticParams() {
  return curatedGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = curatedGuide((await params).slug);
  return g ? { title: `${g.name} OAuth setup`, description: g.verdict.headline } : {};
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = curatedGuide(slug);
  if (!guide) notFound();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return <GuideView guide={guide} shareUrl={`${origin}/guides/${slug}`} />;
}
