import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, encabezado, type Modelo } from '../src/buscar.ts'
import type { Ley } from '../src/parse.ts'

/**
 * Embeds every chunk and every eval question with each model, through the dev Worker's /dev/ai
 * route (`npm run dev` must be running), and caches them as Float32 files in data/emb.
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
  const docs = `data/emb/${nombre}.docs.f32`
  const qs = `data/emb/${nombre}.preguntas.f32`
  const t0 = Date.now()
  if (!existsSync(docs)) {
    const textos = frags.map(f => m.documento(encabezado(f.ley, f.id, JSON.parse(f.ubicacion)), f.texto))
    writeFileSync(docs, await embeber(m.id, textos))
  }
  if (!existsSync(qs)) writeFileSync(qs, await embeber(m.id, preguntas.map(m.consulta)))
  console.log(`${nombre}: ${frags.length} fragmentos + ${preguntas.length} preguntas (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}
writeFileSync('data/emb/rowids.json', JSON.stringify(frags.map(f => f.rowid)))
