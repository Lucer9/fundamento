import DataLoader from 'dataloader'
import { GraphQLError } from 'graphql'
import { MODELOS, SQL_FTS, consultaFts, porArticulo, rrf, type Hit, type Modelo } from './buscar.ts'
import type { Ley } from './parse.ts'

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
  DEV?: string
}

export type Fila = { ley: Ley; id: string; orden: number; ubicacion: string; texto: string; reformas: string }
export type Criterio = { n: number; id: string; materia: Ley; tema: string; texto: string }

/** D1 access that counts round trips, so every response can report how many queries it cost. */
export type Db = { n: number; all<T>(sql: string, ...params: unknown[]): Promise<T[]> }

export type Ctx = { env: Env; db: Db; ip: string; load: ReturnType<typeof loaders> }

export const clave = (ley: string, id: string) => `${ley}:${id}`
const json = (keys: readonly string[]) => JSON.stringify(keys)

export function db(env: Env): Db {
  const d: Db = {
    n: 0,
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

async function vectorHits(env: Env, d: Db, query: string): Promise<Hit[]> {
  const modelo = MODELOS[env.MODEL]
  const emb = (await env.AI.run(modelo.id as keyof AiModels, { text: [modelo.consulta(query)] } as never)) as unknown as { data: number[][] }
  const { matches } = await env.VEC.query(emb.data[0], { topK: 100 })
  const rows = await d.all<Hit & { rowid: number }>(
    `select rowid, ley, id, texto from fragmento where rowid in (select value from json_each(?1))`,
    JSON.stringify(matches.map(m => Number(m.id))),
  )
  const porRow = new Map(rows.map(r => [String(r.rowid), r]))
  return matches.flatMap(m => (porRow.has(m.id) ? [{ ...porRow.get(m.id)!, score: m.score }] : []))
}

export type Modo = 'KEYWORD' | 'VECTOR' | 'HYBRID'

/** One hit per article, best first. HYBRID fuses both rankings with reciprocal rank fusion. */
export async function buscar(env: Env, d: Db, query: string, modo: Modo, ley: Ley | null, primeros: number) {
  if (query.length > 500) throw new GraphQLError('La búsqueda admite hasta 500 caracteres.')
  const [kw, vec] = await Promise.all([
    modo === 'VECTOR' ? [] : textoHits(d, query).then(porArticulo),
    modo === 'KEYWORD' ? [] : vectorHits(env, d, query).then(porArticulo),
  ])
  const hits = modo === 'HYBRID' ? rrf([kw, vec]) : modo === 'KEYWORD' ? kw : vec
  return hits.filter(h => !ley || h.ley === ley).slice(0, Math.min(Math.max(primeros, 1), 50))
}
