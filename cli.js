#!/usr/bin/env node
// AnswerWatch CLI
//   node cli.js models                      list free models from censorship-relevant families
//   node cli.js run [--models a,b] [--langs en,zh-Hans] [--probes id1,id2] [--concurrency 2]
//   node cli.js report                      aggregate latest results into data/summary.json and docs/
//   node cli.js test <model>                run all probes against one model and print a table (no files)
import { mkdir, writeFile, readFile, readdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, loadProbes, listModels, ask, score, hasKey, PROVIDERS } from "./lib.js";
import { buildSite } from "./site.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");

// $0 default set: free tiers only. China-developed models first, then comparison models.
// Add paid ones with --models, e.g. deepseek:deepseek-reasoner,moonshot:kimi-k2-0905-preview
export const DEFAULT_MODELS = [
  "groq:qwen/qwen3.8-27b",
  "zhipu:glm-5.3-flash",
  "minimax/minimax-m3.1-flash:free",
  "groq:openai/gpt-oss-120b",
  "google/gemma-4-31b-it:free",
  "gemini:gemini-2.5-flash",
];
const FAMILIES = /^(deepseek|qwen|moonshotai|z-ai|thudm|baidu|tencent|minimax|stepfun|meta-llama|google|mistralai|openai)\//;

function args() {
  const a = process.argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) out[a[i].slice(2)] = a[i + 1]?.startsWith("--") || a[i + 1] === undefined ? true : a[++i];
    else out._.push(a[i]);
  }
  return out;
}
const slug = (m) => m.replace(/[^a-z0-9]+/gi, "_");

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

async function cmdModels() {
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (!process.env[p.key]) { console.log(`${name}: no ${p.key} in .env`); continue; }
    try {
      let ids = (await listModels(name)).map((m) => m.id);
      if (name === "openrouter") ids = ids.filter((i) => i.endsWith(":free") && FAMILIES.test(i));
      console.log(`${name}:\n  ` + ids.sort().map((i) => `${name}:${i}`).join("\n  "));
    } catch (e) { console.log(`${name}: ${e.message}`); }
  }
}

async function availableOf(wanted) {
  if (process.env.AW_STUB) return { ok: wanted, missing: [] };
  return { ok: wanted.filter(hasKey), missing: wanted.filter((m) => !hasKey(m)) };
}

async function cmdRun(o) {
  const probes = (await loadProbes()).filter((p) => !o.probes || o.probes.split(",").includes(p.id));
  const langs = o.langs ? o.langs.split(",") : LANGS;
  const { ok, missing } = await availableOf(o.models ? o.models.split(",") : DEFAULT_MODELS);
  if (missing.length) console.warn(`Skipping (no API key in .env): ${missing.join(", ")}`);
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(DATA, "runs", day);
  await mkdir(dir, { recursive: true });
  const conc = Number(o.concurrency || 2);
  for (const model of ok) {
    const file = path.join(dir, `${slug(model)}.jsonl`);
    const done = new Set();
    const byId = Object.fromEntries(probes.map((p) => [p.id, p]));
    if (existsSync(file)) for (const l of (await readFile(file, "utf8")).split("\n").filter(Boolean)) { const r = JSON.parse(l); const p = byId[r.probe]; if (p && score(p, r.result).status === "ok") done.add(`${r.probe}|${r.lang}`); }
    const jobs = probes.flatMap((p) => langs.map((lang) => ({ p, lang }))).filter(({ p, lang }) => !done.has(`${p.id}|${lang}`));
    console.log(`${model}: ${jobs.length} prompts`);
    await pool(jobs, conc, async ({ p, lang }) => {
      const result = await ask(model, p.prompts[lang]);
      const s = score(p, result);
      const row = { model, probe: p.id, topic: p.topic, sensitive: p.sensitive, lang, prompt: p.prompts[lang], at: new Date().toISOString(), result, score: s };
      await appendFile(file, JSON.stringify(row) + "\n");
      process.stdout.write(s.status === "error" ? "x" : s.refused ? "R" : s.coverage === 1 ? "." : "o");
    });
    process.stdout.write("\n");
  }
  console.log(`Saved to ${path.relative(ROOT, dir)}. Run "node cli.js report" to rebuild the dashboard.`);
}

