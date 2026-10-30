import { anyGuide } from "@/lib/guides";
import { guideToMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guide = await anyGuide(id);
  if (!guide) return new Response("Guide not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const url = guide.origin === "curated" ? `${origin}/guides/${id}` : `${origin}/g/${id}`;
  return new Response(guideToMarkdown(guide, url), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}-oauth-guide.md"`,
    },
  });
}
