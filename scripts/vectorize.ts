import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, type Modelo } from '../src/buscar.ts'

/**
 * Upserts the cached embeddings of one model into its Vectorize index (fundamento-<model>): law chunks with
 * id = fragmento rowid and metadata tipo "ley", SAT criterios with id "c<n>" and tipo "criterio".
 * Queries filter on tipo, which needs the metadata index to exist before vectors go in:
 *   npx wrangler vectorize create-metadata-index fundamento-<model> --propertyName tipo --type string
 * Usage: node scripts/vectorize.ts [model]  (default gemma)
 */
const modelo = (process.argv[2] ?? 'gemma') as Modelo
const { dims } = MODELOS[modelo]
const rowids = JSON.parse(readFileSync('data/emb/rowids.json', 'utf8')) as number[]
const b = readFileSync(`data/emb/${modelo}.docs.f32`)
const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const meta = new Map((db.prepare(`select rowid, ley, id from fragmento`).all() as { rowid: number; ley: string; id: string }[]).map(r => [r.rowid, r]))

const lineas = rowids.map((rowid, i) =>
  JSON.stringify({
    id: String(rowid),
    values: Array.from(v.subarray(i * dims, (i + 1) * dims)),
    metadata: { tipo: 'ley', ley: meta.get(rowid)!.ley, articulo: meta.get(rowid)!.id },
  }),
)
const crit = `data/emb/${modelo}.criterios.f32`
if (existsSync(crit)) {
  const c = readFileSync(crit)
  const cv = new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4)
  const ns = (db.prepare(`select n from criterio order by n`).all() as { n: number }[]).map(r => r.n)
  ns.forEach((n, i) => lineas.push(JSON.stringify({ id: `c${n}`, values: Array.from(cv.subarray(i * dims, (i + 1) * dims)), metadata: { tipo: 'criterio', n } })))
}
const archivo = `data/emb/${modelo}.ndjson`
writeFileSync(archivo, lineas.join('\n'))
execFileSync('npx', ['wrangler', 'vectorize', 'upsert', `fundamento-${modelo}`, '--file', archivo], { stdio: 'inherit' })
