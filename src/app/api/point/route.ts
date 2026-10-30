import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/agent/investigate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vision fallback for the pointer extension: find the element for a step on a screenshot
// of the developer's own console tab. Only called when the user clicks "Point for me".

const Body = z.object({
  image: z.string().max(6_000_000), // base64 JPEG, no data: prefix
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  step: z.object({
    title: z.string().max(300),
    instructions: z.array(z.string().max(600)).max(20),
    targets: z.array(z.object({ text: z.string().max(200), kind: z.string().max(20), hint: z.string().max(400) })).max(10),
  }),
});

const PointResult = z.object({
  found: z.boolean(),
  x: z.number().describe("x pixel of the element centre in the screenshot"),
  y: z.number().describe("y pixel of the element centre in the screenshot"),
  label: z.string().describe("visible text of the element you chose"),
  explanation: z.string().describe("one short sentence telling the developer what to do with it"),
  wrongPage: z.boolean().describe("true if this screen is not where the step happens"),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: CORS });
  const { image, width, height, step } = parsed.data;
  const client = new Anthropic();

  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(PointResult) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            {
              type: "text",
              text: `This is a ${width}x${height} screenshot of a developer console. The developer is on this step of an OAuth app setup guide:

Step: ${step.title}
Instructions:
${step.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Elements we expected to find: ${step.targets.map((t) => `"${t.text}" (${t.kind}: ${t.hint})`).join("; ")}

Find the single element the developer should interact with next for this step. Return its centre in screenshot pixels. If the labels differ slightly (the provider renamed something), pick the closest equivalent and say so. If this screen is clearly not where this step happens, set wrongPage true and explain where to go. If nothing fits, set found false.`,
            },
          ],
        },
      ],
    });
    const out = res.parsed_output;
    if (!out) return Response.json({ error: "No answer from the model." }, { status: 502, headers: CORS });
    return Response.json(
      { ...out, x: Math.max(0, Math.min(width, out.x)) / width, y: Math.max(0, Math.min(height, out.y)) / height },
      { headers: CORS },
    );
  } catch (err) {
    console.error("point failed", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
}
