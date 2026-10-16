import DataLoader from 'dataloader'
import { GraphQLError } from 'graphql'
import { MODELOS, SQL_FTS, consultaFts, porArticulo, recortar, rrf, type Hit, type Modelo } from './buscar.ts'
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

/** Per-request ledger: D1 access that counts round trips, plus whether search fell back to keywords. */
export type Db = { n: number; degradado: boolean; all<T>(sql: string, ...params: unknown[]): Promise<T[]> }

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
  const m = consultaFts(query)
  return m ? d.all<Hit>(SQL_FTS, m, 200) : []
}

async function embeber(env: Env, query: string) {
  const modelo = MODELOS[env.MODEL]
  const pedido = { text: [modelo.consulta(query)] }
  const emb = (
    env.EMBED_URL
      ? await (await fetch(env.EMBED_URL, { method: 'POST', body: JSON.stringify({ model: modelo.id, ...pedido }) })).json()
      : await env.AI.run(modelo.id as keyof AiModels, pedido as never)
  ) as { data: number[][] }
  return recortar(emb.data[0], modelo.indice)
}

async function vectorHits(env: Env, d: Db, vector: number[]): Promise<Hit[]> {
  const { matches } = await env.VEC.query(vector, { topK: 100, filter: { tipo: 'ley' } })
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
 * What an answer is written from: the closest law chunks by embedding (at most `maximo` per article) and the
 * closest SAT criterios. Vector-only, because on plain-language questions keyword fusion lowered top-1 accuracy.
 */
export async function contexto(env: Env, d: Db, query: string, criterios: number, excluir: number | null, total = 10, maximo = 3) {
  const v = await embeber(env, query)
  const [vec, crit] = await Promise.all([vectorHits(env, d, v), criterios ? criteriosHits(env, d, v, criterios, excluir) : []])
  const cuenta = new Map<string, number>()
  const trozos = vec
    .filter(h => {
      const n = cuenta.get(`${h.ley}:${h.id}`) ?? 0
      cuenta.set(`${h.ley}:${h.id}`, n + 1)
      return n < maximo
    })
    .slice(0, total)
  return { trozos, criterios: crit }
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

/** One hit per article, best first; articles the query names come first. HYBRID fuses both rankings with reciprocal rank fusion. */
export async function buscar(env: Env, d: Db, query: string, modo: Modo, ley: Ley | null, primeros: number) {
  if (query.length > 500) throw new GraphQLError('La búsqueda admite hasta 500 caracteres.')
  const [fijos, kw, vec] = await Promise.all([
    nombrados(d, query),
    modo === 'VECTOR' ? [] : textoHits(d, query).then(porArticulo),
    modo === 'KEYWORD'
      ? []
      : embeber(env, query)
          .then(v => vectorHits(env, d, v))
          .then(porArticulo)
          .catch(() => {
            d.degradado = true
            return null
          }),
  ])
  const hits = d.degradado || modo === 'KEYWORD' ? (kw.length || modo === 'KEYWORD' ? kw : porArticulo(await textoHits(d, query))) : modo === 'HYBRID' ? rrf([kw, vec!]) : vec!
  const vistos = new Set(fijos.map(h => `${h.ley}:${h.id}`))
  return [...fijos, ...hits.filter(h => !vistos.has(`${h.ley}:${h.id}`))]
    .filter(h => !ley || h.ley === ley)
    .slice(0, Math.min(Math.max(primeros, 1), 50))
}
