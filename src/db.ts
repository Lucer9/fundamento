import postgres from 'postgres'

export const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/fundamento', {
  onnotice: () => {},
})

export type Hit = { ley: string; id: string; score: number }

/** Keyword baseline: Spanish full-text search, any term may match, ranked with length normalization. */
export const buscarTexto = (q: string, k = 10) => sql<Hit[]>`
  select ley, id, ts_rank(tsv, query, 1) as score
  from articulo, to_tsquery('spanish', replace(plainto_tsquery('spanish', ${q})::text, '&', '|')) query
  where tsv @@ query
  order by score desc
  limit ${k}`
