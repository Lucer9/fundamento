# fundamento

Search Mexican federal tax law in plain Spanish. Ten documents are split into articles and rules and linked by
what they cite: the Ley del ISR, the Ley del IVA, the Ley del IEPS, the Código Fiscal de la Federación, the 2026
Ley de Ingresos, their four reglamentos, and SAT's 2026 Resolución Miscelánea Fiscal (1,215 numbered rules). SAT's
own criteria are attached to the articles they interpret, and you can ask questions in plain language.

Live: https://fundamento.carlosaguirre.workers.dev · GraphQL explorer: `/graphql`

```
 Cámara de Diputados PDFs ─┐                                 ┌─ D1 (SQLite)
 SAT Miscelánea 2026 PDF ──┤ scripts/ingest.ts (PDFKit)      │   articulo (2,577), enlace (6,342 citations),
 SAT Anexos 7 y 3 PDFs ────┤                                 │   criterio (189), fragmento (6,922 chunks), FTS5
                           └─► parse → articles, rules, ─────┤
                                       citations, criterios  └─ Vectorize fundamento-gemma-512: chunk + criterio
                                                                 vectors (embeddinggemma-300m, cut to 512 d)

 Browser ── POST /graphql ──► Worker (GraphQL Yoga + graphql-armor + DataLoader)
                                ├─ search: embed query → Vectorize (laws, then reglamentos + rules) → D1
                                └─ answer: law + rule chunks + SAT criterios → LLM → citations checked
```

## How it's graded

The test set comes from SAT itself. Every criterio normativo (Anexo 7 of the RMF 2026) and every criterio on
improper practices (Anexo 3) cites the articles it interprets, so each one gives a question with a known answer.

- **Titles**: the criterio's title is the query. Anexo 7 (133) was used to choose methods; Anexo 3 (56) is held out.
- **Plain-language questions**: an LLM rewrote each criterio as the question a taxpayer would ask, without the
  answer (`eval/preguntas.json`, 189). gpt-oss-120b wrote 173; Claude Opus wrote the 16 added with the IEPS and LIF
  criterios, while Workers AI was unavailable (those entries carry `modelo`). This set is closest to real use.

A hit means an article the criterio cites appears in the top k. Intervals are 95% percentile bootstrap over
questions, and comparisons are paired (both methods are scored on the same resampled questions).

## Results (`npm run eval`, 2026-10-16, ten documents)

Plain-language questions, n = 189:

| method                                  | hit@1 | hit@5 | hit@10 | MRR@10 |
|-----------------------------------------|-------|-------|--------|--------|
| keyword, one ranking                    | 17.5% | 33.3% | 41.3%  | 0.247  |
| keyword, laws only                      | 28.0% | 47.1% | 61.4%  | 0.373  |
| hybrid gemma, one ranking               | 23.3% | 53.4% | 65.1%  | 0.358  |
| vector gemma 768 d, one ranking         | 28.6% | 61.4% | 73.5%  | 0.429  |
| vector gemma 512 d, one ranking         | 30.7% | 65.1% | 76.2%  | 0.437  |
| **vector gemma 512 d, laws only (live)**| 45.5% | 75.7% | 83.6%  | 0.574  |

Criterio titles, Anexo 7 (n = 133) / Anexo 3 held out (n = 56), hit@5:

| method                          | Anexo 7 | Anexo 3 |
|---------------------------------|---------|---------|
| keyword, one ranking            | 56.4%   | 50.0%   |
| keyword, laws only              | 72.2%   | 71.4%   |
| vector gemma, one ranking       | 62.4%   | 60.7%   |
| vector gemma, laws only         | 78.2%   | 75.0%   |

What the numbers support:

- **Rank the law apart from the rules that apply it.** Ranked together, Miscelánea rules paraphrase the law and
  crowd it out: on the 173 questions of the three-law corpus, top-1 fell from 45.7% to 29.5% when the seven new
  documents joined, and rules took 1.6 of the top 5 on average. Ranking laws on their own scores 45.5% top-1 on all
  189 questions, +9.5 to +19.0 points over one ranking (paired). The site shows the law list first and the
  reglamentos and rules in a second list; that is also their legal order.
