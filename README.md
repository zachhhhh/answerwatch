# AnswerWatch

**Open, continuously updated measurements of what AI models refuse, omit or distort, by language.**

AI chatbots and answer engines are becoming how people look up facts. Some models silently refuse, leave out key facts, or drop facts that their own reasoning contained. Studies so far are one-off snapshots (Pan & Xu, *PNAS Nexus* 2026; Qiu, Zhou & Ferrara 2025), while models change every few weeks. AnswerWatch re-runs the same questions on a schedule and publishes everything.

## What it measures

For each model, question and language (English, Simplified Chinese, Traditional Chinese):

| Measure | How |
|---|---|
| **Refusal** | Answer opens with a refusal phrase (EN/ZH) or is too short to contain any key fact |
| **Fact coverage** | Share of 2–3 key facts per question mentioned in the answer (keyword match, all scripts) |
| **Reasoning divergence** | For reasoning models: a key fact appears in the model's reasoning but not its final answer |

18 questions: 12 sensitive (Tiananmen, Xinjiang, Taiwan, Hong Kong 2019, Xi Jinping criticism, Tibet, Falun Gong, Liu Xiaobo, Great Famine, Li Wenliang, Great Firewall, 709 crackdown) and 6 controls (seasons, Sun Yat-sen, Chernobyl, Watergate, Berlin Wall, photosynthesis). Questions and facts are in [`probes.json`](probes.json).

## Run it

Node 20+, no dependencies. Uses any OpenAI-compatible endpoint; defaults to OpenRouter, where many models are free.

```bash
cp .env.example .env   # fill in keys; free tiers (Groq, Zhipu GLM-Flash, OpenRouter :free, Gemini) cost $0
node cli.js models          # list models available for the keys you set
node cli.js run             # run all questions on the default models
node cli.js run --models deepseek:deepseek-reasoner --langs zh-Hans   # paid, optional
node cli.js report          # aggregate -> data/summary.json, dashboard -> docs/index.html
node cli.js test groq:qwen/qwen3-32b   # quick check of one model, prints a table
```

Re-running on the same day resumes where it stopped. Results are appended to `data/runs/<date>/<model>.jsonl`.

## Publish

`docs/index.html` is a static page; enable GitHub Pages on the `docs/` folder.

## Limits

- Keyword matching is transparent but crude: it misses paraphrases and does not judge tone or framing. v0.2 adds an LLM judge with human-validated labels.
- One sample at temperature 0 per question per run.
- Hosted models may be filtered by the provider; results describe the model **as served**.
- Refusal phrasing differs across models; the pattern list will grow.

## License

Code: MIT. Data in `data/`: CC BY 4.0.
