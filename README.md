# fundamento

Search Mexican federal tax law in plain Spanish. Ten documents are split into articles and rules and linked by
what they cite: the Ley del ISR, the Ley del IVA, the Ley del IEPS, the Código Fiscal de la Federación, the 2026
Ley de Ingresos, their four reglamentos, and SAT's 2026 Resolución Miscelánea Fiscal (1,215 numbered rules). SAT's
own criteria are attached to the articles they interpret, and you can ask questions in plain language.

Live: https://fundamento.carlosaguirre.workers.dev · GraphQL explorer: `/graphql`

The same engine also runs **semáforo**, a search over Mexico City traffic law: https://semaforo.carlosaguirre.workers.dev
(see [semáforo](#semáforo-the-same-engine-on-mexico-city-traffic-law)).

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

## semáforo: the same engine on Mexico City traffic law

semáforo indexes the Reglamento de Tránsito de la Ciudad de México (70 articles, last reformed GOCDMX 30-06-2026),
the Ley de Movilidad (264), its reglamento (254), the Ley de Cultura Cívica (143) and the Código Fiscal CDMX articles
on license, tow-truck and corralón fees (229–231), from the Consejería Jurídica's PDFs: 1,247 chunks and 136
citation links. Fines written as multiples of the UMA are shown in 2026 pesos (UMA $117.31, INEGI).
`src/corpus.ts` holds everything that differs between the two sites; `wrangler deploy --env transito` builds this one.

There are no SAT criteria to grade it, so its test set is 28 driver questions written and checked by hand against
the text (`eval/transito/preguntas.json`), each with the articles that answer it and a reference answer.

| method (n = 28)                      | hit@1 | hit@5 | hit@10 | MRR@10 |
|--------------------------------------|-------|-------|--------|--------|
| keyword, with street-word synonyms   | 46.4% | 85.7% | 92.9%  | 0.637  |
| vector gemma 512 d                   | 71.4% | 89.3% | 89.3%  | 0.778  |
| **hybrid gemma (live)**              | 67.9% | 100%  | 100%   | 0.807  |

What carried over from fundamento and what didn't, measured:

- **One list, not two.** The reglamento ranked alone scored 82.1% top-5 against 89.3% for one ranking over all five
  documents: the other laws don't paraphrase the reglamento the way the Miscelánea paraphrases the tax laws.
- **Hybrid wins here.** Vectors missed three questions whose answer turns on exact wording (seat belt, Hoy No
  Circula, the Metrobús lane); keyword search found all three and lost none (paired top-5 difference 0 to +21
  points, so 28 questions can't fully separate them).
- **Synonyms.** Drivers say corralón, fotocívicas, alcoholímetro and Hoy No Circula; the reglamento says depósito
  vehicular, sistemas tecnológicos, aire espirado and programas ambientales. Adding the law's wording to the query
  (`CORPUS.sinonimos`) lifted keyword top-5 from 71.4% to 85.7%.
- Vectorize matched exact search on 28 of 28 questions.

Answers, judged by Claude Opus against each reference answer:

| run | what changed                                                                | correct | wrong | incomplete |
|-----|-----------------------------------------------------------------------------|---------|-------|------------|
| t1  | fundamento's setup (Haiku)                                                  | 50.0%   | 10.7% | 39.3%      |
| t2  | synonyms, the chunk after each chosen chunk, an absence rule in the prompt  | 75.0%   | 3.6%  | 21.4%      |
| t3  | top six articles of the hybrid search, whole; paragraphs that cite them     | 82.1%   | 7.1%  | 10.7%      |
| t4  | t3 with Claude Sonnet instead of Haiku                                      | 89.3%   | 3.6%  | 7.1%       |
| t5  | t4, and paragraphs citing the two best articles always come                 | 92.9%   | 3.6%  | 3.6%       |
| t6  | t5, and paragraphs covering a cited article whole ("todas las fracciones")  | 96.4%   | 0.0%  | 3.6%       |
| t7  | t6 with Claude Haiku                                                        | 89.3%   | 0.0%  | 10.7%      |

- t3 over t1: +14.3 to +50.0 points correct (paired). The first failures were mostly the right article with the
  fine in a chunk the answer never saw: a fracción's sanction comes paragraphs after the rule.
- The citation graph feeds answers here: article 67 lists every case that sends a car to the depósito by the
  fracción it cites, so an answer about a motorcycle without a helmet gets that paragraph next to article 37.
- Remaining misses are mostly the depósito when the question shares no word with article 67's paragraph.
- Sonnet over Haiku: 0 to +17.9 points, not separable at 28 questions either way (t4 vs t3, t6 vs t7); Haiku's
  misses are omissions, never wrong facts. semáforo answers live with Sonnet ($0.006 an answer on average, $0.009
  at most, against Haiku's $0.003), since its answers are about fines and the corralón; fundamento with Haiku. From t5 to t6 the one changed verdict was a
  question the new rule doesn't touch, so it is run-to-run variation; t6's rule exists for questions like "¿qué pasa
  si traigo un porta placas que tapa la placa?", where article 67 sends the car to the depósito for any fracción of
  article 45 but shares no word with the question.

## Preguntas frecuentes, related articles and search engines

- **Preguntas frecuentes** (`/preguntas`, `faq/<site>.json`, `scripts/faq.ts`): questions answered ahead of time
  with Claude through the local bridge and published as pages; the answer box serves them for the same question
  without calling a model. They start from the answers a judge marked correct (165 tax answers from r3, 27 traffic
  answers from t6) and grow with `scripts/faq.ts preguntar`, which marks its answers as not yet checked. Answering
  visitors' own questions live goes through the Worker's model (Claude with an API key, gpt-oss otherwise), never
  through the Claude Code login on this machine.
- **Related articles** (`scripts/relacionados.ts`): for each article, the four closest by mean embedding that
  neither cite nor are cited by it, computed offline from the cached vectors. They link an obligation to its
  sanction in another document: the movilidad regulation's article on plates (RLM 116) to the traffic regulation's
  fine and depósito for plates (RT 45), which no citation connects.
- **Search engines**: the Worker renders every article, rule and question page with its own title, description,
  canonical URL, schema.org data (Legislation, QAPage) and text, so crawlers don't need to run the app.
  `/sitemap.xml` lists every article and question; `/robots.txt` points to it and keeps `/graphql` out. Set
  `GOOGLE_SITE_VERIFICATION` to add Search Console's verification tag.

## Engineering notes

- **The Miscelánea's PDF** prints rule numbers in a margin column, so plain text extraction batches them at page
  tops, away from their rules. `scripts/pdf-lineas.js` reads each line with its position; line spacing is bimodal
  (≤14 pt inside a paragraph, ≥16 pt between), so paragraphs come from gaps, a rule's title is the paragraph above
  its number, and its closing reference line (rule 2.1.1 ends "CFF 4o., 17-D, 17-I, 21, 146, 146-A, LCF 13, 14, RMF
  2.1.39., 2.9.3.") becomes links. 1,215 rules, 8 without a title.
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
  SAT criterios; they are cached per question, rate limited per IP (5 a minute) and capped per day
  (`DAILY_ANSWERS`, 200 per site; Claude Max's monthly API credit covers the worst case). With an `ANTHROPIC_API_KEY` secret the Worker answers with Claude
  (`CLAUDE_MODEL`: Haiku on fundamento, about $0.002 an answer; Sonnet on semáforo, about $0.006); without one, with
  gpt-oss-120b on Workers AI. In dev, `.dev.vars` points both at the local Claude bridge.
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

# semáforo: the same steps with CORPUS=transito (data/transito, eval/transito)
npm run ingest:transito && npm run seed:transito:local && npm run dev:transito   # :8788
CORPUS=transito node scripts/embed.ts gemma && CORPUS=transito node scripts/vectorize.ts gemma
CORPUS=transito npm run eval
CORPUS=transito DEV_URL=http://localhost:8788 node scripts/eval-respuestas.ts t3 "…" --modelo=claude-haiku-5-5
npm run seed:transito:remote && npm run deploy:transito

# after embedding: related articles, then the published questions (both take CORPUS=transito)
node scripts/relacionados.ts && npx wrangler d1 execute fundamento --env= --remote --file data/relacion.sql
node scripts/faq.ts importar eval/respuestas.r3.json
node scripts/faq.ts preguntar "¿…?" && node scripts/faq.ts subir
```

Sources (texto vigente, read 2026-10-15): Cámara de Diputados PDFs of the LISR (last reformed DOF 01-04-2024),
LIVA (DOF 12-11-2021), LIEPS (DOF 07-11-2025), CFF (DOF 09-04-2026), LIF 2026 (DOF 07-11-2025), RLISR
(DOF 06-05-2016), RLIVA (DOF 25-09-2014), RLIEPS (DOF 04-12-2006) and RCFF (DOF 02-04-2014); SAT's compiled
Resolución Miscelánea Fiscal 2026 through its first modification (DOF 09-07-2026); SAT Anexos 3 and 7 of the
RMF 2026 (DOF 09-01-2026). Not parsed yet: the second and third Miscelánea modifications (DOF 01-10 and
02-10-2026), Anexo 3's July compilation and Anexo 7's October modification (one new criterio, 60/ISR/N).
Not tax advice.
