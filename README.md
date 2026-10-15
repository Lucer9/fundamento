# fundamento

Mexican federal tax law (LISR, LIVA, CFF) split into articles, linked by the articles they cite,
and searchable in plain Spanish. Graded against SAT's own criterios normativos (Anexo 7, RMF 2026):
each criterio's title is asked as a question, and a hit means an article it cites comes back.

## Run

```sh
npm i
npm run db       # Postgres 17 + pgvector on :5433 (docker compose)
npm run check    # parser self-check
npm run ingest   # downloads the PDFs to data/raw, parses, loads Postgres (macOS: uses PDFKit)
npm run eval     # hit@1/5/10 over the criterios
```

Sources: Cámara de Diputados texto vigente PDFs (`LeyesBiblio/pdf/{LISR,LIVA,CFF}.pdf`) and SAT's
Anexo 7 PDF. URLs live in `src/parse.ts`.

## Results

| search  | hit@1 | hit@5 | hit@10 | n   | date       |
|---------|-------|-------|--------|-----|------------|
| keyword | 36.3% | 58.9% | 65.3%  | 124 | 2026-10-15 |
