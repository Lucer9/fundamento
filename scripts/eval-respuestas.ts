import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { ai, texto } from './dev.ts'

/**
 * Answer accuracy against SAT's own positions. Each question in eval/preguntas.json goes through the
 * real `answer` resolver (dev Worker, `x-eval: 1` skips cache and limits). A judge from a different model
 * family (Llama 3.3 70B; answers come from gpt-oss-120b) reads the SAT criterio and labels the answer
 * CORRECTA, INCORRECTA or INCOMPLETA. Also records whether the answer cites an article the criterio cites.
 * The criterio a question came from is always excluded from retrieval (`x-excluir-criterio`), so a run with
 * criterios measures whether the other criterios help, not whether the answer can copy its own source.
 * Every answer and verdict is written to eval/respuestas.<run>.json so the numbers can be audited line by line,
 * and each run's summary is upserted into public/eval-respuestas.json.
 * Usage: node scripts/eval-respuestas.ts <run> "<description>" [--sin-criterios]
 */
const DEV = process.env.DEV_URL ?? 'http://localhost:8787'
const [CORRIDA = 'base', DESCRIPCION = CORRIDA] = process.argv.slice(2).filter((a: string) => !a.startsWith('--'))
const SIN_CRITERIOS = process.argv.includes('--sin-criterios')
const MODELO = '@cf/openai/gpt-oss-120b'
const JUEZ = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const ARCHIVO = `eval/respuestas.${CORRIDA}.json`

type Pregunta = { n: number; anexo: number; id: string | null; tema: string; pregunta: string; esperados: string[] }
type Resultado = Pregunta & {
  respuesta: string
  fuentes: string[]
  criterios?: number[]
  citaEsperado: boolean
  veredicto: string
  razon: string
  segundos: number
}

const preguntas = JSON.parse(readFileSync('eval/preguntas.json', 'utf8')) as Pregunta[]
const criterios = new Map(
  (new DatabaseSync('data/fundamento.db', { readOnly: true }).prepare(`select tema, texto from criterio`).all() as { tema: string; texto: string }[]).map(c => [c.tema, c.texto]),
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
        'x-excluir-criterio': String(n),
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
  const out = await ai(JUEZ, {
    messages: [
      { role: 'system', content: 'Eres un evaluador estricto de respuestas sobre impuestos en México. Respondes solo con JSON.' },
      {
        role: 'user',
        content:
          `Criterio del SAT (la posición correcta según la autoridad):\n${p.tema}\n${(criterios.get(p.tema) ?? '').slice(0, 3000)}\n\n` +
          `Pregunta: ${p.pregunta}\n\nRespuesta a evaluar:\n${respuesta}\n\n` +
          'Clasifica la respuesta. CORRECTA: su conclusión coincide con la del criterio. ' +
          'INCORRECTA: contradice el criterio o afirma algo que el criterio niega. ' +
          'INCOMPLETA: no llega a la conclusión del criterio (por ejemplo, dice que no hay información o responde otra cosa). ' +
          'Devuelve solo {"veredicto": "CORRECTA" | "INCORRECTA" | "INCOMPLETA", "razon": "una frase"}.',
      },
    ],
    max_tokens: 300,
    temperature: 0,
  })
  const crudo = typeof out.response === 'object' ? JSON.stringify(out.response) : texto(out)
  const j = JSON.parse(crudo.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { veredicto?: string; razon?: string }
  return { veredicto: (j.veredicto ?? 'SIN_VEREDICTO').toUpperCase(), razon: j.razon ?? crudo.slice(0, 200) }
}

const guardar = () =>
  writeFileSync(ARCHIVO, JSON.stringify(preguntas.flatMap(p => (hechos.has(p.pregunta) ? [hechos.get(p.pregunta)!] : [])), null, 1) + '\n')

const pendientes = preguntas.filter(p => !hechos.has(p.pregunta))
let i = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
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
const resumen = (anexo: number) => {
  const rs = todos.filter(r => r.anexo === anexo)
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
  anexo7: resumen(7),
  anexo3: resumen(3),
}
for (const k of ['anexo7', 'anexo3'] as const) {
  const r = res[k]
  const p = (x: number) => `${(100 * x).toFixed(1)}%`
  console.log(`${k} n=${r.n}  correcta ${p(r.correcta)}  incorrecta ${p(r.incorrecta)}  incompleta ${p(r.incompleta)}  cita el artículo del SAT ${p(r.citaEsperado)}  p50 ${r.p50.toFixed(1)} s  p90 ${r.p90.toFixed(1)} s`)
}
const PUBLICO = 'public/eval-respuestas.json'
const previas = existsSync(PUBLICO) ? ((JSON.parse(readFileSync(PUBLICO, 'utf8')) as { corridas?: (typeof res)[] }).corridas ?? []) : []
writeFileSync(PUBLICO, JSON.stringify({ corridas: [...previas.filter(c => c.corrida !== CORRIDA), res] }))
