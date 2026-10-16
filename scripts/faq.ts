import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { CORPUS, DATA, PUBLICO_RESPUESTAS } from '../src/corpus.ts'

/**
 * Preguntas frecuentes: questions answered here, ahead of time, and published as pages; the answer box serves them
 * for the same question. Entries live in faq/<corpus>.json (committed, so every published answer can be read in git).
 *   importar <eval run file>   adds the answers a judge marked CORRECTA in an answer eval run (verified)
 *   preguntar "<q>" ...        answers new questions through the dev Worker and the local Claude bridge (unverified)
 *   subir [--local] [--limpiar] writes <data>/faq.sql and loads it into the site's D1 database (remote unless --local);
 *                              rows are replaced in place, and --limpiar first deletes entries no longer in the file
 * Usage: [CORPUS=transito] node scripts/faq.ts <command> [args] [--modelo=claude-sonnet-5-5]
 */
type Entrada = {
  slug: string
  pregunta: string
  respuesta: string
  fuentes: { keys: string[]; criterios: number[] }
  modelo: string
  verificada: 0 | 1
  fecha: string
}

const ARCHIVO = `faq/${CORPUS.clave}.json`
const DEV = process.env.DEV_URL ?? (CORPUS.clave === 'transito' ? 'http://localhost:8788' : 'http://localhost:8787')
const MODELO = process.argv.find(a => a.startsWith('--modelo='))?.slice(9) ?? 'claude-sonnet-5-5'
const [comando, ...args] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const hoy = new Date().toISOString().slice(0, 10)
const entradas: Entrada[] = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : []
const porSlug = new Map(entradas.map(e => [e.slug, e]))

/** "¿Cuánto es la multa por usar el celular?" → "cuanto-es-la-multa-por-usar-el-celular" (at most 80 characters, whole words). */
export const slug = (q: string) =>
  q
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .reduce((s, w) => (s.length + w.length + 1 > 80 ? s : s ? `${s}-${w}` : w), '')

const guardar = () => {
  mkdirSync('faq', { recursive: true })
  writeFileSync(ARCHIVO, JSON.stringify([...porSlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)), null, 1) + '\n')
}

if (comando === 'importar') {
  const archivo = args[0]
  const corrida = basename(archivo).replace(/^respuestas\.|\.json$/g, '')
  const modelo = (JSON.parse(readFileSync(PUBLICO_RESPUESTAS, 'utf8')) as { corridas: { corrida: string; modelo: string }[] }).corridas.find(
    c => c.corrida === corrida,
  )?.modelo
  if (!modelo) throw new Error(`${corrida} no está en ${PUBLICO_RESPUESTAS}`)
  const run = JSON.parse(readFileSync(archivo, 'utf8')) as { pregunta: string; respuesta: string; fuentes: string[]; criterios?: number[]; veredicto: string }[]
  let n = 0
  for (const r of run.filter(r => r.veredicto === 'CORRECTA')) {
    const s = slug(r.pregunta)
    if (porSlug.has(s)) continue
    porSlug.set(s, { slug: s, pregunta: r.pregunta, respuesta: r.respuesta, fuentes: { keys: r.fuentes, criterios: r.criterios ?? [] }, modelo, verificada: 1, fecha: hoy })
    n++
  }
  guardar()
  console.log(`${n} respuestas verificadas de ${corrida} (${modelo}) → ${ARCHIVO} (${porSlug.size} en total)`)
} else if (comando === 'preguntar') {
  for (const pregunta of args) {
    const res = await fetch(`${DEV}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-eval': '1', 'x-answer-model': MODELO },
      body: JSON.stringify({ query: 'query($q: String!) { answer(question: $q) { text sources { key } criteria { number } } }', variables: { q: pregunta } }),
    })
    const j = (await res.json()) as { data?: { answer: { text: string; sources: { key: string }[]; criteria: { number: number }[] } }; errors?: { message: string }[] }
    if (!j.data) throw new Error(`${pregunta}: ${j.errors?.[0]?.message}`)
    const a = j.data.answer
    porSlug.set(slug(pregunta), {
      slug: slug(pregunta),
      pregunta,
      respuesta: a.text,
      fuentes: { keys: a.sources.map(s => s.key), criterios: a.criteria.map(c => c.number) },
      modelo: MODELO,
      verificada: 0,
      fecha: hoy,
    })
    console.log(`\n${pregunta}\n${a.text}`)
  }
  guardar()
} else if (comando === 'subir') {
  const lit = (s: string) => `'${s.replaceAll("'", "''")}'`
  const filas = [...porSlug.values()].map(
    e => `(${[e.slug, e.pregunta, e.respuesta, JSON.stringify(e.fuentes), e.modelo].map(lit).join(', ')}, ${e.verificada}, ${lit(e.fecha)})`,
  )
  const sql = [
    `create table if not exists faq (slug text primary key, pregunta text not null, respuesta text not null, fuentes text not null, modelo text not null, verificada integer not null, fecha text not null);`,
    ...(process.argv.includes('--limpiar') ? [`delete from faq where slug not in (${[...porSlug.keys()].map(lit).join(', ')});`] : []),
    ...Array.from({ length: Math.ceil(filas.length / 50) }, (_, i) =>
      `insert or replace into faq (slug, pregunta, respuesta, fuentes, modelo, verificada, fecha) values\n${filas.slice(i * 50, (i + 1) * 50).join(',\n')};`,
    ),
  ].join('\n')
  writeFileSync(`${DATA}/faq.sql`, sql)
  const local = process.argv.includes('--local')
  const env = CORPUS.clave === 'fiscal' ? ['--env='] : ['--env', CORPUS.clave, ...(local ? ['--persist-to', `.wrangler/state-${CORPUS.clave}`] : [])]
  execFileSync('npx', ['wrangler', 'd1', 'execute', CORPUS.prefijo, ...env, local ? '--local' : '--remote', '--file', `${DATA}/faq.sql`, '-y'], { stdio: 'inherit' })
  console.log(`${filas.length} preguntas en ${local ? 'local' : 'producción'} (${CORPUS.prefijo})`)
} else {
  console.log('Uso: [CORPUS=transito] node scripts/faq.ts importar <corrida.json> | preguntar "<pregunta>" ... | subir [--local]')
}
