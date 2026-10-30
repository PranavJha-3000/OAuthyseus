import { runInvestigation } from "@/lib/agent/investigate";
import { matchCurated } from "@/lib/guides";
import { saveGenerated } from "@/lib/store";
import { llmConfig } from "@/lib/llm";
import type { InvestigationEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { query, force } = (await req.json().catch(() => ({}))) as { query?: string; force?: boolean };
  const q = (query ?? "").trim().slice(0, 200);
  if (q.length < 2) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  if (!llmConfig()) {
    return Response.json(
      { error: "Live investigation needs a model key on the server. Set GEMINI_API_KEY (free tier), GROQ_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: InvestigationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // client went away
        }
      };
      // Keep proxies from closing a quiet connection while the model thinks.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {}
      }, 15_000);
      try {
        const existing = force ? undefined : matchCurated(q);
        if (existing) {
          send({ type: "match", slug: existing.slug, name: existing.name });
        } else {
          const guide = await runInvestigation(q, send, abort.signal);
          await saveGenerated(guide);
          send({ type: "done", id: guide.slug, url: `/g/${guide.slug}` });
        }
      } catch (err) {
        console.error("investigation failed", err);
        send({ type: "error", message: (err as Error).message || "Investigation failed." });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
