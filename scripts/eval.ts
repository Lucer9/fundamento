import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, SQL_FTS, consultaFts, porArticulo, rrf, type Hit, type Modelo } from '../src/buscar.ts'

/**
 * Asks every SAT criterio's title as a question and records the rank of the first article the criterio
 * itself cites. Keyword search runs the same SQL the Worker runs on D1; vectors are brute-force cosine
 * over the cached embeddings (exact, so any gap to production is Vectorize's approximation).
 * Prints hit@1/5/10 and MRR@10 per method and writes public/eval.json for the site.
 */
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const criterios = (
  db.prepare(`select c.n, c.id, c.materia, c.tema, json_group_array(cc.ley || ':' || cc.id) as esperados
              from criterio c join criterio_cita cc using (n) group by c.n order by c.n`).all() as {
    n: number
    id: string
    materia: string
    tema: string
    esperados: string
  }[]
).map(c => ({ ...c, esperados: JSON.parse(c.esperados) as string[] }))
const rowids = JSON.parse(readFileSync('data/emb/rowids.json', 'utf8')) as number[]
const frag = new Map(
  (db.prepare(`select rowid, ley, id, texto from fragmento`).all() as (Hit & { rowid: number })[]).map(f => [f.rowid, f]),
)
const fts = db.prepare(SQL_FTS)

const normalizar = (v: Float32Array, dims: number) => {
  for (let i = 0; i < v.length; i += dims) {
    let s = 0
    for (let j = i; j < i + dims; j++) s += v[j] * v[j]
    s = Math.sqrt(s)
    for (let j = i; j < i + dims; j++) v[j] /= s
  }
  return v
}
const cargar = (f: string, dims: number) => {
  const b = readFileSync(f)
  return normalizar(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(), dims)
}

function vecinos(docs: Float32Array, q: Float32Array, qi: number, dims: number, k = 100): Hit[] {
  const sims = rowids.map((rowid, d) => {
    let s = 0
    for (let j = 0; j < dims; j++) s += docs[d * dims + j] * q[qi * dims + j]
    return { rowid, s }
  })
  sims.sort((a, b) => b.s - a.s)
  return sims.slice(0, k).map(({ rowid, s }) => ({ ...frag.get(rowid)!, score: s }))
}

const metodos: Record<string, (i: number) => Hit[]> = {}
const kw = criterios.map(c => porArticulo(fts.all(consultaFts(c.tema), 200) as Hit[]))
metodos.keyword = i => kw[i]
for (const m of Object.keys(MODELOS) as Modelo[]) {
  const { dims } = MODELOS[m]
  const docs = cargar(`data/emb/${m}.docs.f32`, dims)
  const qs = cargar(`data/emb/${m}.preguntas.f32`, dims)
  const vec = criterios.map((_, i) => porArticulo(vecinos(docs, qs, i, dims)))
  metodos[`vector ${m}`] = i => vec[i]
  metodos[`hybrid ${m}`] = i => rrf([kw[i], vec[i]])
}

const filas = Object.entries(metodos).map(([nombre, f]) => {
  const rangos = criterios.map((c, i) => {
    const r = f(i)
      .slice(0, 10)
      .findIndex(h => c.esperados.includes(`${h.ley}:${h.id}`))
    return r < 0 ? null : r + 1
  })
  const hit = (k: number) => rangos.filter(r => r !== null && r <= k).length / criterios.length
  const mrr = rangos.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / criterios.length
  return { nombre, hit1: hit(1), hit5: hit(5), hit10: hit(10), mrr, rangos }
})

const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6)
console.log(`n=${criterios.length}\n${'method'.padEnd(16)} hit@1  hit@5 hit@10  MRR@10`)
for (const f of filas) console.log(`${f.nombre.padEnd(16)} ${pct(f.hit1)} ${pct(f.hit5)} ${pct(f.hit10)}  ${f.mrr.toFixed(3)}`)

writeFileSync(
  'public/eval.json',
  JSON.stringify({
    fecha: new Date().toISOString().slice(0, 10),
    n: criterios.length,
    metodos: filas.map(({ rangos, ...f }) => f),
    preguntas: criterios.map((c, i) => ({
      id: c.id || null,
      materia: c.materia,
      tema: c.tema,
      esperados: c.esperados,
      rangos: Object.fromEntries(filas.map(f => [f.nombre, f.rangos[i]])),
    })),
  }),
)
