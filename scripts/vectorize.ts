import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, type Modelo } from '../src/buscar.ts'

/**
 * Uploads the cached chunk embeddings of one model to its Vectorize index (fundamento-<model>).
 * Vector ids are fragmento rowids, so a match resolves to its chunk with one D1 lookup.
 * Usage: node scripts/vectorize.ts [model]  (default bge-m3)
 */
const modelo = (process.argv[2] ?? 'bge-m3') as Modelo
const { dims } = MODELOS[modelo]
const rowids = JSON.parse(readFileSync('data/emb/rowids.json', 'utf8')) as number[]
const b = readFileSync(`data/emb/${modelo}.docs.f32`)
const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const meta = new Map((db.prepare(`select rowid, ley, id from fragmento`).all() as { rowid: number; ley: string; id: string }[]).map(r => [r.rowid, r]))

const archivo = `data/emb/${modelo}.ndjson`
writeFileSync(
  archivo,
  rowids
    .map((rowid, i) => JSON.stringify({ id: String(rowid), values: Array.from(v.subarray(i * dims, (i + 1) * dims)), metadata: { ley: meta.get(rowid)!.ley, articulo: meta.get(rowid)!.id } }))
    .join('\n'),
)
execFileSync('npx', ['wrangler', 'vectorize', 'insert', `fundamento-${modelo}`, '--file', archivo], { stdio: 'inherit' })
