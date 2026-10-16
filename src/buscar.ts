import { LEYES, type Ley } from './parse.ts'

const VACIAS = new Set(
  `a al ante bajo con contra de del desde durante e el en entre hacia hasta la las le les lo los mediante o para pero por
  que se segun según sin sobre su sus tras u un una unas unos y ya es son ser sera será ha han haber como cual cuales
  cuando donde este esta estos estas ese esa esos esas aquel dicho dicha dichos dichas mismo misma no ni si sí mas más
  muy otro otra otros otras me mi mis nos tu tus usted yo puedo puede pueden debo debe deben tengo tiene tienen hay qué
  cómo cuál cuáles cuándo dónde cuánto cuánta quién`.split(/\s+/),
)

export const NOMBRES = Object.fromEntries(Object.entries(LEYES).map(([k, v]) => [k, v.nombre])) as Record<Ley, string>

/**
 * Lowercased words minus Spanish stopwords; the same function indexes chunks and parses questions.
 * A Snowball stemmer scored lower on the eval (72.6% vs 75.0% hit@5), so words stay whole.
 */
export const terminos = (s: string) => (s.toLowerCase().match(/\p{L}+/gu) ?? []).filter(w => w.length > 1 && !VACIAS.has(w))

/** FTS5 MATCH expression: any word may match, bm25 does the weighting. */
export const consultaFts = (q: string) => [...new Set(terminos(q))].map(t => `"${t}"`).join(' OR ')

/** Heading every chunk carries into both indexes, so a chunk deep inside article 27 still says what it belongs to. Miscelánea rules add their title. */
export const encabezado = (ley: Ley, id: string, ubicacion: string[], titulo?: string | null) =>
  `${NOMBRES[ley]}, ${LEYES[ley].tipo === 'reglas' ? 'regla' : 'artículo'} ${id}${titulo ? `, «${titulo}»` : ''}${ubicacion.length ? ` (${ubicacion.join(' › ')})` : ''}`

export const SQL_FTS = `
  select f.rowid, f.ley, f.id, f.texto, -bm25(fts) as score
  from fts join fragmento f on f.rowid = fts.rowid
  where fts match ?1
  order by bm25(fts)
  limit ?2`

/**
 * Embedding models compared in the eval. `dims` is what Workers AI returns; `indice` is what Vectorize stores;
 * `onnx` is the same model's open weights for embedding on a laptop (scripts/embeddings.ts).
 * gemma is cut to its first 512 dimensions (it was trained to allow that): 768 would not fit the free plan's
 * 5M stored dimensions, and 512 scored the same as 768 on the plain-language questions.
 */
export const MODELOS = {
  'bge-m3': {
    id: '@cf/baai/bge-m3',
    dims: 1024,
    indice: 1024,
    onnx: '',
    consulta: (q: string) => q,
    documento: (titulo: string, t: string) => `${titulo}\n${t}`,
  },
  qwen3: {
    id: '@cf/qwen/qwen3-embedding-0.6b',
    dims: 1024,
    indice: 1024,
    onnx: '',
    consulta: (q: string) =>
      `Instruct: Given a question about Mexican tax law, retrieve the law articles that answer it\nQuery:${q}`,
    documento: (titulo: string, t: string) => `${titulo}\n${t}`,
  },
  gemma: {
    id: '@cf/google/embeddinggemma-300m',
    dims: 768,
    indice: 512,
    onnx: 'onnx-community/embeddinggemma-300m-ONNX',
    consulta: (q: string) => `task: search result | query: ${q}`,
    documento: (titulo: string, t: string) => `title: ${titulo} | text: ${t}`,
  },
} as const

export type Modelo = keyof typeof MODELOS

/** First `d` dimensions, rescaled to unit length (Matryoshka truncation). */
export function recortar(v: ArrayLike<number>, d: number): number[] {
  const x = Array.from({ length: d }, (_, i) => v[i])
  const n = Math.hypot(...x)
  return x.map(t => t / n)
}

/** Vectorize index holding a model's vectors. */
export const indiceVec = (m: Modelo) => `fundamento-${m}${MODELOS[m].indice < MODELOS[m].dims ? `-${MODELOS[m].indice}` : ''}`
export type Hit = { ley: Ley; id: string; score: number; texto?: string; rowid?: number }

/** Chunk hits sorted best-first → one hit per article, keeping its best chunk. */
export function porArticulo(hits: Hit[]): Hit[] {
  const vistos = new Map<string, Hit>()
  for (const h of hits) if (!vistos.has(`${h.ley}:${h.id}`)) vistos.set(`${h.ley}:${h.id}`, h)
  return [...vistos.values()]
}

const porLey = (h: Hit) => `${h.ley}:${h.id}`

/**
 * Reciprocal rank fusion (k = 60, the value from the original paper). Items are matched by `clave`
 * (article by default, chunk with `h => String(h.rowid)`); keeps the first list's chunk text.
 */
export function rrf(listas: Hit[][], { k = 60, pesos = listas.map(() => 1), clave = porLey }: { k?: number; pesos?: number[]; clave?: (h: Hit) => string } = {}): Hit[] {
  const out = new Map<string, Hit>()
  listas.forEach((lista, l) =>
    lista.forEach((h, i) => {
      const c = clave(h)
      const prev = out.get(c)
      out.set(c, { ...(prev ?? h), texto: prev?.texto ?? h.texto, score: (prev?.score ?? 0) + pesos[l] / (k + i + 1) })
    }),
  )
  return [...out.values()].sort((a, b) => b.score - a.score)
}
