import DataLoader from 'dataloader'
import { GraphQLError } from 'graphql'
import { MODELOS, SQL_FTS, consultaFts, expandir, porArticulo, recortar, rrf, terminos, type Hit, type Modelo } from './buscar.ts'
import { CORPUS } from './corpus.ts'
import { referencias, type Ley } from './parse.ts'

export interface Env {
  DB: D1Database
  VEC: VectorizeIndex
  AI: Ai
  ASSETS: Fetcher
  SEARCH_LIMITER: RateLimit
  ANSWER_LIMITER: RateLimit
  MODEL: Modelo
  ANSWER_MODEL: string
  DAILY_ANSWERS: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL?: string
  EMBED_URL?: string
  DEV?: string
}

export type Fila = { ley: Ley; id: string; orden: number; ubicacion: string; texto: string; reformas: string; actualizaciones: string; titulo: string | null }
export type Criterio = { n: number; anexo: number; id: string; materia: Ley; tema: string; texto: string }

/** Per-request ledger: D1 access that counts round trips, whether search fell back to keywords, and query embeddings already computed. */
export type Db = { n: number; degradado: boolean; vectores: Map<string, Promise<number[]>>; all<T>(sql: string, ...params: unknown[]): Promise<T[]> }

export type Ctx = {
  env: Env
  db: Db
  ip: string
  modeloRespuesta: string
  evaluando: boolean
  excluir: number | null
  sinCriterios: boolean
  load: ReturnType<typeof loaders>
}

export const clave = (ley: string, id: string) => `${ley}:${id}`
const json = (keys: readonly string[]) => JSON.stringify(keys)

export function db(env: Env): Db {
  const d: Db = {
    n: 0,
    degradado: false,
    vectores: new Map(),
    async all<T>(sql: string, ...params: unknown[]) {
      d.n++
      return (await env.DB.prepare(sql).bind(...params).all<T>()).results
    },
  }
  return d
}

function agrupar<R extends { k: string }>(keys: readonly string[], rows: R[]) {
  const m = new Map<string, R[]>()
  for (const r of rows) m.set(r.k, [...(m.get(r.k) ?? []), r])
  return keys.map(k => m.get(k) ?? [])
}

/**
 * One batched D1 query per relation per tick. Sending `x-batch: off` turns batching off,
 * which is how the N+1 comparison in the README was measured.
 */
export function loaders(d: Db, batch: boolean) {
  const o = { batch }
  return {
    articulo: new DataLoader<string, Fila | null>(async keys => {
      const rows = await d.all<Fila>(`select * from articulo where ley || ':' || id in (select value from json_each(?1))`, json(keys))
      const m = new Map(rows.map(r => [clave(r.ley, r.id), r]))
      return keys.map(k => m.get(k) ?? null)
    }, o),
    cita: new DataLoader<string, { k: string; a: string }[]>(
      async keys =>
        agrupar(
          keys,
          await d.all<{ k: string; a: string }>(
            `select distinct de_ley || ':' || de_id as k, a_ley || ':' || a_id as a from enlace
             where de_ley || ':' || de_id in (select value from json_each(?1)) order by inicio`,
            json(keys),
          ),
        ),
      o,
    ),
    citadoPor: new DataLoader<string, { k: string; a: string }[]>(
      async keys =>
        agrupar(
          keys,
          await d.all<{ k: string; a: string }>(
            `select distinct a_ley || ':' || a_id as k, de_ley || ':' || de_id as a from enlace
             where a_ley || ':' || a_id in (select value from json_each(?1)) order by de_ley, de_id`,
            json(keys),
          ),
        ),
      o,
    ),
    enlaces: new DataLoader<string, { k: string; inicio: number; fin: number; a: string }[]>(
      async keys =>
        agrupar(
          keys,
          await d.all<{ k: string; inicio: number; fin: number; a: string }>(
            `select de_ley || ':' || de_id as k, inicio, fin, a_ley || ':' || a_id as a from enlace
             where de_ley || ':' || de_id in (select value from json_each(?1)) order by inicio`,
            json(keys),
          ),
        ),
      o,
    ),
    criterios: new DataLoader<string, (Criterio & { k: string })[]>(
      async keys =>
        agrupar(
          keys,
          await d.all<Criterio & { k: string }>(
            `select cc.ley || ':' || cc.id as k, c.* from criterio_cita cc join criterio c using (n)
             where cc.ley || ':' || cc.id in (select value from json_each(?1)) order by c.n`,
            json(keys),
          ),
        ),
      o,
    ),
    articulosDeCriterio: new DataLoader<number, string[]>(async ns => {
      const rows = await d.all<{ n: number; a: string }>(
        `select n, ley || ':' || id as a from criterio_cita where n in (select value from json_each(?1))`,
        JSON.stringify(ns),
      )
      return ns.map(n => rows.filter(r => r.n === n).map(r => r.a))
    }, o),
  }
}

