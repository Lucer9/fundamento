import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS } from '../src/buscar.ts'
import { DATA } from '../src/corpus.ts'

/**
 * Topic neighbours: for every article, the K most similar other articles by embedding (the mean of its chunk vectors,
 * cut to the index's dimensions), skipping pairs already linked by a citation either way. They link what citations
 * miss, like the movilidad regulation's plate rule and the traffic regulation's fine for obstructed plates.
 * Needs <data>/emb from scripts/embed.ts. Fills the local database and writes <data>/relacion.sql for D1:
 *   npx wrangler d1 execute <db> [--env transito] --remote --file <data>/relacion.sql
 * Usage: node scripts/relacionados.ts [k]  (default 4)
 */
const K = Number(process.argv[2] ?? 4)
const { dims, indice } = MODELOS.gemma
const db = new DatabaseSync(`${DATA}/fundamento.db`)
const rowids = JSON.parse(readFileSync(`${DATA}/emb/rowids.json`, 'utf8')) as number[]
const b = readFileSync(`${DATA}/emb/gemma.docs.f32`)
const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const frag = new Map((db.prepare(`select rowid, ley, id from fragmento`).all() as { rowid: number; ley: string; id: string }[]).map(f => [f.rowid, f]))
const citados = new Set(
  (db.prepare(`select distinct de_ley || ':' || de_id as a, a_ley || ':' || a_id as b from enlace`).all() as { a: string; b: string }[]).flatMap(e => [
    `${e.a}>${e.b}`,
    `${e.b}>${e.a}`,
  ]),
)

const unidad = (x: Float64Array) => {
  const n = Math.hypot(...x)
  return x.map(t => t / n)
}
const suma = new Map<string, Float64Array>()
rowids.forEach((r, i) => {
  const f = frag.get(r)!
  const k = `${f.ley}:${f.id}`
  const s = suma.get(k) ?? new Float64Array(indice)
  const c = unidad(Float64Array.from(v.subarray(i * dims, i * dims + indice)))
  for (let j = 0; j < indice; j++) s[j] += c[j]
  suma.set(k, s)
})
const claves = [...suma.keys()]
const vec = claves.map(k => unidad(suma.get(k)!))

const filas: { de: string; a: string; score: number }[] = []
claves.forEach((k, i) => {
  const mejores: { j: number; s: number }[] = []
  for (let j = 0; j < claves.length; j++) {
    if (j === i || citados.has(`${k}>${claves[j]}`)) continue
    let s = 0
    for (let d = 0; d < indice; d++) s += vec[i][d] * vec[j][d]
    if (mejores.length < K || s > mejores[mejores.length - 1].s) {
      mejores.push({ j, s })
      mejores.sort((x, y) => y.s - x.s)
      if (mejores.length > K) mejores.pop()
    }
  }
  for (const m of mejores) filas.push({ de: k, a: claves[m.j], score: m.s })
})

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`
const sql = [
  `create table if not exists relacion (ley text not null, id text not null, a_ley text not null, a_id text not null, score real not null, primary key (ley, id, a_ley, a_id));`,
  `delete from relacion;`,
  ...Array.from({ length: Math.ceil(filas.length / 500) }, (_, n) =>
    `insert into relacion (ley, id, a_ley, a_id, score) values\n${filas
      .slice(n * 500, (n + 1) * 500)
      .map(f => {
        const [l, i] = f.de.split(':')
        const [al, ai] = f.a.split(':')
        return `(${lit(l)}, ${lit(i)}, ${lit(al)}, ${lit(ai)}, ${f.score.toFixed(4)})`
      })
      .join(',\n')};`,
  ),
].join('\n')
writeFileSync(`${DATA}/relacion.sql`, sql)
db.exec(sql)
console.log(`${claves.length} artículos, ${filas.length} relaciones → ${DATA}/relacion.sql`)
