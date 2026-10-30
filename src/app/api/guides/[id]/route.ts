import { anyGuide } from "@/lib/guides";

export const dynamic = "force-dynamic";

// JSON for agents and the pointer extension. Public, read-only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guide = await anyGuide((await params).id);
  if (!guide) return Response.json({ error: "Guide not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  return Response.json(guide, { headers: { "Access-Control-Allow-Origin": "*" } });
}
