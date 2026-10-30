import type { Metadata } from "next";
import { InvestigateLive } from "@/components/InvestigateLive";

export const metadata: Metadata = { title: "Investigate an app" };

export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <InvestigateLive initialQuery={(q ?? "").slice(0, 200)} />;
}