- **Vectors beat keywords.** Both restricted to laws, vectors score +21.7 to +36.0 points hit@5.
- **512 dimensions are enough.** embeddinggemma is trained so its first dimensions stand alone; cut to 512 it
  scored no worse than 768 (hit@5 +0.5 to +7.9). The free plan's 5M stored dimensions hold 7,111 vectors at 512
  but not at 768.
- **Keyword fusion still hurts.** Vector beats hybrid on hit@1 by 1.6 to 13.2 points.
- The held-out Anexo 3 titles agree in direction, but 56 questions separate little.

## Answer accuracy (`scripts/eval-respuestas.ts`, 2026-10-16)

Claude Haiku answers each of the 189 plain-language questions from the retrieved passages. Claude Opus then reads
the SAT criterio the question came from and labels the answer: correct (same conclusion), wrong (contradicts it) or
incomplete (doesn't reach it, usually saying the passages don't settle the question).

| run | what the answer reads                                    | correct | wrong | incomplete |
|-----|----------------------------------------------------------|---------|-------|------------|
| r1  | laws, reglamentos and Miscelánea rules                   | 22.2%   | 6.3%  | 71.4%      |
| r2  | the same plus SAT criterios, minus the question's own    | 24.9%   | 9.0%  | 66.1%      |
| r3  | the same plus every SAT criterio, the question's own too | 87.3%   | 2.6%  | 10.1%      |

- The statutes alone rarely settle what a criterio settles: criterios are SAT's reading of points the law doesn't
  spell out. Answers then mostly say so instead of guessing; they are wrong 6% to 9% of the time.
- Other criterios don't help with a different point: r2 − r1 is −2.1 to +7.4 points correct (paired bootstrap).
- With the question's own criterio searchable, as on the live site, retrieval found it for 181 of 189 questions and
  answers matched SAT 87.3% of the time (+57.7 to +72.0 points over r1). That is an upper bound: each question was
  written from its criterio, so finding it is easier than for a question SAT never addressed.
- The live site answers with gpt-oss-120b on Workers AI. These runs used Claude through `scripts/claude.ts` because
  the Workers AI allowance was exhausted; at list price an answer cost about $0.0016 and a verdict about $0.025.
- Every answer and verdict is in `eval/respuestas.r1.json` to `r3.json`.

## How the methods were chosen (three-law corpus, 2026-10-15)

Before the corpus grew, plain-language questions (n = 173) over LISR, LIVA and CFF:

| method        | hit@1 | hit@5 | hit@10 | MRR@10 |
|---------------|-------|-------|--------|--------|
| keyword       | 25.4% | 46.8% | 61.3%  | 0.351  |
| hybrid bge-m3 | 31.2% | 68.2% | 79.8%  | 0.461  |
| vector bge-m3 | 41.6% | 71.1% | 80.3%  | 0.539  |
| vector qwen3  | 42.2% | 71.1% | 80.3%  | 0.544  |
| vector gemma  | 43.4% | 76.3% | 85.5%  | 0.570  |

gemma, bge-m3 and qwen3 couldn't be told apart; gemma was kept for its smaller vectors and best point estimate.
For bge-m3, vector alone beat hybrid on hit@1 by 2.9 to 17.3 points. Those models weren't re-embedded for the
ten-document corpus.

Tried and dropped:

| change                                   | result                                               |
|------------------------------------------|------------------------------------------------------|
| Postgres `ts_rank` → SQLite FTS5 `bm25`  | 58.9% → 66.9% hit@5 (ts_rank has no IDF)             |
| whole articles → ~1,000-character chunks | 66.9% → 71.0%                                        |
| Spanish Snowball stemmer                 | 72.6% vs 75.0% without it; removed with its 800 KB package |
| bge-reranker-base on the top 20          | hit@1 54.0% → 41.9% (a model trained mainly on English and Chinese) |
| keyword weighted ×0.5 in fusion          | best on Anexo 7, not on the held-out set             |
| gemma cut to 256 dimensions              | hit@5 76.3% → 72.3%                                  |

