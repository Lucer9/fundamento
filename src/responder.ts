import { GraphQLError } from 'graphql'
import { encabezado } from './buscar.ts'
import { multas } from './cdmx.ts'
import { claudeEnVivo, type Mensaje } from './claude.ts'
import { CORPUS } from './corpus.ts'
import { LEYES, type Ley } from './parse.ts'
import { cargar, citantes, contexto, type Ctx } from './indice.ts'

export const SISTEMA = CORPUS.prompt

/** Part of the answer cache key: bump it when retrieval or the prompt changes, so cached answers don't outlive them. */
const VERSION = '2026-10-16 búsqueda híbrida con reescritura'

/** Why there is no generated answer (retrieval or the model failed); search keeps working. */
export const FUERA = 'Las respuestas generadas no están disponibles por ahora. La búsqueda sigue funcionando.'

/** A citation inside brackets: a document code of the corpus (or SAT, for criterios) and an article or rule number. */
const REF = new RegExp(
  String.raw`(${[...Object.keys(LEYES), 'SAT'].sort((a, b) => b.length - a.length).join('|')})\D{0,20}?(\d+(?:\.\d+)*(?:-[A-Za-z]+)*)`,
  'i',
)

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

/**
 * A passage with each fine's peso amount written next to it, "⟨$3,519.30, $3,753.92 o $4,105.85 en 2026⟩", so the
 * model quotes pesos without doing arithmetic. Two numbers are a range, three are the minimum, middle and maximum tiers.
 */
function conPesos(texto: string) {
  if (!CORPUS.uma) return texto
  const { valor, desde } = CORPUS.uma
  let out = ''
  let pos = 0
  for (const m of multas(texto)) {
    const pesos = m.veces.map(v => MXN.format(v * valor))
    const lista = pesos.length === 2 ? pesos.join(' a ') : pesos.length > 2 ? `${pesos.slice(0, -1).join(', ')} o ${pesos.at(-1)}` : pesos[0]
    out += `${texto.slice(pos, m.fin)} ⟨${lista} en ${desde.slice(0, 4)}⟩`
    pos = m.fin
  }
  return out + texto.slice(pos)
}

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Model output → plain text, whichever response shape the Workers AI model uses. */
function salida(out: unknown): string {
  const o = out as { response?: string; output?: { type: string; content?: { text?: string }[] }[]; choices?: { message?: { content?: string } }[] }
  if (typeof o.response === 'string') return o.response
  if (o.choices?.[0]?.message?.content) return o.choices[0].message.content
  return (o.output ?? []).filter(p => p.type === 'message').flatMap(p => p.content ?? []).map(c => c.text ?? '').join('')
}

/** An answer as the API returns it: text with bracketed citations, plus the article keys and SAT criterios it cites. */
export type Respuesta = { text: string; keys: string[]; criterios: number[]; model: string; cached: boolean }

const claveCache = (ctx: Ctx, q: string) => sha256(`${ctx.modeloRespuesta}\n${VERSION}\n${q.toLowerCase()}`)

/** A stored answer to exactly this question: a published FAQ entry first, then one cached for this model and VERSION. */
export async function guardada(ctx: Ctx, q: string): Promise<Respuesta | null> {
  const [publicada] = await ctx.db
    .all<{ respuesta: string; fuentes: string; modelo: string }>(`select respuesta, fuentes, modelo from faq where lower(pregunta) = ?1`, q.toLowerCase())
    .catch(() => [])
  if (publicada) return { text: publicada.respuesta, ...(JSON.parse(publicada.fuentes) as { keys: string[]; criterios: number[] }), model: publicada.modelo, cached: true }
  const [hecha] = await ctx.db.all<{ texto: string; fuentes: string }>(`select texto, fuentes from respuesta where clave = ?1`, await claveCache(ctx, q))
  if (hecha) return { text: hecha.texto, ...(JSON.parse(hecha.fuentes) as { keys: string[]; criterios: number[] }), model: ctx.modeloRespuesta, cached: true }
  return null
}

