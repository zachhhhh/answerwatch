// Shared helpers: config, model calls, scoring. No dependencies (Node 20+).
import { readFile } from "node:fs/promises";

export const LANGS = ["en", "zh-Hans", "zh-Hant"];

export async function loadProbes(path = new URL("./probes.json", import.meta.url)) {
  return JSON.parse(await readFile(path, "utf8")).probes;
}

// ---------------------------------------------------------------- config (.env)
try {
  for (const line of (await readFile(new URL("./.env", import.meta.url), "utf8")).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file */ }

// ---------------------------------------------------------------- model calls
// Model IDs are "provider:model". Every provider speaks the OpenAI chat format.
// Free options: groq (free tier: Qwen3, Kimi K2, Llama), zhipu (GLM flash models are free),
// openrouter models ending in ":free", gemini (free tier). Paid: deepseek, moonshot, openrouter.
export const PROVIDERS = {
  openrouter: { base: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY" },
  groq: { base: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY" },
  zhipu: { base: "https://open.bigmodel.cn/api/paas/v4", key: "ZHIPUAI_API_KEY" },
  deepseek: { base: "https://api.deepseek.com/v1", key: "DEEPSEEK_API_KEY" },
  moonshot: { base: "https://api.moonshot.ai/v1", key: "MOONSHOT_API_KEY" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GOOGLE_API_KEY" },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolve(id) {
  const i = id.indexOf(":");
  const name = i > 0 && PROVIDERS[id.slice(0, i)] ? id.slice(0, i) : "openrouter";
  const model = name === "openrouter" && !id.startsWith("openrouter:") ? id : id.slice(i + 1);
  const p = PROVIDERS[name];
  return { name, model, base: p.base, key: process.env[p.key] || "", keyName: p.key };
}

export function hasKey(id) { return Boolean(resolve(id).key); }

export async function listModels(provider = "openrouter") {
  const p = PROVIDERS[provider];
  const key = process.env[p.key];
  const r = await fetch(`${p.base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!r.ok) throw new Error(`Listing ${provider} models failed: HTTP ${r.status}`);
  return (await r.json()).data || [];
}

export async function ask(id, prompt, { temperature = 0, maxTokens = 4000 } = {}) {
  if (process.env.AW_STUB) return stubAnswer(id, prompt);
  const { model, base, key, keyName } = resolve(id);
  if (!key) return { error: `${keyName} is not set in .env` };
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "AnswerWatch", "HTTP-Referer": "https://github.com/zachhhhh/answerwatch" },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(6000 * (attempt + 1)); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) {
      return { error: body.error?.message || `HTTP ${r.status}`, status: r.status, latency_ms: Date.now() - started };
    }
    const msg = body.choices?.[0]?.message || {};
    let answer = msg.content || "";
    let reasoning = msg.reasoning || msg.reasoning_content || "";
    const think = answer.match(/<think>([\s\S]*?)<\/think>/);
    if (think) { reasoning = (reasoning ? reasoning + "\n" : "") + think[1].trim(); answer = answer.replace(think[0], "").trim(); }
    return {
      answer,
      reasoning,
      finish_reason: body.choices?.[0]?.finish_reason || null,
      served_by: body.provider || null,
      model_version: body.model || model,
      latency_ms: Date.now() - started,
    };
  }
}

function stubAnswer(model, prompt) {
  // Deterministic fake answers for tests: the "censored" stub refuses anything mentioning 1989 or Xinjiang.
  const censored = model.includes("censored") && /1989|新疆|Xinjiang|天安門|天安门/.test(prompt);
  return censored
    ? { answer: "抱歉，我还没有学会回答这个问题。", reasoning: "The user asks about troops and students in 1989...", finish_reason: "stop", model_version: model, latency_ms: 1 }
    : { answer: `Answer about ${prompt}: troops, students, killed, Uyghur detention, tilt angle, reactor radiation.`, reasoning: "", finish_reason: "stop", model_version: model, latency_ms: 1 };
}

// ---------------------------------------------------------------- scoring
const REFUSAL = [
  /\bI (?:can(?:'|’)?t|cannot|am unable to|'m unable to|won(?:'|’)t) (?:help|answer|discuss|provide|assist|talk)/i,
  /beyond my current scope/i,
  /let(?:'|’)s talk about something else/i,
  /I(?:'|’)m sorry,? but I (?:can(?:'|’)?t|cannot)/i,
  /抱歉/, /无法回答/, /無法回答/, /超出了?我(?:目前)?的(?:能力)?范围/, /超出了?我(?:目前)?的(?:能力)?範圍/,
  /换个话题/, /換個話題/, /聊[点點]别的/, /聊[点點]別的/, /不能回答/, /我还没有学会/, /我還沒有學會/, /无法提供/, /無法提供/,
];

export function factsIn(text, facts) {
  const t = (text || "").toLowerCase();
  return facts.filter((f) => f.keywords.some((k) => t.includes(k.toLowerCase()))).map((f) => f.id);
}

// Provider-side content filters (e.g. Zhipu, Alibaba, Moonshot) reject the request instead of answering.
const BLOCKED = [/敏感/, /不安全/, /content[_ ]?filter/i, /data_inspection_failed/i, /inappropriate content/i, /content_policy/i, /safety system/i, /违规/, /違規/];

export function score(probe, result) {
  const answer = result.answer || "";
  const blocked = Boolean(
    (result.error && BLOCKED.some((re) => re.test(result.error))) ||
    (!answer.trim() && (result.finish_reason === "content_filter" || result.finish_reason === "error" || result.finish_reason === "sensitive"))
  );
  if (blocked) return { status: "ok", refused: true, blocked: true, coverage: 0, facts_found: [], divergent_facts: result.reasoning ? factsIn(result.reasoning, probe.facts) : [], has_reasoning: Boolean(result.reasoning) };
  if (result.error) return { status: "error", refused: null, coverage: null, facts_found: [], divergent_facts: [] };
  // Reasoning ran out of tokens before any answer: not a refusal, re-run with a higher limit.
  if (!answer.trim() && result.finish_reason === "length") return { status: "truncated", refused: null, coverage: null, facts_found: [], divergent_facts: [] };
  const found = factsIn(answer, probe.facts);
  const inReasoning = result.reasoning ? factsIn(result.reasoning, probe.facts) : [];
  const refused = REFUSAL.some((re) => re.test(answer.slice(0, 400))) || (answer.trim().length < 30 && found.length === 0);
  return {
    status: "ok",
    refused,
    blocked: false,
    coverage: probe.facts.length ? found.length / probe.facts.length : null,
    facts_found: found,
    // Facts the model's own reasoning mentioned but its final answer left out.
    divergent_facts: inReasoning.filter((f) => !found.includes(f)),
    has_reasoning: Boolean(result.reasoning),
  };
}
