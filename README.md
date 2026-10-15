# fundamento

Search Mexican federal tax law in plain Spanish. The Ley del ISR, the Ley del IVA and the Código Fiscal
de la Federación are split into articles and linked by the articles they cite. SAT's own criteria are
attached to the articles they interpret, and you can ask questions in plain language.

Live: https://fundamento.carlosaguirre.workers.dev · GraphQL explorer: `/graphql`

```
 Cámara de Diputados PDFs ─┐                                 ┌─ D1 (SQLite)
 SAT Anexos 7 y 3 PDFs ────┤ scripts/ingest.ts (PDFKit)      │   articulo, enlace (1,642 citation spans),
                           └─► parse → articles, citations ──┤   criterio, fragmento (2,482 chunks), FTS5
                                       chunks, criterios     └─ Vectorize: chunk + criterio embeddings
                                                                 (Workers AI embeddinggemma-300m, 768 d)

 Browser ── POST /graphql ──► Worker (GraphQL Yoga + graphql-armor + DataLoader)
                                ├─ search: embed query → Vectorize → D1, named articles pinned first
                                └─ answer: law chunks + SAT criterios → gpt-oss-120b → citations checked
```

## How it's graded

The test set comes from SAT itself. Every criterio normativo (Anexo 7 of the RMF 2026) and every
criterio on improper practices (Anexo 3) cites the articles it interprets, so each one gives a question
with a known answer.

- **Titles**: the criterio's title is the query. Anexo 7 (124) was used to choose methods; Anexo 3 (49) is
  held out.
- **Plain-language questions**: gpt-oss-120b rewrote each criterio as the question a taxpayer would ask,
  without the answer (`eval/preguntas.json`, 173). This set is closest to real use.

A hit means an article the criterio cites appears in the top k. Intervals are 95% percentile bootstrap
over questions, and comparisons are paired (both methods are scored on the same resampled questions).

## Results (`npm run eval`, 2026-10-15)

Plain-language questions, n = 173:

| method        | hit@1 | hit@5 | hit@10 | MRR@10 |
|---------------|-------|-------|--------|--------|
| keyword       | 25.4% | 46.8% | 61.3%  | 0.351  |
| hybrid bge-m3 | 31.2% | 68.2% | 79.8%  | 0.461  |
| vector bge-m3 | 41.6% | 71.1% | 80.3%  | 0.539  |
| vector qwen3  | 42.2% | 71.1% | 80.3%  | 0.544  |
| vector gemma  | 43.4% | 76.3% | 85.5%  | 0.570  |

Criterio titles, Anexo 7 (n = 124) / Anexo 3 held out (n = 49), hit@5:

| method                 | Anexo 7 | Anexo 3 |
|------------------------|---------|---------|
| keyword                | 75.0%   | 69.4%   |
| vector bge-m3          | 84.7%   | 73.5%   |
| hybrid bge-m3          | 80.6%   | 73.5%   |
| vector gemma           | 80.6%   | 73.5%   |
| vector bge-m3 + rerank | 66.9%   | 69.4%   |

What the numbers support:

- Vectors beat keywords. On plain questions, gemma scores +29.5 points hit@5 over keyword (paired interval
  +21 to +37). On Anexo 7 titles, bge-m3 scores +9.7 (+2 to +17).
- Adding keywords to the vector results makes them worse on plain questions. For bge-m3, vector alone
  beats hybrid on hit@1 by 2.9 to 17.3 points. So search is vector-only, and articles the query names
  outright ("LISR 151", "art. 29-A del CFF") are pinned to the top instead.
- gemma, bge-m3 and qwen3 can't be told apart at this sample size. gemma was picked for its smaller
  vectors (768 vs 1024 dimensions) and the best point estimate on plain questions.
- The 49 held-out titles are too few to separate any two methods.

Tried and dropped:

| change                                   | result                                               |
|------------------------------------------|------------------------------------------------------|
| Postgres `ts_rank` → SQLite FTS5 `bm25`  | 58.9% → 66.9% hit@5 (ts_rank has no IDF)             |
| whole articles → ~1,000-character chunks | 66.9% → 71.0%                                        |
| Spanish Snowball stemmer                 | 72.6% vs 75.0% without it; removed with its 800 KB package |
| bge-reranker-base on the top 20          | hit@1 54.0% → 41.9% (a model trained mainly on English and Chinese) |
| keyword weighted ×0.5 in fusion          | best on Anexo 7, not on the held-out set             |

## Engineering notes

- **N+1:** one search fetching citations and criteria for 10 hits takes 6 D1 queries with DataLoader and
  a median of 57 without it (`x-batch: off`). Measured live with 24 different questions each way:
  p50 329 ms vs 587 ms, p90 468 ms vs 804 ms. Every response reports `extensions.d1Queries`.
- **Citations:** the parser turns "los artículos 79, fracción XIX y 82 de esta Ley" into links with character
  spans, resolving "esta Ley", "dicha Ley", "del CFF" and suffixes like 2o.-A or 18-H BIS.
- **Answers:** every bracketed citation the model writes is checked against the passages it was given, and
  anything else is removed. Answers are cached per question, rate limited per IP and capped per day.
- **Degradation:** if Workers AI is unavailable, search falls back to keyword results and says so in
  `extensions.degraded`.
- **Abuse limits:** graphql-armor caps depth, aliases, tokens and cost.

## Run

```sh
npm i
npm run check        # parser + schema asserts
npm run ingest       # PDFs → data/seed.sql + data/fundamento.db (macOS: text via PDFKit)
npm run seed:local   # or seed:remote
npm run dev          # wrangler dev on :8787; .dev.vars DEV=1 enables /dev/ai and the eval headers
node scripts/embed.ts && node scripts/vectorize.ts gemma
npm run eval                                          # retrieval
node scripts/preguntas.ts                             # plain-language questions
node scripts/eval-respuestas.ts r2 "ley + criterios"  # answer accuracy, judged against SAT
npm run deploy
```

Sources: texto vigente from the Cámara de Diputados (LISR last reformed DOF 01-04-2024, LIVA DOF 12-11-2021,
CFF DOF 09-04-2026); SAT Anexos 3 and 7 of the RMF 2026 (DOF 09-01-2026). Not tax advice.