export const cargar = async (ctx: Ctx, keys: string[]) =>
  (await ctx.load.articulo.loadMany(keys)).filter((a): a is Fila => !!a && !(a instanceof Error))

async function textoHits(d: Db, query: string): Promise<Hit[]> {
  const m = consultaFts(expandir(query))
  return m ? d.all<Hit>(SQL_FTS, m, 200) : []
}

/** The query's embedding, computed once per request even when the request runs several searches. */
function embeber(env: Env, d: Db, query: string) {
  if (!d.vectores.has(query))
    d.vectores.set(
      query,
      (async () => {
        const modelo = MODELOS[env.MODEL]
        const pedido = { text: [modelo.consulta(expandir(query))] }
        const emb = (
          env.EMBED_URL
            ? await (await fetch(env.EMBED_URL, { method: 'POST', body: JSON.stringify({ model: modelo.id, ...pedido }) })).json()
            : await env.AI.run(modelo.id as keyof AiModels, pedido as never)
        ) as { data: number[][] }
        return recortar(emb.data[0], modelo.indice)
      })(),
    )
  return d.vectores.get(query)!
}

/** Closest law chunks, optionally only from some documents; Vectorize applies the filter before ranking. */
async function vectorHits(env: Env, d: Db, vector: number[], leyes: Ley[] | null = null): Promise<Hit[]> {
  const { matches } = await env.VEC.query(vector, { topK: 100, filter: { tipo: 'ley', ...(leyes ? { ley: { $in: leyes } } : {}) } })
  const rows = await d.all<Hit & { rowid: number; huella: string }>(
    `select rowid, huella, ley, id, texto from fragmento where huella in (select value from json_each(?1))`,
    JSON.stringify(matches.map(m => m.id)),
  )
  const porHuella = new Map(rows.map(r => [r.huella, r]))
  return matches.flatMap(m => (porHuella.has(m.id) ? [{ ...porHuella.get(m.id)!, score: m.score }] : []))
}

/** SAT criterios closest to a question; they live in the same index as `c<n>` vectors. `excluir` drops one for the leave-one-out eval. */
async function criteriosHits(env: Env, d: Db, vector: number[], k: number, excluir: number | null) {
  const { matches } = await env.VEC.query(vector, { topK: k + 1, filter: { tipo: 'criterio' } })
  const ns = matches.map(m => Number(m.id.slice(1))).filter(n => n !== excluir).slice(0, k)
  const rows = await d.all<Criterio>(`select * from criterio where n in (select value from json_each(?1))`, JSON.stringify(ns))
  return ns.flatMap(n => rows.filter(r => r.n === n))
}

export type Modo = 'KEYWORD' | 'VECTOR' | 'HYBRID'

/**
 * What an answer is written from: the closest chunks by embedding, 6 from the corpus's first search list (the laws;
 * the Reglamento de Tránsito) and 4 from the second (reglamentos and Miscelánea; the related laws), at most `maximo`
 * per article, plus the closest SAT criterios. Each list gets its own quota because ranked together, rules that
 * paraphrase the law pushed the law itself down (hit@1 45.7% → 29.5%). Vector-only where keyword fusion lowered
 * accuracy (tax law). Where fusion helped (traffic law, CORPUS.modo HYBRID), answers read the top six articles of a
 * hybrid search instead, the same ranking the site shows.
 */
export async function contexto(env: Env, d: Db, query: string, criterios: number, excluir: number | null, maximo = 3) {
  const v = await embeber(env, d, query)
  if (CORPUS.modo === 'HYBRID') {
    const [hits, crit] = await Promise.all([buscar(env, d, query, 'HYBRID', null, 6), criterios ? criteriosHits(env, d, v, criterios, excluir) : []])
    return { trozos: CORPUS.siguiente ? await conSiguiente(d, hits) : hits, criterios: crit }
  }
  const [primera, segunda] = CORPUS.listas
  const [leyes, resto, crit] = await Promise.all([
    vectorHits(env, d, v, primera.leyes),
    segunda ? vectorHits(env, d, v, segunda.leyes) : [],
    criterios ? criteriosHits(env, d, v, criterios, excluir) : [],
  ])
  const tomar = (hits: Hit[], total: number) => {
    const cuenta = new Map<string, number>()
    return hits
      .filter(h => {
        const n = cuenta.get(`${h.ley}:${h.id}`) ?? 0
        cuenta.set(`${h.ley}:${h.id}`, n + 1)
        return n < maximo
      })
      .slice(0, total)
  }
  const trozos = segunda ? [...tomar(leyes, 6), ...tomar(resto, 4)] : tomar(leyes, 10)
  return { trozos: CORPUS.siguiente ? await conSiguiente(d, trozos) : trozos, criterios: crit }
}

