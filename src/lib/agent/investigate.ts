import type { Guide } from "../types";
import { llmConfig } from "../llm";
import type { Emit } from "./common";
import { runClaudeInvestigation } from "./claude";
import { runOpenInvestigation } from "./open";

export async function runInvestigation(query: string, emit: Emit, signal?: AbortSignal): Promise<Guide> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("No model is configured. Set GEMINI_API_KEY (free tier) or another key from .env.example.");
  return cfg.kind === "anthropic" ? runClaudeInvestigation(query, emit, signal) : runOpenInvestigation(cfg, query, emit, signal);
}
