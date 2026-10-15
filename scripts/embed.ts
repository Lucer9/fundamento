import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, encabezado, type Modelo } from '../src/buscar.ts'
import type { Ley } from '../src/parse.ts'
import { huella } from './huella.ts'

/**
 * Embeds every chunk, criterio, criterio title and plain-language eval question (eval/preguntas.json) with each
 * model, through the dev Worker's /dev/ai route (`npm run dev` must be running), into Float32 files in data/emb.
 * Chunk vectors go through a cache keyed by the embedded text's hash (<model>.cache.f32 + .cache.json), so a re-ingest
 * only re-embeds chunks whose text changed; <model>.docs.f32 is then rebuilt in rowid order.
 * Usage: node scripts/embed.ts [model...]
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const LOTE = 50
mkdirSync('data/emb', { recursive: true })

const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const frags = db
  .prepare(
    `select f.rowid, f.ley, f.id, f.texto, a.ubicacion from fragmento f join articulo a using (ley, id) order by f.rowid`,
  )
  .all() as { rowid: number; ley: Ley; id: string; texto: string; ubicacion: string }[]
const preguntas = (db.prepare(`select tema from criterio order by n`).all() as { tema: string }[]).map(r => r.tema)
const criterios = (db.prepare(`select id, anexo, tema, texto from criterio order by n`).all() as { id: string; anexo: number; tema: string; texto: string }[]).map(
  c => [`${c.anexo === 3 ? 'Práctica fiscal indebida' : 'Criterio normativo'} del SAT ${c.id}`.trim(), `${c.tema}\n${c.texto}`.slice(0, 2000)] as const,
)
const naturales = existsSync('eval/preguntas.json') ? (JSON.parse(readFileSync('eval/preguntas.json', 'utf8')) as { pregunta: string }[]).map(p => p.pregunta) : []


function leerCache(nombre: string, dims: number) {
  const cache = new Map<string, Float32Array>()
  if (!existsSync(`data/emb/${nombre}.cache.json`)) return cache
  const b = readFileSync(`data/emb/${nombre}.cache.f32`)
  const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  ;(JSON.parse(readFileSync(`data/emb/${nombre}.cache.json`, 'utf8')) as string[]).forEach((h, i) => cache.set(h, v.slice(i * dims, (i + 1) * dims)))
  return cache
}

function guardarCache(nombre: string, cache: Map<string, Float32Array>) {
  const claves = [...cache.keys()]
  const dims = cache.get(claves[0])!.length
  const v = new Float32Array(claves.length * dims)
  claves.forEach((k, i) => v.set(cache.get(k)!, i * dims))
  writeFileSync(`data/emb/${nombre}.cache.f32`, v)
  writeFileSync(`data/emb/${nombre}.cache.json`, JSON.stringify(claves))
}

async function embeber(id: string, textos: string[]) {
  const lotes = Array.from({ length: Math.ceil(textos.length / LOTE) }, (_, i) => textos.slice(i * LOTE, (i + 1) * LOTE))
  const out: number[][][] = new Array(lotes.length)
  let siguiente = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (siguiente < lotes.length) {
        const i = siguiente++
        for (let intento = 0; ; intento++) {
          const res = await fetch(`${DEV}/dev/ai`, { method: 'POST', body: JSON.stringify({ model: id, input: { text: lotes[i] } }) })
          const j = (await res.json().catch(() => null)) as { data?: number[][] } | null
          if (j?.data?.length === lotes[i].length) {
            out[i] = j.data
            break
          }
          if (intento === 4) throw new Error(`${id} lote ${i}: ${res.status}`)
          await new Promise(r => setTimeout(r, 2000 * (intento + 1)))
        }
      }
    }),
  )
  return Float32Array.from(out.flat(2))
}

for (const nombre of (process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELOS)) as Modelo[]) {
  const m = MODELOS[nombre]
  const qs = `data/emb/${nombre}.preguntas.f32`
  const t0 = Date.now()
  const cache = leerCache(nombre, m.dims)
  const textos = frags.map(f => m.documento(encabezado(f.ley, f.id, JSON.parse(f.ubicacion)), f.texto))
  const faltan = [...new Set(textos.filter(t => !cache.has(huella(t))))]
  if (faltan.length) {
    const nuevos = await embeber(m.id, faltan)
    faltan.forEach((t, i) => cache.set(huella(t), nuevos.slice(i * m.dims, (i + 1) * m.dims)))
    guardarCache(nombre, cache)
  }
  const docs = new Float32Array(textos.length * m.dims)
  textos.forEach((t, i) => docs.set(cache.get(huella(t))!, i * m.dims))
  writeFileSync(`data/emb/${nombre}.docs.f32`, docs)
  if (!existsSync(qs)) writeFileSync(qs, await embeber(m.id, preguntas.map(m.consulta)))
  const nat = `data/emb/${nombre}.naturales.f32`
  if (naturales.length && !existsSync(nat)) writeFileSync(nat, await embeber(m.id, naturales.map(m.consulta)))
  const crit = `data/emb/${nombre}.criterios.f32`
  if (!existsSync(crit)) writeFileSync(crit, await embeber(m.id, criterios.map(([t, x]) => m.documento(t, x))))
  console.log(`${nombre}: ${frags.length} fragmentos (${faltan.length} nuevos) + ${preguntas.length} preguntas (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}
writeFileSync('data/emb/rowids.json', JSON.stringify(frags.map(f => f.rowid)))
