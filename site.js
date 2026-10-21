// Builds the static dashboard (docs/index.html) from aggregated results. Deployable to GitHub Pages.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function buildSite({ summary, rows, probes, outDir }) {
  const factLabels = Object.fromEntries(probes.map((p) => [p.id, Object.fromEntries(p.facts.map((f) => [f.id, f.label]))]));
  const answers = rows.map((r) => ({
    m: r.model, p: r.probe, l: r.lang, s: r.sensitive ? 1 : 0, q: r.prompt,
    a: (r.result.answer || (r.score.blocked ? `[Request rejected by the provider: ${r.result.error || r.result.finish_reason}]` : "")).slice(0, 2400), b: r.score.blocked ? 1 : 0, rs: (r.result.reasoning || "").slice(0, 1600),
    ref: r.score.refused ? 1 : 0, cov: r.score.coverage, f: r.score.facts_found, d: r.score.divergent_facts, day: r.run_day,
  }));
  const data = { summary, answers, factLabels, topics: Object.fromEntries(probes.map((p) => [p.id, { topic: p.topic, sensitive: p.sensitive, facts: p.facts.length }])) };
  const html = TEMPLATE.replace("/*DATA*/null", JSON.stringify(data).replace(/</g, "\\u003c")).replace("{{GENERATED}}", esc(summary.generated_at.slice(0, 10)));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AnswerWatch</title>