/** Spends one new answer against the per-IP rate limit and the daily cap; returns why not, in Spanish, or null. */
export async function cobrar(ctx: Ctx): Promise<string | null> {
  if (!(await ctx.env.ANSWER_LIMITER.limit({ key: ctx.ip })).success) return 'Demasiadas preguntas, espera un minuto.'
  const [uso] = await ctx.db.all<{ n: number }>(`insert into uso (dia, n) values (date('now'), 1) on conflict (dia) do update set n = n + 1 returning n`)
  return uso.n > Number(ctx.env.DAILY_ANSWERS) ? 'Se acabaron las respuestas de hoy. La búsqueda sigue funcionando.' : null
}

/** Stores a first answer, keyed by question, model and VERSION, for the GraphQL answer and the chat alike. */
export async function guardar(ctx: Ctx, q: string, r: { texto: string; keys: string[]; criterios: number[] }) {
  await ctx.db.all(
    `insert or replace into respuesta (clave, pregunta, texto, fuentes, modelo) values (?1, ?2, ?3, ?4, ?5)`,
    await claveCache(ctx, q),
    q,
    r.texto,
    JSON.stringify({ keys: r.keys, criterios: r.criterios }),
    ctx.modeloRespuesta,
  )
}

/**
 * What an answer to `consulta` is written from, as one block of text: the retrieved articles (whole when short
 * enough, CORPUS.entero), paragraphs of other articles that cite them (CORPUS.citantes) and the closest SAT
 * criterios; plus the citations an answer may keep. Throws FUERA when retrieval fails.
 */
export async function fuentes(ctx: Ctx, consulta: string) {
  const { trozos, criterios } = await contexto(ctx.env, ctx.db, consulta, ctx.sinCriterios ? 0 : 3, ctx.excluir).catch(() => {
    throw new GraphQLError(FUERA)
  })
  const orden = [...new Set(trozos.map(h => `${h.ley}:${h.id}`))]
  const filas = new Map((await cargar(ctx, orden)).map(f => [`${f.ley}:${f.id}`, f]))
  let presupuesto = 30000
  const articulos = orden
    .map(k => {
      const [ley, id] = k.split(':') as [Ley, string]
      const fila = filas.get(k)
      const entero = !!CORPUS.entero && !!fila && fila.texto.length <= CORPUS.entero && fila.texto.length <= presupuesto
      if (entero) presupuesto -= fila!.texto.length
      const texto = entero ? conPesos(fila!.texto) : trozos.filter(h => `${h.ley}:${h.id}` === k).map(h => conPesos(h.texto ?? '')).join('\n[…]\n')
      return `[${ley} ${id}] ${encabezado(ley, id, JSON.parse(fila?.ubicacion ?? '[]'), fila?.titulo)}\n${texto}`
    })
    .join('\n\n')
  const remiten = CORPUS.citantes ? await citantes(ctx.db, orden, consulta) : []
  for (const c of remiten) if (!orden.includes(`${c.ley}:${c.id}`)) orden.push(`${c.ley}:${c.id}`)
  const otros = remiten.map(c => `[${c.ley} ${c.id}] ${encabezado(c.ley, c.id, [])} (fragmento)\n${conPesos(c.texto)}`).join('\n\n')
  const sat = criterios
    .map(c => `[SAT ${c.n}] ${c.anexo === 3 ? 'Práctica que el SAT considera indebida' : 'Criterio normativo del SAT'}: ${c.tema}\n${c.texto.slice(0, 1500)}`)
    .join('\n\n')
  return {
    bloque: `Artículos:\n\n${articulos}${otros ? `\n\nArtículos que remiten a los anteriores:\n\n${otros}` : ''}${sat ? `\n\nCriterios del SAT:\n\n${sat}` : ''}`,
    permitidas: new Set([...orden.map(k => k.replace(':', ' ')), ...criterios.map(c => `SAT ${c.n}`)]),
  }
}

/**
 * Cleans model text into an answer as it streams: each bracketed citation keeps only references in `permitidas` and
 * disappears when none remain, so the API never returns a citation it can't back; dashes, odd spaces and markdown
 * bold are normalized. Text a later piece could still change (an open bracket, trailing spaces, trailing '*') waits
 * for it. `usadas` lists the references kept, in order of first use.
 */
