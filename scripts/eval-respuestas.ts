import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { claude } from './dev.ts'
import { ANEXOS } from '../src/parse.ts'
import { DATA, EVAL, PUBLICO_RESPUESTAS } from '../src/corpus.ts'

/**
 * Answer accuracy against SAT's own positions. Each question in eval/preguntas.json goes through the
 * real `answer` resolver (dev Worker, `x-eval: 1` skips cache and limits, `x-answer-model` picks the model).
 * A judge (Claude Opus through scripts/claude.ts, which must be running) reads the SAT criterio and labels the
 * answer CORRECTA, INCORRECTA or INCOMPLETA. Also records whether the answer cites an article the criterio cites.
 * The criterio a question came from is excluded from retrieval (`x-excluir-criterio`; --con-propio keeps it, an upper
 * bound closer to production, where every criterio is searchable), so a run with
 * criterios measures whether the other criterios help, not whether the answer can copy its own source.
 * Every answer and verdict is written to eval/respuestas.<run>.json so the numbers can be audited line by line,
 * and each run's summary is upserted into public/eval-respuestas.json.
 * Usage: node scripts/eval-respuestas.ts <run> "<description>" [--sin-criterios] [--con-propio] [--modelo=claude-haiku-5-5] [--paralelo=4]
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const [CORRIDA = 'base', DESCRIPCION = CORRIDA] = process.argv.slice(2).filter((a: string) => !a.startsWith('--'))
const SIN_CRITERIOS = process.argv.includes('--sin-criterios')
const CON_PROPIO = process.argv.includes('--con-propio')
const MODELO = process.argv.find((a: string) => a.startsWith('--modelo='))?.slice(9) ?? 'claude-haiku-5-5'
const JUEZ = 'claude-opus-5-5'
const ARCHIVO = `${EVAL}/respuestas.${CORRIDA}.json`

/** A criterio's question (fiscal: anexo, id, tema) or a hand-checked one carrying its reference answer (`referencia`). */
type Pregunta = { n: number; anexo?: number; id?: string | null; tema?: string; pregunta: string; esperados: string[]; referencia?: string }
type Resultado = Pregunta & {
  respuesta: string
  fuentes: string[]
  criterios?: number[]
  citaEsperado: boolean
  veredicto: string
  razon: string
  segundos: number
}

const preguntas = (JSON.parse(readFileSync(`${EVAL}/preguntas.json`, 'utf8')) as (Pregunta & { respuesta?: string })[]).map(({ respuesta, ...p }) => ({
  ...p,
  ...(respuesta ? { referencia: respuesta } : {}),
}))
const criterios = new Map(
  (new DatabaseSync(`${DATA}/fundamento.db`, { readOnly: true }).prepare(`select n, texto from criterio`).all() as { n: number; texto: string }[]).map(c => [c.n, c.texto]),
)
const hechos = new Map<string, Resultado>(
  existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Resultado[]).map(r => [r.pregunta, r]) : [],
)