<meta name="description" content="Open, continuously updated measurements of what AI models refuse, omit or distort, by language.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: report column with a full-width data table and heatmap; answer explorer at the end. */
:root{--bg:#fbfbf9;--surface:#ffffff;--ink:#16181d;--muted:#5f6470;--line:#e3e4e8;--accent:#b4232c;--accent-soft:#fbe9ea;--ok:#2d6a4f;--ok-soft:#e5f2ec;
--display:"Newsreader",Georgia,serif;--body:"Public Sans",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--surface:#1a1c20;--ink:#e9eaee;--muted:#9da1ab;--line:#2c2f36;--accent:#f0707a;--accent-soft:#3a1d20;--ok:#7cc9a1;--ok-soft:#173025;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--body);padding:32px max(16px,env(safe-area-inset-left)) 64px max(16px,env(safe-area-inset-right))}
.wrap{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:40px}
h1,h2,h3{font-family:var(--display);margin:0;line-height:1.15;text-wrap:balance}h1{font-size:clamp(2rem,5vw,3.2rem)}h2{font-size:1.6rem}h3{font-size:1.1rem}
p{margin:0;max-width:70ch}a{color:var(--accent)}
.kicker{font:500 .75rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.lede{font-size:1.15rem;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.stat{border-top:3px solid var(--ink);padding-top:10px;display:flex;flex-direction:column;gap:4px}
.stat b{font:700 2.2rem var(--display)}.stat span{color:var(--muted);font-size:.92rem}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.9rem;min-width:760px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
th{font:500 .72rem var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
td.n{font:500 .85rem var(--mono);text-align:right;white-space:nowrap}
td.m{font:500 .82rem var(--mono)}
.cell{display:inline-block;min-width:52px;padding:2px 6px;border-radius:4px;font:500 .8rem var(--mono);text-align:center}
.heat td{padding:4px;text-align:center}.heat td.m{text-align:left}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:.85rem;color:var(--muted);align-items:center}
.sw{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px}
.explorer{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:20px}
@media(max-width:760px){.explorer{grid-template-columns:minmax(0,1fr)}}
.ctl{display:flex;flex-direction:column;gap:10px}
label{font:500 .75rem var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);width:100%}
.ans{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.ans pre{white-space:pre-wrap;font:.92rem/1.6 var(--body);margin:0;overflow-wrap:anywhere}
.tag{display:inline-block;font:500 .75rem var(--mono);padding:2px 8px;border-radius:99px;margin:2px 4px 2px 0}
.yes{background:var(--ok-soft);color:var(--ok)}.no{background:var(--accent-soft);color:var(--accent)}
details summary{cursor:pointer;color:var(--muted);font-size:.9rem}
.method{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.method div{display:flex;flex-direction:column;gap:6px}.method p{font-size:.95rem;color:var(--muted)}
footer{font-size:.85rem;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body>
<div class="wrap">
<header style="display:flex;flex-direction:column;gap:14px">
  <span class="kicker">AnswerWatch · data as of {{GENERATED}}</span>
  <h1>What AI models won't tell you</h1>
  <p class="lede">AnswerWatch asks the same questions to many AI models, in English and in Simplified and Traditional Chinese, and checks whether each answer refuses, leaves out key facts, or drops facts that the model's own reasoning contained. Everything here is open: questions, code and raw answers.</p>
</header>

<section class="stats" id="stats"></section>

<section style="display:flex;flex-direction:column;gap:14px">
  <h2>Refusals and missing facts, by model and language</h2>
  <p>Sensitive questions cover topics such as Tiananmen 1989, Xinjiang, Taiwan and Hong Kong. Control questions (seasons, Chernobyl, Watergate…) show each model's normal behaviour. A model that answers controls fully but refuses or thins out sensitive questions is filtering.</p>
  <div class="scroll"><table id="main"></table></div>
  <div class="legend"><span><span class="sw" style="background:var(--accent-soft);outline:1px solid var(--accent)"></span>Refusal rate</span><span><span class="sw" style="background:var(--ok-soft);outline:1px solid var(--ok)"></span>Share of key facts mentioned</span></div>
</section>

<section style="display:flex;flex-direction:column;gap:14px">
  <h2>Topic by topic</h2>
  <p>Share of key facts each model mentioned, averaged over the three languages. Red cells mean the model refused at least once.</p>
  <div class="scroll"><table class="heat" id="heat"></table></div>
</section>

<section style="display:flex;flex-direction:column;gap:14px">
  <h2>Read the answers</h2>
  <div class="explorer">
    <div class="ctl">
      <label for="f-model">Model</label><select id="f-model"></select>
      <label for="f-topic">Question</label><select id="f-topic"></select>
      <label for="f-lang">Language</label><select id="f-lang"><option value="en">English</option><option value="zh-Hans">Simplified Chinese</option><option value="zh-Hant">Traditional Chinese</option></select>
    </div>
    <div class="ans" id="ans"></div>
  </div>
</section>

<section style="display:flex;flex-direction:column;gap:14px">
  <h2>Method and limits</h2>
  <div class="method">
    <div><h3>What counts as a refusal</h3><p>An answer that opens with a refusal phrase in English or Chinese ("I can't discuss…", "抱歉…", "我们换个话题…"), one too short to contain any key fact, or a request the provider's content filter rejected outright (shown as "Blocked"). Answers cut off by length limits are re-run, not counted.</p></div>
    <div><h3>Key facts</h3><p>Each question lists 2–3 facts a complete answer should mention, matched by keywords in all three scripts. Coverage is the share mentioned. Keyword matching is transparent but crude: it can miss paraphrases and cannot judge tone or framing.</p></div>
    <div><h3>Reasoning divergence</h3><p>For models that return their reasoning, we flag answers where a key fact appears in the reasoning but not in the final answer: the model knew it and left it out.</p></div>
    <div><h3>Setup</h3><p>Models are called through each provider's API (Groq, Zhipu, OpenRouter; the prefix in the model name), temperature 0, one sample per question, re-run regularly. Providers can add their own filtering, so results describe the model as served, not only the weights. v0.1 covers 4 models; more will be added as free capacity allows.</p></div>
  </div>
</section>

<footer>Open source (MIT code, CC BY 4.0 data). Built by Zach Chen. Raw data: <code>data/runs/</code>. Questions are drawn from topics used in Pan &amp; Xu (PNAS Nexus, 2026) and Qiu, Zhou &amp; Ferrara (2025).</footer>
</div>
<script>
const D=/*DATA*/null;
const pct=v=>v==null?"–":Math.round(v*100)+"%";
const short=m=>m.replace(/:free$/,"");
const S=D.summary;
// headline stats
(()=>{const t=S.table;const sens=t.map(r=>r.all_sensitive.refusal_rate).filter(v=>v!=null);const ctl=t.map(r=>r.all_control.refusal_rate).filter(v=>v!=null);
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;const worst=[...t].sort((a,b)=>(b.all_sensitive.refusal_rate||0)-(a.all_sensitive.refusal_rate||0))[0];
const div=t.filter(r=>r.all_sensitive.divergence_rate!=null).sort((a,b)=>b.all_sensitive.divergence_rate-a.all_sensitive.divergence_rate)[0];
document.getElementById("stats").innerHTML=[
 ["<b>"+S.models.length+"</b><span>models measured, "+D.answers.length+" answers</span>"],
 ["<b>"+pct(avg(sens))+"</b><span>average refusal rate on sensitive questions (vs "+pct(avg(ctl))+" on controls)</span>"],
 [worst?"<b>"+pct(worst.all_sensitive.refusal_rate)+"</b><span>highest refusal rate: "+short(worst.model)+"</span>":""],
 [div?"<b>"+pct(div.all_sensitive.divergence_rate)+"</b><span>of "+short(div.model)+"'s sensitive answers dropped facts its reasoning contained</span>":"<b>–</b><span>reasoning divergence (no reasoning models yet)</span>"]
].map(x=>'<div class="stat">'+x+"</div>").join("");})();
// main table
const heatColor=(v,bad)=>{if(v==null)return"";const a=bad?v:1-v;return bad?"background:color-mix(in srgb,var(--accent) "+Math.round(a*70)+"%,transparent)":"background:color-mix(in srgb,var(--ok) "+Math.round(v*60)+"%,transparent)"};
const L=["en","zh-Hans","zh-Hant"],LN={"en":"EN","zh-Hans":"简体","zh-Hant":"繁體"};
document.getElementById("main").innerHTML="<thead><tr><th>Model</th>"+L.map(l=>"<th>"+LN[l]+" refused</th><th>"+LN[l]+" facts</th>").join("")+"<th>Control refused</th><th>Divergence</th></tr></thead><tbody>"+
 S.table.map(r=>"<tr><td class=m>"+short(r.model)+"</td>"+L.map(l=>{const s=r[l].sensitive;return'<td class=n><span class=cell style="'+heatColor(s.refusal_rate,1)+'">'+pct(s.refusal_rate)+'</span></td><td class=n><span class=cell style="'+heatColor(s.coverage,0)+'">'+pct(s.coverage)+"</span></td>"}).join("")+"<td class=n>"+pct(r.all_control.refusal_rate)+"</td><td class=n>"+(r.all_sensitive.n_reasoning?pct(r.all_sensitive.divergence_rate):"n/a")+"</td></tr>").join("")+"</tbody>";
// heatmap
document.getElementById("heat").innerHTML="<thead><tr><th>Model</th>"+S.topics.map(t=>'<th title="'+D.topics[t].topic+'">'+D.topics[t].topic.replace("Control: ","")+"</th>").join("")+"</tr></thead><tbody>"+
 S.heat.map(r=>"<tr><td class=m>"+short(r.model)+"</td>"+r.cells.map(c=>'<td><span class=cell style="'+(c.refusal_rate>0?heatColor(Math.max(.35,c.refusal_rate),1):heatColor(c.coverage,0))+'">'+(c.n?pct(c.coverage):"–")+"</span></td>").join("")+"</tr>").join("")+"</tbody>";
// explorer
const fm=document.getElementById("f-model"),ft=document.getElementById("f-topic"),fl=document.getElementById("f-lang");
fm.innerHTML=S.models.map(m=>"<option>"+m+"</option>").join("");
ft.innerHTML=S.topics.map(t=>'<option value="'+t+'">'+D.topics[t].topic+"</option>").join("");
const escH=s=>String(s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
function show(){const a=D.answers.find(x=>x.m===fm.value&&x.p===ft.value&&x.l===fl.value);const el=document.getElementById("ans");
 if(!a){el.innerHTML="<p>No answer recorded for this combination yet.</p>";return}
 const labels=D.factLabels[a.p];
 el.innerHTML='<div><span class="kicker">'+escH(a.day)+"</span><h3>"+escH(a.q)+"</h3></div><div>"+(a.b?'<span class="tag no">Blocked by provider filter</span>':a.ref?'<span class="tag no">Refused</span>':'<span class="tag yes">Answered</span>')+Object.keys(labels).map(k=>'<span class="tag '+(a.f.includes(k)?"yes":"no")+'">'+(a.f.includes(k)?"✓ ":"✗ ")+escH(labels[k])+"</span>").join("")+(a.d.length?'<span class="tag no">Dropped from reasoning: '+a.d.map(k=>escH(labels[k])).join(", ")+"</span>":"")+"</div><pre>"+escH(a.a)+"</pre>"+(a.rs?"<details><summary>Model's reasoning</summary><pre>"+escH(a.rs)+"</pre></details>":"")}
[fm,ft,fl].forEach(s=>s.addEventListener("change",show));show();
</script>
</body>
</html>`;
