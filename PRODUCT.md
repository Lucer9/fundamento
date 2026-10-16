# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **fundamento:** people in Mexico with a federal tax question. Regular taxpayers (employees, freelancers, small businesses checking their own case, including what their contador told them) and professionals (accountants, lawyers) count equally: the plain answer comes first and the exact article sits one step away.
- **Maneja Sin Broncas:** drivers in Mexico City who want to know what a rule says and what the fine is, often on a phone, right before or after a stop, a fotocívica or a tow.
- **Secondary:** people reading Carlos Aguirre's portfolio case study; both sites are a backend portfolio piece as well as public tools.

## Product Purpose

Two sites on one engine that search and answer over the official text of Mexican law, so a question in everyday Spanish lands on the exact article, with citations. Success means people reach the article that answers them, answers are correct, and pages rank in Google for the questions people actually type.

## Positioning

- Every answer is grounded in the official text (Cámara de Diputados, RMF 2026, CDMX legislation) and links to the articles it rests on; nothing is answered from memory.
- Accuracy is measured and published on the "Cómo funciona" page: search hit rates with confidence intervals, and answer accuracy graded against SAT criteria and hand-checked questions.
- Free, no account.

## Operating Context

- Spanish (es-MX) only.
- Visitors arrive from Google on an article or question page, or type a question into the main box on the home page.
- Answers come from Claude with a daily cap per site; repeated and pre-published questions are served from the database, and search keeps working when answers run out.
- Hosted on Cloudflare's free tier at fundamento.carlosaguirre.workers.dev and manejasinbroncas.carlosaguirre.workers.dev. No custom domains for now; the owner wants to stay cheap.

## Capabilities and Constraints

- Search (keywords plus vectors, with a Claude rewrite of the question), article pages with citations both ways and related articles, published FAQ pages, an answer box, an explorer, a methods page with the evals, and a GraphQL API.
- Being added: a plain-Spanish summary on every article ("En pocas palabras", written by Claude and judged on a sample) and a chat assistant that takes follow-up questions.
- Not legal or tax advice; every surface keeps that disclaimer. The chat assistants are unofficial and must not read as the SAT or any authority.
- Article and FAQ pages are server-rendered for crawlers; the interactive app is plain JavaScript modules.
- Free-tier limits shape the product: D1 writes per day, Workers AI per day, and Vectorize storage.

## Brand Commitments

- Names: **fundamento** (lowercase wordmark) and **Maneja Sin Broncas** (the traffic site, renamed from "semáforo" on 2026-10-16). Chat assistants: **SATGPT** on fundamento and **Educación vIAl** on Maneja Sin Broncas.
- The owner likes the current fonts and colors; keep them. The owner dislikes the current main textbox.
- Both sites carry a "Hecho por Carlos Aguirre" credit linking to https://www.carlosaguirre.workers.dev.

## Evidence on Hand

- Measured results: public/eval.json, public/eval-transito.json, public/eval-respuestas.json, public/eval-respuestas-transito.json, and the README tables.
- No testimonials, user counts or press exist; never invent them.

## Product Principles

1. The law's own words are the authority; every claim points to an article.
2. Plain Spanish first, the exact text one step away.
3. Measure before shipping, and publish the numbers.
4. Fast and free on a phone.
5. Honest about limits: disclaimers, daily caps, unofficial assistants.
