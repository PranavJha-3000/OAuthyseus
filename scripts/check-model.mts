// Confirms the configured model key works:  npx tsx --env-file=.env scripts/check-model.mts
import { chat, llmConfig, resolveModel } from "../src/lib/llm";
const cfg = llmConfig();
if (!cfg || cfg.kind !== "openai") throw new Error("No OpenAI-compatible model key configured.");
console.log(`${cfg.label}: first choice ${await resolveModel(cfg)}`);
const { message, model } = await chat(cfg, { messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 2000, effort: "low" }, { onSwitch: (f, t, w) => console.log(`${f} ${w} -> ${t}`) });
console.log(`reply from ${model}:`, message.content);
