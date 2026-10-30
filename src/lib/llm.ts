// Which model powers the agent. Free-tier friendly: any OpenAI-compatible chat API works
// (Gemini, Groq, OpenRouter, Cerebras, a local server). Anthropic is used when its key is set.

export type LlmConfig =
  | { kind: "anthropic"; label: string; model: string }
  | { kind: "openai"; label: string; baseUrl: string; apiKey: string; model: string | null };

export function llmConfig(): LlmConfig | null {
  const env = process.env;
  if (env.LLM_BASE_URL && env.LLM_API_KEY) {
    return { kind: "openai", label: "Custom", baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL ?? null };
  }
  if (env.GEMINI_API_KEY) {
    return { kind: "openai", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? null };
  }
  if (env.GROQ_API_KEY) {
    return { kind: "openai", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? "openai/gpt-oss-120b" };
  }
  if (env.OPENROUTER_API_KEY) {
    return { kind: "openai", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL ?? null };
  }
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return { kind: "anthropic", label: "Anthropic", model: "claude-opus-5-5" };
  return null;
}

// ---- OpenAI-compatible chat completions ----

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  [extra: string]: unknown; // providers attach extras (e.g. Gemini thought signatures) that must be echoed back
}

export type ChatMessage =
  | { role: "system" | "user"; content: string | Array<Record<string, unknown>> }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[]; [extra: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const modelCache = new Map<string, string>();

/** Pick a model when none is configured: newest non-lite Flash on Gemini, a free model on OpenRouter. */
export async function resolveModel(cfg: Extract<LlmConfig, { kind: "openai" }>): Promise<string> {
  if (cfg.model) return cfg.model;
  const cached = modelCache.get(cfg.baseUrl);
  if (cached) return cached;
  const res = await fetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  if (!res.ok) throw new Error(`${cfg.label}: could not list models (HTTP ${res.status}). Set ${cfg.label.toUpperCase()}_MODEL.`);
  const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id.replace(/^models\//, ""));
  let pick: string | undefined;
  if (cfg.label === "Gemini") {
    const flash = ids
      .filter((id) => /^gemini-\d+(\.\d+)?-flash(-latest)?$/.test(id))
      .sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
    pick = flash[0] ?? ids.find((id) => id.includes("flash") && !/lite|image|tts|audio|live/.test(id));
  } else if (cfg.label === "OpenRouter") {
    pick = ids.find((id) => id.endsWith(":free") && /gpt-oss|deepseek|qwen|llama/.test(id)) ?? ids.find((id) => id.endsWith(":free"));
  }
  if (!pick) throw new Error(`${cfg.label}: no suitable model found. Set ${cfg.label.toUpperCase()}_MODEL.`);
  modelCache.set(cfg.baseUrl, pick);
  return pick;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** One chat completion with retries for free-tier rate limits (429) and transient 5xx. */
export async function chat(
  cfg: Extract<LlmConfig, { kind: "openai" }>,
  body: { messages: ChatMessage[]; tools?: ChatTool[]; json?: boolean; maxTokens?: number },
  opts: { signal?: AbortSignal; onWait?: (seconds: number) => void } = {},
): Promise<{ message: Extract<ChatMessage, { role: "assistant" }>; finishReason: string; model: string }> {
  const model = await resolveModel(cfg);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        messages: body.messages,
        ...(body.tools ? { tools: body.tools, tool_choice: "auto" } : {}),
        ...(body.json ? { response_format: { type: "json_object" } } : {}),
        max_tokens: body.maxTokens ?? 16000,
      }),
      signal: opts.signal ?? AbortSignal.timeout(180_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { choices: Array<{ message: Extract<ChatMessage, { role: "assistant" }>; finish_reason: string }> };
      const choice = j.choices?.[0];
      if (!choice) throw new LlmError(`${cfg.label} returned no choices.`);
      return { message: choice.message, finishReason: choice.finish_reason, model };
    }
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      throw new LlmError(`${cfg.label} (${model}) HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    const header = Number(res.headers.get("retry-after"));
    const hinted = Number(text.match(/retry in ([\d.]+)s/i)?.[1] ?? text.match(/"retryDelay":\s*"(\d+)s"/)?.[1]);
    const wait = Math.min(60, header || hinted || 5 * 2 ** attempt);
    opts.onWait?.(Math.ceil(wait));
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}