## Engineering notes

- **The Miscelánea's PDF** prints rule numbers in a margin column, so plain text extraction batches them at page
  tops, away from their rules. `scripts/pdf-lineas.js` reads each line with its position; line spacing is bimodal
  (≤14 pt inside a paragraph, ≥16 pt between), so paragraphs come from gaps, a rule's title is the paragraph above
  its number, and its closing reference line ("CFF 29, 29-A, RCFF 39, RMF 2.7.1.23.") becomes links. 1,215 rules,
  8 without a title.
- **Citations:** the parser turns "los artículos 79, fracción XIX y 82 de esta Ley" into links with character
  spans. Inside a reglamento, "la Ley" means the law it regulates; "Reglamento de esta Ley", "del Reglamento del
  CFF" and "regla 2.7.1.21." resolve too.
- **Approximate vs exact:** replaying the 189 cached question embeddings against the live Vectorize index
  (`scripts/eval-ann.ts`) gave the same rank as exact search on 189 of 189 questions.
- **Embeddings on a laptop:** embeddinggemma's open weights (ONNX, fp32) matched Workers AI's vectors at cosine
  ≥ 0.9993, so the corpus and the evals are embedded locally (`scripts/embeddings.ts`); production embeds each
  search query on Workers AI.
- **N+1:** one search fetching citations and criteria for 10 hits takes 6 D1 queries with DataLoader and
  a median of 57 without it (`x-batch: off`). Measured live on the three-law corpus with 24 different questions
  each way: p50 329 ms vs 587 ms, p90 468 ms vs 804 ms. Every response reports `extensions.d1Queries`.
- **Answers:** every bracketed citation the model writes is checked against the passages it was given, and
  anything else is removed. Answers read 6 law chunks, 4 from the reglamentos and the Miscelánea, and the closest
  SAT criterios; they are cached per question, rate limited per IP and capped per day. `ANSWER_MODEL` can be a
  Workers AI model or a Claude model (Anthropic Messages API).
- **Degradation:** if Workers AI is unavailable, search falls back to keyword results and says so in
  `extensions.degraded`.
- **Abuse limits:** graphql-armor caps depth, aliases, tokens and cost.

## Run

```sh
npm i
npm run check        # parser + schema asserts
npm run ingest       # PDFs → data/seed.sql + data/fundamento.db (macOS: text via PDFKit)
npm run seed:local   # or seed:remote
node scripts/embeddings.ts &   # local embeddinggemma; .dev.vars EMBED_URL=http://localhost:8798
node scripts/claude.ts &       # local Claude via the Claude Code CLI; .dev.vars ANTHROPIC_BASE_URL=http://localhost:8799
npm run dev          # wrangler dev on :8787; .dev.vars DEV=1 enables /dev/ai and the eval headers
node scripts/embed.ts gemma && node scripts/vectorize.ts gemma
npm run eval && node scripts/eval-ann.ts                                    # retrieval
node scripts/preguntas.ts                                                   # plain-language questions
node scripts/eval-respuestas.ts r2 "con criterios" --modelo=claude-haiku-5-5   # answer accuracy, judged by Claude Opus
npm run deploy
```

Sources (texto vigente, read 2026-10-15): Cámara de Diputados PDFs of the LISR (last reformed DOF 01-04-2024),
LIVA (DOF 12-11-2021), LIEPS (DOF 07-11-2025), CFF (DOF 09-04-2026), LIF 2026 (DOF 07-11-2025), RLISR
(DOF 06-05-2016), RLIVA (DOF 25-09-2014), RLIEPS (DOF 04-12-2006) and RCFF (DOF 02-04-2014); SAT's compiled
Resolución Miscelánea Fiscal 2026 through its first modification (DOF 09-07-2026); SAT Anexos 3 and 7 of the
RMF 2026 (DOF 09-01-2026). Not parsed yet: the second and third Miscelánea modifications (DOF 01-10 and
02-10-2026), Anexo 3's July compilation and Anexo 7's October modification (one new criterio, 60/ISR/N).
Not tax advice.
