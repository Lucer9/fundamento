import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MODELOS, SQL_FTS, consultaFts, porArticulo, rrf, type Hit, type Modelo } from '../src/buscar.ts'

/**
 * Asks every SAT criterio's title as a question and records the rank of the first article the criterio
 * itself cites. Anexo 7 (criterios normativos) is the set methods were tuned on; Anexo 3 (prácticas
 * indebidas) is held out and only ever reported. Keyword search runs the same SQL the Worker runs on D1;
 * vectors are brute-force cosine over the cached embeddings (exact, so any gap to production is
 * Vectorize's approximation). The reranker step calls Workers AI through the dev Worker and is cached.
 * Writes public/eval.json for the site.
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const db = new DatabaseSync('data/fundamento.db', { readOnly: true })
const criterios = (
  db.prepare(`select c.n, c.anexo, c.id, c.materia, c.tema, json_group_array(cc.ley || ':' || cc.id) as esperados
              from criterio c join criterio_cita cc using (n) group by c.n order by c.n`).all() as {
    n: number
    anexo: number
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

/** Cross-encoder rerank of the top 20 with bge-reranker-base; results cached in data/emb/rerank.json. */
async function reordenar(base: Hit[][]): Promise<Hit[][]> {
  const archivo = 'data/emb/rerank.json'
  const cache: Record<string, string[]> = existsSync(archivo) ? JSON.parse(readFileSync(archivo, 'utf8')) : {}
  const out: Hit[][] = []
  for (const [i, c] of criterios.entries()) {
    const top = base[i].slice(0, 20)
    const clave = `${c.tema}\n${top.map(h => `${h.ley}:${h.id}`).join(',')}`
    if (!cache[clave]) {
      const res = await fetch(`${DEV}/dev/ai`, {
        method: 'POST',
        body: JSON.stringify({ model: '@cf/baai/bge-reranker-base', input: { query: c.tema, contexts: top.map(h => ({ text: h.texto })) } }),
      })
      const j = (await res.json()) as { response: { id: number; score: number }[] }
      cache[clave] = j.response.sort((a, b) => b.score - a.score).map(r => `${top[r.id].ley}:${top[r.id].id}`)
      writeFileSync(archivo, JSON.stringify(cache))
    }
    const orden = cache[clave]
    out.push([...top].sort((a, b) => orden.indexOf(`${a.ley}:${a.id}`) - orden.indexOf(`${b.ley}:${b.id}`)).concat(base[i].slice(20)))
  }
  return out
}

const metodos: Record<string, Hit[][]> = {}
const kw = criterios.map(c => porArticulo(fts.all(consultaFts(c.tema), 200) as Hit[]))
metodos.keyword = kw
for (const m of Object.keys(MODELOS) as Modelo[]) {
  const { dims } = MODELOS[m]
  const docs = cargar(`data/emb/${m}.docs.f32`, dims)
  const qs = cargar(`data/emb/${m}.preguntas.f32`, dims)
  const vec = criterios.map((_, i) => porArticulo(vecinos(docs, qs, i, dims)))
  metodos[`vector ${m}`] = vec
  metodos[`hybrid ${m}`] = vec.map((v, i) => rrf([kw[i], v]))
}
metodos['hybrid bge-m3 kw×0.5'] = metodos['vector bge-m3'].map((v, i) => rrf([kw[i], v], 60, [0.5, 1]))
metodos['vector bge-m3 + rerank'] = await reordenar(metodos['vector bge-m3'])

type Rangos = (number | null)[]

/**
 * Percentile bootstrap 95% interval over questions (2,000 resamples, seeded so reruns match).
 * With a second ranking it resamples the same questions for both and bounds the paired difference a − b.
 */
function intervalo(a: Rangos, metrica: (rs: Rangos) => number, b?: Rangos) {
  let semilla = 42
  const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const vals = Array.from({ length: 2000 }, () => {
    const idx = a.map(() => Math.floor(azar() * a.length))
    return metrica(idx.map(i => a[i])) - (b ? metrica(idx.map(i => b[i])) : 0)
  }).sort((x, y) => x - y)
  return [vals[50], vals[1949]]
}

function medir(anexo: number) {
  const idx = criterios.flatMap((c, i) => (c.anexo === anexo ? [i] : []))
  const filas = Object.entries(metodos).map(([nombre, hits]) => {
    const rangos = idx.map(i => {
      const r = hits[i].slice(0, 10).findIndex(h => criterios[i].esperados.includes(`${h.ley}:${h.id}`))
      return r < 0 ? null : r + 1
    })
    const hit = (k: number, rs = rangos) => rs.filter(r => r !== null && r <= k).length / rs.length
    const mrr = (rs = rangos) => rs.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / rs.length
    return { nombre, hit1: hit(1), hit5: hit(5), hit10: hit(10), mrr: mrr(), ic5: intervalo(rangos, rs => hit(5, rs)), icMrr: intervalo(rangos, mrr), rangos }
  })
  const base = filas[0].rangos
  const hit5 = (rs: Rangos) => rs.filter(r => r !== null && r <= 5).length / rs.length
  for (const f of filas) Object.assign(f, { delta5: intervalo(f.rangos, hit5, base) })
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6)
  const ic = ([a, b]: number[], signo = false) =>
    `[${[a, b].map(x => `${signo && x > 0 ? '+' : ''}${(100 * x).toFixed(0)}`).join(', ')}]`.padEnd(11)
  console.log(`\nAnexo ${anexo}  n=${idx.length}\n${'method'.padEnd(24)} hit@1  hit@5 (95% CI)    Δhit@5 vs keyword  hit@10  MRR@10`)
  for (const f of filas as (typeof filas[number] & { delta5: number[] })[])
    console.log(
      `${f.nombre.padEnd(24)} ${pct(f.hit1)} ${pct(f.hit5)} ${ic(f.ic5)} ${f === filas[0] ? ''.padEnd(18) : `${(100 * (f.hit5 - filas[0].hit5) >= 0 ? '+' : '') + (100 * (f.hit5 - filas[0].hit5)).toFixed(1)} ${ic(f.delta5, true)}`.padEnd(18)} ${pct(f.hit10)}  ${f.mrr.toFixed(3)}`,
    )
  return {
    n: idx.length,
    metodos: filas.map(({ rangos, ...f }) => f),
    preguntas: idx.map((i, j) => ({
      id: criterios[i].id || null,
      materia: criterios[i].materia,
      tema: criterios[i].tema,
      esperados: criterios[i].esperados,
      rangos: Object.fromEntries(filas.map(f => [f.nombre, f.rangos[j]])),
    })),
  }
}

const ajuste = medir(7)
const reserva = medir(3)
writeFileSync(
  'public/eval.json',
  JSON.stringify({
    fecha: new Date().toISOString().slice(0, 10),
    nombre: 'Anexo 7 de la RMF 2026 (criterios normativos)',
    ...ajuste,
    holdout: { nombre: 'Anexo 3 de la RMF 2026 (prácticas fiscales indebidas)', ...reserva },
  }),
)
