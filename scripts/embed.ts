import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, encabezado, expandir, type Modelo } from '../src/buscar.ts'
import type { Ley } from '../src/parse.ts'
import { embeberLocal } from './embeddings.ts'
import { huella } from './huella.ts'
import { DATA, EVAL } from '../src/corpus.ts'

/**
 * Embeds every chunk, criterio, criterio title and plain-language eval question (eval/preguntas.json) with each
 * model into Float32 files in data/emb. Models with open weights (MODELOS[m].onnx) run on this machine
 * (scripts/embeddings.ts); the rest, or all with --remoto, go through the dev Worker's /dev/ai route (`npm run dev`).
 * Chunk vectors go through a cache keyed by the embedded text's hash (<model>.cache.f32 + .cache.json), so a re-ingest
 * only re-embeds chunks whose text changed; <model>.docs.f32 is then rebuilt in rowid order.
 * Usage: node scripts/embed.ts [model...] [--remoto]
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const LOTE = 50
mkdirSync(`${DATA}/emb`, { recursive: true })

const db = new DatabaseSync(`${DATA}/fundamento.db`, { readOnly: true })
const frags = db
  .prepare(
    `select f.rowid, f.ley, f.id, f.texto, a.ubicacion, a.titulo from fragmento f join articulo a using (ley, id) order by f.rowid`,
  )
  .all() as { rowid: number; ley: Ley; id: string; texto: string; ubicacion: string; titulo: string | null }[]
const preguntas = (db.prepare(`select tema from criterio order by n`).all() as { tema: string }[]).map(r => r.tema)
const criterios = (db.prepare(`select id, anexo, tema, texto from criterio order by n`).all() as { id: string; anexo: number; tema: string; texto: string }[]).map(
  c => [`${c.anexo === 3 ? 'Práctica fiscal indebida' : 'Criterio normativo'} del SAT ${c.id}`.trim(), `${c.tema}\n${c.texto}`.slice(0, 2000)] as const,
)
const naturales = existsSync(`${EVAL}/preguntas.json`) ? (JSON.parse(readFileSync(`${EVAL}/preguntas.json`, 'utf8')) as { pregunta: string }[]).map(p => p.pregunta) : []


function leerCache(nombre: string, dims: number) {
  const cache = new Map<string, Float32Array>()
  if (!existsSync(`${DATA}/emb/${nombre}.cache.json`)) return cache
  const b = readFileSync(`${DATA}/emb/${nombre}.cache.f32`)
  const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  ;(JSON.parse(readFileSync(`${DATA}/emb/${nombre}.cache.json`, 'utf8')) as string[]).forEach((h, i) => cache.set(h, v.slice(i * dims, (i + 1) * dims)))
  return cache
}

function guardarCache(nombre: string, cache: Map<string, Float32Array>) {
  const claves = [...cache.keys()]
  const dims = cache.get(claves[0])!.length
  const v = new Float32Array(claves.length * dims)
  claves.forEach((k, i) => v.set(cache.get(k)!, i * dims))
  writeFileSync(`${DATA}/emb/${nombre}.cache.f32`, v)
  writeFileSync(`${DATA}/emb/${nombre}.cache.json`, JSON.stringify(claves))
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

const REMOTO = process.argv.includes('--remoto')
const elegidos = process.argv.slice(2).filter(a => !a.startsWith('--'))
for (const nombre of (elegidos.length ? elegidos : Object.keys(MODELOS)) as Modelo[]) {
  const m = MODELOS[nombre]
  const qs = `${DATA}/emb/${nombre}.preguntas.f32`
  const t0 = Date.now()
  const cache = leerCache(nombre, m.dims)
  let nuevos = 0
  const vectores = async (textos: string[]) => {
    const faltan = [...new Set(textos.filter(t => !cache.has(huella(t))))]
    if (faltan.length) {
      const v = m.onnx && !REMOTO ? Float32Array.from((await embeberLocal(nombre, faltan)).flat()) : await embeber(m.id, faltan)
      faltan.forEach((t, i) => cache.set(huella(t), v.slice(i * m.dims, (i + 1) * m.dims)))
      guardarCache(nombre, cache)
      nuevos += faltan.length
    }
    const out = new Float32Array(textos.length * m.dims)
    textos.forEach((t, i) => out.set(cache.get(huella(t))!, i * m.dims))
    return out
  }
  writeFileSync(`${DATA}/emb/${nombre}.docs.f32`, await vectores(frags.map(f => m.documento(encabezado(f.ley, f.id, JSON.parse(f.ubicacion), f.titulo), f.texto))))
  writeFileSync(qs, await vectores(preguntas.map(m.consulta)))
  writeFileSync(`${DATA}/emb/${nombre}.naturales.f32`, await vectores(naturales.map(q => m.consulta(expandir(q)))))
  writeFileSync(`${DATA}/emb/${nombre}.criterios.f32`, await vectores(criterios.map(([t, x]) => m.documento(t, x))))
  console.log(`${nombre}: ${frags.length} fragmentos + ${preguntas.length} criterios, ${nuevos} textos nuevos (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}
writeFileSync(`${DATA}/emb/rowids.json`, JSON.stringify(frags.map(f => f.rowid)))