export function limpiador(permitidas: Set<string>) {
  const usadas: string[] = []
  let pendiente = ''
  let texto = ''
  const limpiar = (s: string) =>
    s
      .replace(/[‐-―−]/g, '-')
      .replace(/[  ]/g, ' ')
      .replace(/【([^】]+)】/g, ' [$1]')
      .replace(/\[([^\]]+)\]/g, (_, dentro: string) => {
        const refs = dentro
          .split(/[;,]\s*(?=[A-Za-z])/)
          .map(r => r.match(REF))
          .flatMap(m => (m ? [`${m[1].toUpperCase()} ${m[2]}`] : []))
          .filter(r => permitidas.has(r))
        for (const r of refs) if (!usadas.includes(r)) usadas.push(r)
        return refs.length ? `[${refs.join(', ')}]` : ''
      })
      .replace(/\s+([.,;])/g, '$1')
      .replace(/\*\*/g, '')
  const soltar = (final: boolean) => {
    let corte = pendiente.length
    if (!final) {
      const abre = Math.max(pendiente.lastIndexOf('['), pendiente.lastIndexOf('【'))
      if (abre >= 0 && !/[\]】]/.test(pendiente.slice(abre)) && corte - abre < 200) corte = abre
      while (corte > 0 && pendiente[corte - 1] === '*') corte--
    }
    let listo = limpiar(pendiente.slice(0, corte))
    const espacio = final ? '' : (listo.match(/\s+$/)?.[0] ?? '')
    pendiente = espacio + pendiente.slice(corte)
    listo = listo.slice(0, listo.length - espacio.length)
    if (!texto) listo = listo.trimStart()
    if (final) listo = listo.trimEnd()
    texto += listo
    return listo
  }
  return {
    usadas,
    get texto() {
      return texto
    },
    empujar: (trozo: string) => {
      pendiente += trozo
      return soltar(false)
    },
    cerrar: () => soltar(true),
  }
}

/**
 * Writes an answer to the conversation in `mensajes` (the last message carries the articles) with the answer model,
 * cleaned by `limpiador`; each cleaned piece reaches `alTexto` as Claude streams it. Throws FUERA when the model fails.
 */
export async function escribir(ctx: Ctx, sistema: string, mensajes: Mensaje[], permitidas: Set<string>, alTexto: (t: string) => void = () => {}) {
  const modelo = ctx.modeloRespuesta
  const limpio = limpiador(permitidas)
  const pasar = (s: string) => void (s && alTexto(s))
  try {
    if (modelo.startsWith('claude')) await claudeEnVivo(ctx.env, modelo, sistema, mensajes, t => pasar(limpio.empujar(t)))
    else
      pasar(
        limpio.empujar(
          salida(
            await ctx.env.AI.run(
              modelo as keyof AiModels,
              { messages: [{ role: 'system', content: sistema }, ...mensajes], max_tokens: 2500, temperature: 0.2, reasoning: { effort: 'low' } } as never,
            ),
          ),
        ),
      )
  } catch (e) {
    console.error('respuesta: el modelo falló', String(e))
    throw new GraphQLError(FUERA)
  }
  pasar(limpio.cerrar())
  return {
    texto: limpio.texto,
    keys: limpio.usadas.filter(r => !r.startsWith('SAT')).map(r => r.replace(' ', ':')),
    criterios: limpio.usadas.filter(r => r.startsWith('SAT')).map(r => Number(r.slice(4))),
  }
}

/**
 * Retrieval-grounded answer to one question (GraphQL `answer`; also the first turn of /chat). Every bracketed
 * citation the model writes is checked against the articles it was given; anything else is dropped, so the API never
 * returns a citation it can't back. Answers are cached per question and model; new ones are rate limited per IP and
 * capped per day. The answer eval (dev only, `x-eval: 1`) skips the cache and the limits.
 */
export async function responder(ctx: Ctx, pregunta: string): Promise<Respuesta> {
  const q = pregunta.trim().replace(/\s+/g, ' ')
  if (q.length < 3 || q.length > 300) throw new GraphQLError('La pregunta debe tener entre 3 y 300 caracteres.')
  if (!ctx.evaluando) {
    const hecha = await guardada(ctx, q)
    if (hecha) return hecha
    const no = await cobrar(ctx)
    if (no) throw new GraphQLError(no)
  }
  const { bloque, permitidas } = await fuentes(ctx, q)
  const r = await escribir(ctx, SISTEMA, [{ role: 'user', content: `${bloque}\n\nPregunta: ${q}` }], permitidas)
  if (!ctx.evaluando) await guardar(ctx, q, r)
  return { text: r.texto, keys: r.keys, criterios: r.criterios, model: ctx.modeloRespuesta, cached: false }
}