async function latestRows() {
  const probeById = Object.fromEntries((await loadProbes()).map((p) => [p.id, p]));
  const runsDir = path.join(DATA, "runs");
  if (!existsSync(runsDir)) return [];
  const days = (await readdir(runsDir)).sort();
  const latest = new Map(); // model|probe|lang -> row (newest wins)
  for (const d of days) for (const f of await readdir(path.join(runsDir, d))) {
    for (const l of (await readFile(path.join(runsDir, d, f), "utf8")).split("\n").filter(Boolean)) {
      const r = JSON.parse(l);
      const p = probeById[r.probe];
      if (!p) continue;
      r.score = score(p, r.result); // always re-score with the current rules
      if (r.score.status !== "ok") continue;
      latest.set(`${r.model}|${r.probe}|${r.lang}`, { ...r, run_day: d });
    }
  }
  return [...latest.values()];
}

export function aggregate(rows) {
  const by = (keyFn) => {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };
  const stats = (rs) => {
    const n = rs.length;
    const withR = rs.filter((r) => r.score.has_reasoning);
    return {
      n,
      refusal_rate: n ? rs.filter((r) => r.score.refused).length / n : null,
      coverage: n ? rs.reduce((a, r) => a + (r.score.coverage ?? 0), 0) / n : null,
      divergence_rate: withR.length ? withR.filter((r) => r.score.divergent_facts.length).length / withR.length : null,
      n_reasoning: withR.length,
    };
  };
  const models = [...by((r) => r.model).keys()].sort();
  const table = models.map((model) => {
    const rs = rows.filter((r) => r.model === model);
    const row = { model, last_run: rs.map((r) => r.run_day).sort().at(-1) };
    for (const lang of LANGS) {
      row[lang] = {
        sensitive: stats(rs.filter((r) => r.lang === lang && r.sensitive)),
        control: stats(rs.filter((r) => r.lang === lang && !r.sensitive)),
      };
    }
    row.all_sensitive = stats(rs.filter((r) => r.sensitive));
    row.all_control = stats(rs.filter((r) => !r.sensitive));
    return row;
  });
  const topics = [...by((r) => r.probe).keys()];
  const heat = models.map((model) => ({
    model,
    cells: topics.map((probe) => {
      const rs = rows.filter((r) => r.model === model && r.probe === probe);
      return { probe, ...stats(rs) };
    }),
  }));
  return { generated_at: new Date().toISOString(), models, table, topics, heat };
}

async function cmdReport() {
  const rows = await latestRows();
  if (!rows.length) { console.log("No results yet. Run: node cli.js run"); return; }
  const summary = aggregate(rows);
  await mkdir(DATA, { recursive: true });
  await writeFile(path.join(DATA, "summary.json"), JSON.stringify(summary, null, 2));
  const probes = await loadProbes();
  await buildSite({ summary, rows, probes, outDir: path.join(ROOT, "docs") });
  console.log(`Report built: ${summary.models.length} models, ${rows.length} answers -> docs/index.html`);
}

async function cmdTest(model) {
  const probes = await loadProbes();
  for (const p of probes) for (const lang of LANGS) {
    const s = score(p, await ask(model, p.prompts[lang]));
    console.log(`${p.id.padEnd(18)} ${lang.padEnd(8)} ${s.status === "error" ? "ERROR" : s.refused ? "REFUSED" : `coverage ${(s.coverage * 100).toFixed(0)}%`}`);
  }
}

const o = args();
const cmd = o._[0];
if (cmd === "models") await cmdModels();
else if (cmd === "run") await cmdRun(o);
else if (cmd === "report") await cmdReport();
else if (cmd === "test") await cmdTest(o._[1]);
else console.log("Usage: node cli.js models | run [--models a,b] [--langs en,zh-Hans,zh-Hant] [--probes ids] | report | test <model>");
