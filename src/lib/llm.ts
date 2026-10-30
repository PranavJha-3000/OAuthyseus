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

// Ordered candidates per endpoint, plus the index of the one that last worked.
// Free-tier quotas and overload are per model, so moving to the next model beats waiting.
const candidateCache = new Map<string, { models: string[]; current: number }>();

function versionOf(id: string): number {
  return parseFloat(id.match(/-(\d+(?:\.\d+)?)-/)?.[1] ?? "0");
}

async function candidates(cfg: Extract<LlmConfig, { kind: "openai" }>): Promise<{ models: string[]; current: number }> {
  const cached = candidateCache.get(cfg.baseUrl);
  if (cached) return cached;
  let models: string[] = [];
  if (cfg.model) models = [cfg.model];
  else {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${cfg.label}: could not list models (HTTP ${res.status}). Set ${cfg.label.toUpperCase()}_MODEL.`);
    const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id.replace(/^models\//, ""));
    if (cfg.label === "Gemini") {
      // Full Flash models newest first, then the rolling alias, then Flash-Lite as a last resort.
      const flash = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id)).sort((a, b) => versionOf(b) - versionOf(a));
      const lite = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(id)).sort((a, b) => versionOf(b) - versionOf(a));
      models = [...flash.slice(0, 4), ...ids.filter((id) => id === "gemini-flash-latest"), ...lite.slice(0, 2)];
    } else if (cfg.label === "OpenRouter") {
      const free = ids.filter((id) => id.endsWith(":free"));
      models = [...free.filter((id) => /gpt-oss|deepseek|qwen|llama/.test(id)), ...free].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    }
  }
  if (models.length === 0) throw new Error(`${cfg.label}: no suitable model found. Set ${cfg.label.toUpperCase()}_MODEL.`);
  const entry = { models, current: 0 };
  candidateCache.set(cfg.baseUrl, entry);
  return entry;
}

/** The model the next request will use. */
export async function resolveModel(cfg: Extract<LlmConfig, { kind: "openai" }>): Promise<string> {
  const c = await candidates(cfg);
  return c.models[c.current];
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

// When each model may be tried again (epoch ms). Free-tier limits are per model.
const cooldownUntil = new Map<string, number>();

/**
 * One chat completion. A rate-limited (429), overloaded (503), retired (404) or unresponsive
 * model is put on cooldown and the next candidate is used immediately; we only wait when every
 * candidate is cooling down.
 */
export async function chat(
  cfg: Extract<LlmConfig, { kind: "openai" }>,
  body: { messages: ChatMessage[]; tools?: ChatTool[]; json?: boolean; maxTokens?: number; effort?: "low" | "medium" | "high"; timeoutMs?: number; avoidLite?: boolean },
  opts: { signal?: AbortSignal; onWait?: (seconds: number) => void; onSwitch?: (from: string, to: string, why: string) => void } = {},
): Promise<{ message: Extract<ChatMessage, { role: "assistant" }>; finishReason: string; model: string }> {
  const c = await candidates(cfg);
  const pool = c.models.filter((m) => !body.avoidLite || !/lite/.test(m));
  const usable = pool.length > 0 ? pool : c.models;
  let lastError = "";
  let waited = 0;
  for (let tries = 0; tries < usable.length * 3; tries++) {
    if (opts.signal?.aborted) throw new Error("cancelled");
    const now = Date.now();
    let model = c.models[c.current];
    if (!usable.includes(model) || (cooldownUntil.get(model) ?? 0) > now) {
      const ready = usable.find((m) => (cooldownUntil.get(m) ?? 0) <= now);
      if (!ready) {
        const soonest = Math.min(...usable.map((m) => cooldownUntil.get(m) ?? 0));
        const wait = Math.max(1, Math.ceil((soonest - now) / 1000));
        if (waited + wait > 150) break;
        opts.onWait?.(wait);
        await new Promise((r) => setTimeout(r, wait * 1000));
        waited += wait;
        continue;
      }
      if (ready !== model) opts.onSwitch?.(model, ready, (cooldownUntil.get(model) ?? 0) > now ? "cooling down" : "not suited to this step");
      model = ready;
      c.current = c.models.indexOf(ready);
    }

    // Overloaded models sometimes hold the connection instead of answering 503, so cap each call.
    const timeout = AbortSignal.timeout(body.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model,
          messages: body.messages,
          ...(body.tools ? { tools: body.tools, tool_choice: "auto" } : {}),
          ...(body.json ? { response_format: { type: "json_object" } } : {}),
          ...(body.effort && cfg.label === "Gemini" ? { reasoning_effort: body.effort } : {}),
          max_tokens: body.maxTokens ?? 16000,
        }),
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = `${cfg.label} (${model}) timed out after ${Math.round((body.timeoutMs ?? 60_000) / 1000)}s`;
      cooldownUntil.set(model, Date.now() + 120_000);
      continue;
    }
    if (res.ok) {
      const j = (await res.json()) as { choices: Array<{ message: Extract<ChatMessage, { role: "assistant" }>; finish_reason: string }> };
      const choice = j.choices?.[0];
      if (!choice) throw new LlmError(`${cfg.label} returned no choices.`);
      return { message: choice.message, finishReason: choice.finish_reason, model };
    }
    const text = await res.text();
    lastError = `${cfg.label} (${model}) HTTP ${res.status}: ${text.slice(0, 300)}`;
    if (res.status === 429) {
      const header = Number(res.headers.get("retry-after"));
      const hinted = Number(text.match(/retry in ([\d.]+)s/i)?.[1] ?? text.match(/"retryDelay":\s*"(\d+)s"/)?.[1]);
      // A daily quota looks like a very long hint; park that model for the rest of the run.
      cooldownUntil.set(model, Date.now() + Math.min(3600, header || hinted || 20) * 1000);
    } else if (res.status === 404 || res.status >= 500) {
      cooldownUntil.set(model, Date.now() + (res.status === 404 ? 24 * 3600_000 : 90_000));
    } else {
      throw new LlmError(lastError, res.status);
    }
  }
  throw new LlmError(`No model was available in time. Last error: ${lastError}`);
}

/**
 * Ping every candidate at once and make the best-ranked responsive one current.
 * On free tiers the newest models are often overloaded; this costs one tiny request per model
 * and saves minutes of sequential timeouts.
 */
export async function pickResponsiveModel(cfg: Extract<LlmConfig, { kind: "openai" }>, opts: { fullOnly?: boolean } = {}): Promise<string | null> {
  const c = await candidates(cfg);
  if (c.models.length === 1) return c.models[0];
  const eligible = c.models.map((m, i) => ({ m, i })).filter(({ m }) => (!opts.fullOnly || !/lite/.test(m)) && (cooldownUntil.get(m) ?? 0) <= Date.now());
  const results = await Promise.all(
    eligible.map(async ({ m, i }) => {
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: m, messages: [{ role: "user", content: "ok" }], max_tokens: 16, ...(cfg.label === "Gemini" ? { reasoning_effort: "low" } : {}) }),
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) cooldownUntil.set(m, Date.now() + (res.status === 429 ? 30_000 : 90_000));
        return res.ok ? i : null;
      } catch {
        return null;
      }
    }),
  );
  const best = results.filter((i): i is number => i !== null).sort((a, b) => a - b)[0];
  if (best === undefined) return null;
  c.current = best;
  return c.models[best];
}
