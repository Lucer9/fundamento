---
title: "fundamento"
summary: "Mexico's income tax, VAT and tax code as linked articles you can question in plain Spanish, graded against SAT's own answers."
date: 2026-10-15
group: Beyond
role: "TODO: Carlos picks the role line"
stack: "Cloudflare Workers, D1, Vectorize, Workers AI, GraphQL Yoga, TypeScript"
---

TODO: replace with real output from production once Workers AI is back (vector mode, same question).

```graphql
{ search(query: "¿Puedo deducir del ISR el deducible que pago de mi seguro de gastos médicos?", first: 3) {
    article { key location } passage } }
```

TODO: two or three sentences reading the real output once captured.

I built fundamento in October to have a backend project with a real graph in it and a test set I didn't
write myself. The three federal tax laws come as PDFs from the Cámara de Diputados. They cite each other
constantly ("los artículos 79, fracción XIX y 82 de esta Ley"), and SAT publishes criteria explaining how
it reads them. Each criterion cites the articles it interprets, so every one is a question with a known
answer.

## Grade it with SAT's answers

Anexo 7 of the 2026 RMF holds 124 criteria I used to choose methods. Anexo 3 holds 49 more I only ever
reported. A third set has 173 plain-language questions that gpt-oss-120b wrote from those criteria
without the answer, because nobody types "Deducible del seguro de gastos médicos. No es una deducción
personal." into a search box. A hit means a cited article shows up in the top results. Every comparison
comes with a paired bootstrap interval, because with 49 held-out questions, most differences are noise.

## Keywords lost to meaning

Keyword search held up on SAT's formal titles, at 75.0% top-5. On the plain questions it fell to 46.8%,
while vectors with embeddinggemma reached 76.3%, a gain of 21 to 37 points. Fusing the two made the
first result worse. With bge-m3, vectors alone beat the hybrid by 2.9 to 17.3 points at top-1, so
production runs on vectors and pins any article the query names, like "LISR 151", to the top.

gemma and bge-m3 couldn't be told apart at this sample size. I kept gemma for its smaller vectors.

## Measure, then delete

A Spanish Snowball stemmer scored 72.6% against 75.0% for plain words, so it went, along with its 800 KB
package. A cross-encoder reranker dropped top-1 accuracy from 54.0% to 41.9%, since it was trained mostly
on English and Chinese. A keyword weight tuned on Anexo 7 didn't survive Anexo 3.

## Six queries, not fifty-seven

The API is GraphQL because the data is a graph. Articles cite articles, criteria cite articles, and
the network page asks for all 1,258 citations in one request. Resolving citations and criteria for ten
search hits took a median of 57 D1 queries. With DataLoader it takes 6, and p50 latency fell from 587 ms
to 329 ms. Every response reports its query count, so the claim is checkable.

## Answers have to cite

TODO: answer-accuracy numbers (law only vs law + SAT criteria, leave-one-out), judged by Llama 3.3 70B
against the criterion each question came from. Early read on 101 questions with law text only: most
answers that went wrong contradicted SAT on points the law text alone doesn't settle.

Every bracketed citation the model writes is checked against what it was given, and anything else is
removed before the answer leaves the Worker.

## Where it stands

It runs on Cloudflare's free tier, which caps generated answers at 30 a day. Search keeps working when
the AI quota runs out, falling back to keywords and saying so. It covers the current text only. Showing
what an article said in 2021 needs the reform decrees, which I haven't parsed.

Try it at fundamento.carlosaguirre.workers.dev, or open /graphql and ask the graph yourself.