/** Each chunk followed by the next chunk of the same article, when it isn't already there (CORPUS.siguiente). */
async function conSiguiente(d: Db, trozos: Hit[]) {
  const vistos = new Set(trozos.map(h => h.rowid))
  const filas = await d.all<Hit & { rowid: number }>(
    `select rowid, ley, id, texto from fragmento where rowid in (select value from json_each(?1))`,
    JSON.stringify(trozos.map(h => h.rowid! + 1).filter(r => !vistos.has(r))),
  )
  const siguiente = new Map(filas.map(f => [f.rowid, f]))
  return trozos.flatMap(h => {
    const s = siguiente.get(h.rowid! + 1)
    if (!s || s.ley !== h.ley || s.id !== h.id || vistos.has(s.rowid)) return [h]
    vistos.add(s.rowid)
    return [h, { ...s, score: h.score }]
  })
}

/**
 * Paragraphs of other articles that cite one of `claves`, with the citing article's lead-in when it ends in a colon
 * ("Sólo procederá la remisión de vehículos al depósito en los siguientes casos:"). Only paragraphs that share a word
 * with the query (by its first five letters, so "motocicleta" meets "Motocicletas"), best overlap first, so a rule
 * about motorcycles doesn't reach an answer about seat belts.
 */
export async function citantes(d: Db, claves: string[], query: string, maximo = 3) {
  const filas = await d.all<{ ley: Ley; id: string; inicio: number; texto: string }>(
    `select distinct e.de_ley as ley, e.de_id as id, e.inicio, a.texto from enlace e join articulo a on a.ley = e.de_ley and a.id = e.de_id
     where e.a_ley || ':' || e.a_id in (select value from json_each(?1)) and e.de_ley || ':' || e.de_id not in (select value from json_each(?1))`,
    JSON.stringify(claves),
  )
  const raiz = (t: string) => t.slice(0, 5)
  const palabras = new Set(terminos(expandir(query)).map(raiz))
  const vistos = new Set<string>()
  return filas
    .flatMap(f => {
      const pars = f.texto.split('\n')
      let pos = 0
      const i = pars.findIndex(p => (pos += p.length + 1) > f.inicio)
      const clave = `${f.ley}:${f.id}:${i}`
      if (i < 0 || vistos.has(clave)) return []
      vistos.add(clave)
      const texto = [...(i > 0 && /:$/.test(pars[0]) ? [pars[0]] : []), pars[i]].join('\n')
      const comunes = new Set(terminos(texto).map(raiz).filter(t => palabras.has(t))).size
      return comunes ? [{ ley: f.ley, id: f.id, texto, comunes }] : []
    })
    .sort((a, b) => b.comunes - a.comunes)
    .slice(0, maximo)
}

/** Articles the query names outright ("LISR 151", "artículo 29-A del CFF"), as hits, if they exist. */
async function nombrados(d: Db, query: string): Promise<Hit[]> {
  const refs = referencias(query)
  if (!refs.length) return []
  const rows = await d.all<Hit & { rowid: number }>(
    `select f.rowid, f.ley, f.id, f.texto from fragmento f where f.n = 0 and f.ley || ':' || f.id in (select value from json_each(?1))`,
    JSON.stringify(refs.map(r => `${r.ley}:${r.id}`)),
  )
  return refs.flatMap(r => rows.filter(f => f.ley === r.ley && f.id === r.id).map(f => ({ ...f, score: 1 })))
}

/**
 * One hit per article, best first; articles the query names come first. HYBRID fuses both rankings with reciprocal
 * rank fusion. `leyes` keeps only some documents (the site asks for each of CORPUS.listas separately: one mixed
 * ranking let the rules crowd out the law).
 */
export async function buscar(env: Env, d: Db, query: string, modo: Modo, ley: Ley | null, primeros: number, leyes: Ley[] | null = null) {
  if (query.length > 500) throw new GraphQLError('La búsqueda admite hasta 500 caracteres.')
  const [fijos, kw, vec] = await Promise.all([
    nombrados(d, query),
    modo === 'VECTOR' ? [] : textoHits(d, query).then(porArticulo),
    modo === 'KEYWORD'
      ? []
      : embeber(env, d, query)
          .then(v => vectorHits(env, d, v, leyes))
          .then(porArticulo)
          .catch(() => {
            d.degradado = true
            return null
          }),
  ])
  const hits = d.degradado || modo === 'KEYWORD' ? (kw.length || modo === 'KEYWORD' ? kw : porArticulo(await textoHits(d, query))) : modo === 'HYBRID' ? rrf([kw, vec!]) : vec!
  const vistos = new Set(fijos.map(h => `${h.ley}:${h.id}`))
  return [...fijos, ...hits.filter(h => !vistos.has(`${h.ley}:${h.id}`))]
    .filter(h => (!ley || h.ley === ley) && (!leyes || leyes.includes(h.ley)))
    .slice(0, Math.min(Math.max(primeros, 1), 50))
}
