import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { porArticulo, type Hit } from '../src/buscar.ts'

/**
 * Production parity: replays the cached gemma embeddings of the plain-language questions against the real
 * Vectorize index (approximate search, through the dev Worker's /dev/vec) and compares each question's rank
 * with the exact brute-force rank recorded by `npm run eval`. Needs no Workers AI calls.
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const DIMS = 768
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const frag = new Map((db.prepare(`select huella, ley, id from fragmento`).all() as (Hit & { huella: string })[]).map(f => [f.huella, f]))
const criterios = db.prepare(`select n from criterio c where exists (select 1 from criterio_cita cc where cc.n = c.n) order by n`).all() as { n: number }[]
const preguntas = new Map((JSON.parse(readFileSync('eval/preguntas.json', 'utf8')) as { n: number; esperados: string[] }[]).map(p => [p.n, p]))
const evalJson = JSON.parse(readFileSync('public/eval.json', 'utf8'))
const exactos = (evalJson.naturales.preguntas as { rangos: Record<string, number | null> }[]).map(p => p.rangos['vector gemma'])
const b = readFileSync('data/emb/gemma.naturales.f32')
const v = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)

const aprox: (number | null)[] = []
for (const [i, c] of criterios.entries()) {
  const res = await fetch(`${DEV}/dev/vec`, {
    method: 'POST',
    body: JSON.stringify({ vector: Array.from(v.subarray(i * DIMS, (i + 1) * DIMS)), topK: 100, filter: { tipo: 'ley' } }),
  })
  const { matches } = (await res.json()) as { matches: { id: string; score: number }[] }
  const hits = porArticulo(matches.flatMap(m => (frag.has(m.id) ? [{ ...frag.get(m.id)!, score: m.score }] : [])))
  const r = hits.slice(0, 10).findIndex(h => preguntas.get(c.n)!.esperados.includes(`${h.ley}:${h.id}`))
  aprox.push(r < 0 ? null : r + 1)
}
const hit = (rs: (number | null)[], k: number) => rs.filter(r => r !== null && r <= k).length / rs.length
const iguales = aprox.filter((r, i) => r === exactos[i]).length
const pct = (x: number) => `${(100 * x).toFixed(1)}%`
console.log(`n=${aprox.length}  exact hit@1 ${pct(hit(exactos, 1))} hit@5 ${pct(hit(exactos, 5))} hit@10 ${pct(hit(exactos, 10))}`)
console.log(`       Vectorize hit@1 ${pct(hit(aprox, 1))} hit@5 ${pct(hit(aprox, 5))} hit@10 ${pct(hit(aprox, 10))}`)
console.log(`same rank on ${iguales}/${aprox.length} questions`)
writeFileSync('eval/ann.json', JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), n: aprox.length, exactos, aprox }) + '\n')
