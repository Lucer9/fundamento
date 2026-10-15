import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, encabezado, type Modelo } from '../src/buscar.ts'
import type { Ley } from '../src/parse.ts'
import { huella } from './huella.ts'

/**
 * Upserts one model's embeddings into its Vectorize index (fundamento-<model>), straight from the embedding cache.
 * Law chunks use their content address (fragmento.huella) as id with metadata tipo "ley"; SAT criterios use "c<n>"
 * with tipo "criterio". Ids are stable across re-ingests, so only changed chunks move. Chunks without a cached
 * vector are skipped and listed (run scripts/embed.ts first). Ids uploaded before and gone now are deleted
 * (tracked in data/emb/<model>.subidos.json). Queries filter on tipo, so the metadata index must exist first:
 *   npx wrangler vectorize create-metadata-index fundamento-<model> --propertyName tipo --type string
 * Usage: node scripts/vectorize.ts [model]  (default gemma)
 */
const modelo = (process.argv[2] ?? 'gemma') as Modelo
const { dims, documento } = MODELOS[modelo]
const b = readFileSync(`data/emb/${modelo}.cache.f32`)
const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const cache = new Map((JSON.parse(readFileSync(`data/emb/${modelo}.cache.json`, 'utf8')) as string[]).map((h, i) => [h, v.subarray(i * dims, (i + 1) * dims)]))
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const frags = db
  .prepare(`select f.huella, f.ley, f.id, f.texto, a.ubicacion from fragmento f join articulo a using (ley, id) order by f.rowid`)
  .all() as { huella: string; ley: Ley; id: string; texto: string; ubicacion: string }[]

const faltan: string[] = []
const lineas = frags.flatMap(f => {
  const vec = cache.get(huella(documento(encabezado(f.ley, f.id, JSON.parse(f.ubicacion)), f.texto)))
  if (!vec) return faltan.push(`${f.ley}:${f.id}`), []
  return [JSON.stringify({ id: f.huella, values: Array.from(vec), metadata: { tipo: 'ley', ley: f.ley, articulo: f.id } })]
})
const crit = `data/emb/${modelo}.criterios.f32`
if (existsSync(crit)) {
  const c = readFileSync(crit)
  const cv = new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4)
  const ns = (db.prepare(`select n from criterio order by n`).all() as { n: number }[]).map(r => r.n)
  ns.forEach((n, i) => lineas.push(JSON.stringify({ id: `c${n}`, values: Array.from(cv.subarray(i * dims, (i + 1) * dims)), metadata: { tipo: 'criterio', n } })))
}
if (faltan.length) console.log(`sin vector todavía (${faltan.length}): ${[...new Set(faltan)].join(', ')}`)

const archivo = `data/emb/${modelo}.ndjson`
writeFileSync(archivo, lineas.join('\n'))
execFileSync('npx', ['wrangler', 'vectorize', 'upsert', `fundamento-${modelo}`, '--file', archivo], { stdio: 'inherit' })

const subidos = `data/emb/${modelo}.subidos.json`
const ahora = new Set(lineas.map(l => (JSON.parse(l) as { id: string }).id))
const sobran = existsSync(subidos) ? (JSON.parse(readFileSync(subidos, 'utf8')) as string[]).filter(id => !ahora.has(id)) : []
for (let i = 0; i < sobran.length; i += 100)
  execFileSync('npx', ['wrangler', 'vectorize', 'delete-vectors', `fundamento-${modelo}`, '--ids', ...sobran.slice(i, i + 100)], { stdio: 'inherit' })
writeFileSync(subidos, JSON.stringify([...ahora]))
console.log(`subidos ${ahora.size}, borrados ${sobran.length}`)
