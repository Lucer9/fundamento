import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { ai, claude, texto } from './dev.ts'
import { DATA, EVAL } from '../src/corpus.ts'

/**
 * Turns every SAT criterio into the question an ordinary taxpayer would ask, without the answer,
 * with gpt-oss-120b through the dev Worker, or with --modelo=claude-… through scripts/claude.ts; each new
 * question records the model that wrote it (entries without `modelo` are gpt-oss-120b). Output eval/preguntas.json is committed so the set can be
 * read and audited. Entries are matched to criterios by annex and title ("Alimentos preparados." is in both
 * annexes), so a re-ingest that renumbers criterios keeps
 * every question and refreshes its number and expected articles; reruns only write questions for new criterios.
 */
const ARCHIVO = `${EVAL}/preguntas.json`
const db = new DatabaseSync(`${DATA}/fundamento.db`, { readOnly: true })
const criterios = db
  .prepare(
    `select c.n, c.anexo, c.id, c.tema, c.texto, json_group_array(cc.ley || ':' || cc.id) as esperados
     from criterio c join criterio_cita cc using (n) group by c.n order by c.n`,
  )
  .all() as { n: number; anexo: number; id: string; tema: string; texto: string; esperados: string }[]
type Pregunta = { n: number; anexo: number; id: string | null; tema: string; pregunta: string; esperados: string[]; modelo?: string }
const MODELO = process.argv.find((a: string) => a.startsWith('--modelo='))?.slice(9) ?? '@cf/openai/gpt-oss-120b'
const SISTEMA = 'Eres una persona en México que paga impuestos y no tiene formación fiscal.'
const PEDIDO =
  'Lee este criterio del SAT y escribe la pregunta que haría una persona común y que este criterio responde. ' +
  'Una sola pregunta, en español natural, de máximo 25 palabras. No menciones números de artículo, leyes, ' +
  'criterios ni al SAT, y no reveles la respuesta. Devuelve solo la pregunta.\n\n'
const hechas: Pregunta[] = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : []
const clave = (c: { anexo: number; tema: string }) => `${c.anexo} ${c.tema}`
const porTema = new Map(hechas.map(p => [clave(p), p]))

async function preguntar(c: (typeof criterios)[number]) {
  const mensaje = `${PEDIDO}Criterio: ${c.tema}\n${c.texto.slice(0, 1500)}`
  const out = MODELO.startsWith('claude')
    ? await claude(MODELO, SISTEMA, mensaje)
    : texto(
        await ai(MODELO, {
          messages: [
            { role: 'system', content: SISTEMA },
            { role: 'user', content: mensaje },
          ],
          max_tokens: 1200,
          reasoning: { effort: 'low' },
        }),
      )
  return out.trim().replace(/^["“]|["”]$/g, '')
}

const pendientes = criterios.filter(c => !porTema.has(clave(c)))
let i = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < pendientes.length) {
      const c = pendientes[i++]
      const pregunta = await preguntar(c)
      if (pregunta.endsWith('?'))
        porTema.set(clave(c), { n: c.n, anexo: c.anexo, id: c.id || null, tema: c.tema, pregunta, esperados: [], ...(MODELO.includes('gpt-oss') ? {} : { modelo: MODELO }) })
      if (porTema.size % 20 === 0) guardar()
    }
  }),
)
function guardar() {
  const todas = criterios.flatMap(c =>
    porTema.has(clave(c)) ? [{ ...porTema.get(clave(c))!, n: c.n, anexo: c.anexo, id: c.id || null, esperados: JSON.parse(c.esperados) as string[] }] : [],
  )
  writeFileSync(ARCHIVO, JSON.stringify(todas, null, 1) + '\n')
  return todas
}
const todas = guardar()
console.log(`${todas.length}/${criterios.length} preguntas en ${ARCHIVO}`)