async function responder(pregunta: string, n: number) {
  for (let intento = 0; ; intento++) {
    const t0 = Date.now()
    const res = await fetch(`${DEV}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-eval': '1',
        'x-answer-model': MODELO,
        ...(CON_PROPIO ? {} : { 'x-excluir-criterio': String(n) }),
        ...(SIN_CRITERIOS ? { 'x-sin-criterios': '1' } : {}),
      },
      body: JSON.stringify({
        query: 'query($q: String!) { answer(question: $q) { text sources { key } criteria { number } } }',
        variables: { q: pregunta },
      }),
    }).catch(() => null)
    const j = (await res?.json().catch(() => null)) as {
      data?: { answer: { text: string; sources: { key: string }[]; criteria: { number: number }[] } }
    } | null
    if (j?.data?.answer) return { ...j.data.answer, segundos: (Date.now() - t0) / 1000 }
    if (intento >= 4) throw new Error(`sin respuesta: ${pregunta}`)
    await new Promise(r => setTimeout(r, 2000 * (intento + 1)))
  }
}

async function juzgar(p: Pregunta, respuesta: string) {
  if (p.referencia) return juzgarConReferencia(p, p.referencia, respuesta)
  const crudo = await claude(
    JUEZ,
    'Eres un evaluador estricto de respuestas sobre impuestos en México. Respondes solo con JSON.',
    `Criterio del SAT (la posición correcta según la autoridad):\n${p.tema}\n${(criterios.get(p.n) ?? '').slice(0, 3000)}\n\n` +
      `Pregunta: ${p.pregunta}\n\nRespuesta a evaluar:\n${respuesta}\n\n` +
      'Clasifica la respuesta. CORRECTA: su conclusión coincide con la del criterio. ' +
      'INCORRECTA: contradice el criterio o afirma algo que el criterio niega. ' +
      'INCOMPLETA: no llega a la conclusión del criterio (por ejemplo, dice que no hay información o responde otra cosa). ' +
      'Devuelve solo {"veredicto": "CORRECTA" | "INCORRECTA" | "INCOMPLETA", "razon": "una frase"}.',
  )
  const j = JSON.parse(crudo.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { veredicto?: string; razon?: string }
  return { veredicto: (j.veredicto ?? 'SIN_VEREDICTO').toUpperCase(), razon: j.razon ?? crudo.slice(0, 200) }
}

/** Same labels against an answer written by hand from the law's text (corpora without SAT criterios). */
async function juzgarConReferencia(p: Pregunta, referencia: string, respuesta: string) {
  const crudo = await claude(
    JUEZ,
    'Eres un evaluador estricto de respuestas sobre leyes de la Ciudad de México. Respondes solo con JSON.',
    `Respuesta correcta, verificada en el texto de la ley:\n${referencia}\n\n` +
      `Pregunta: ${p.pregunta}\n\nRespuesta a evaluar:\n${respuesta}\n\n` +
      'Clasifica la respuesta. CORRECTA: da los datos de la respuesta correcta (montos, puntos, plazos) sin contradecirla. ' +
      'INCORRECTA: contradice la respuesta correcta o da un dato distinto. ' +
      'INCOMPLETA: no llega a los datos de la respuesta correcta (por ejemplo, dice que no hay información o responde otra cosa). ' +
      'Devuelve solo {"veredicto": "CORRECTA" | "INCORRECTA" | "INCOMPLETA", "razon": "una frase"}.',
  )
  const j = JSON.parse(crudo.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { veredicto?: string; razon?: string }
  return { veredicto: (j.veredicto ?? 'SIN_VEREDICTO').toUpperCase(), razon: j.razon ?? crudo.slice(0, 200) }
}

const guardar = () =>
  writeFileSync(ARCHIVO, JSON.stringify(preguntas.flatMap(p => (hechos.has(p.pregunta) ? [hechos.get(p.pregunta)!] : [])), null, 1) + '\n')

const pendientes = preguntas.filter(p => !hechos.has(p.pregunta))
let i = 0
await Promise.all(
  Array.from({ length: Number(process.argv.find((a: string) => a.startsWith('--paralelo='))?.slice(11) ?? 4) }, async () => {
    while (i < pendientes.length) {
      const p = pendientes[i++]
      const r = await responder(p.pregunta, p.n)
      const fuentes = r.sources.map(s => s.key)
      hechos.set(p.pregunta, {
        ...p,
        respuesta: r.text,
        fuentes,
        criterios: r.criteria.map(c => c.number),
        citaEsperado: fuentes.some(f => p.esperados.includes(f)),
        ...(await juzgar(p, r.text)),
        segundos: r.segundos,
      })
      if (hechos.size % 10 === 0) guardar()
    }
  }),
)
guardar()

const todos = [...hechos.values()]
const resumen = (anexo: number | null) => {
  const rs = todos.filter(r => anexo === null || r.anexo === anexo)
  const pct = (f: (r: Resultado) => boolean) => rs.filter(f).length / rs.length
  const seg = rs.map(r => r.segundos).sort((a, b) => a - b)
  return {
    n: rs.length,
    correcta: pct(r => r.veredicto === 'CORRECTA'),
    incorrecta: pct(r => r.veredicto === 'INCORRECTA'),
    incompleta: pct(r => r.veredicto === 'INCOMPLETA'),
    citaEsperado: pct(r => r.citaEsperado),
    p50: seg[Math.floor(seg.length / 2)],
    p90: seg[Math.floor(seg.length * 0.9)],
  }
}
const res = {
  corrida: CORRIDA,
  descripcion: DESCRIPCION,
  fecha: new Date().toISOString().slice(0, 10),
  modelo: MODELO,
  juez: JUEZ,
  ...(ANEXOS ? { anexo7: resumen(7), anexo3: resumen(3) } : { todas: resumen(null) }),
}
for (const [k, r] of Object.entries(res).filter(([, v]) => typeof v === 'object') as [string, ReturnType<typeof resumen>][]) {
  const p = (x: number) => `${(100 * x).toFixed(1)}%`
  console.log(`${k} n=${r.n}  correcta ${p(r.correcta)}  incorrecta ${p(r.incorrecta)}  incompleta ${p(r.incompleta)}  cita el artículo del SAT ${p(r.citaEsperado)}  p50 ${r.p50.toFixed(1)} s  p90 ${r.p90.toFixed(1)} s`)
}
const PUBLICO = PUBLICO_RESPUESTAS
const previas = existsSync(PUBLICO) ? ((JSON.parse(readFileSync(PUBLICO, 'utf8')) as { corridas?: (typeof res)[] }).corridas ?? []) : []
writeFileSync(PUBLICO, JSON.stringify({ corridas: [...previas.filter(c => c.corrida !== CORRIDA), res] }))
