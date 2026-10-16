import { GraphQLError } from 'graphql'
import { encabezado } from './buscar.ts'
import { multas } from './cdmx.ts'
import { claude } from './claude.ts'
import { CORPUS } from './corpus.ts'
import { LEYES, type Ley } from './parse.ts'
import { cargar, citantes, contexto, type Ctx } from './indice.ts'

const SISTEMA = CORPUS.prompt

/** Part of the answer cache key: bump it when retrieval or the prompt changes, so cached answers don't outlive them. */
const VERSION = '2026-10-16 búsqueda híbrida con reescritura'

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


/**
 * Retrieval-grounded answer. Every bracketed citation the model writes is checked against the
 * articles it was given; anything else is dropped, so the API never returns a citation it can't back.
 * Answers are cached per question and model; new ones are rate limited per IP and capped per day.
 * The answer eval (dev only, `x-eval: 1`) skips the cache and the limits.
 */
export async function responder(ctx: Ctx, pregunta: string) {
  const q = pregunta.trim().replace(/\s+/g, ' ')
  if (q.length < 3 || q.length > 300) throw new GraphQLError('La pregunta debe tener entre 3 y 300 caracteres.')
  const modelo = ctx.modeloRespuesta
  const clave = await sha256(`${modelo}\n${VERSION}\n${q.toLowerCase()}`)
  if (!ctx.evaluando) {
    const [publicada] = await ctx.db.all<{ respuesta: string; fuentes: string; modelo: string }>(
      `select respuesta, fuentes, modelo from faq where lower(pregunta) = ?1`,
      q.toLowerCase(),
    ).catch(() => [])
    if (publicada) return { text: publicada.respuesta, ...(JSON.parse(publicada.fuentes) as { keys: string[]; criterios: number[] }), model: publicada.modelo, cached: true }
    const [hecha] = await ctx.db.all<{ texto: string; fuentes: string }>(`select texto, fuentes from respuesta where clave = ?1`, clave)
    if (hecha) return { text: hecha.texto, ...(JSON.parse(hecha.fuentes) as { keys: string[]; criterios: number[] }), model: modelo, cached: true }
    if (!(await ctx.env.ANSWER_LIMITER.limit({ key: ctx.ip })).success) throw new GraphQLError('Demasiadas preguntas, espera un minuto.')
    const [uso] = await ctx.db.all<{ n: number }>(
      `insert into uso (dia, n) values (date('now'), 1) on conflict (dia) do update set n = n + 1 returning n`,
    )
    if (uso.n > Number(ctx.env.DAILY_ANSWERS)) throw new GraphQLError('Se acabaron las respuestas de hoy. La búsqueda sigue funcionando.')
  }

  const fuera = () => new GraphQLError('Las respuestas generadas no están disponibles por ahora. La búsqueda sigue funcionando.')
  const { trozos, criterios } = await contexto(ctx.env, ctx.db, q, ctx.sinCriterios ? 0 : 3, ctx.excluir).catch(() => {
    throw fuera()
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
  const remiten = CORPUS.citantes ? await citantes(ctx.db, orden, q) : []
  for (const c of remiten) if (!orden.includes(`${c.ley}:${c.id}`)) orden.push(`${c.ley}:${c.id}`)
  const otros = remiten.map(c => `[${c.ley} ${c.id}] ${encabezado(c.ley, c.id, [])} (fragmento)\n${conPesos(c.texto)}`).join('\n\n')
  const sat = criterios
    .map(c => `[SAT ${c.n}] ${c.anexo === 3 ? 'Práctica que el SAT considera indebida' : 'Criterio normativo del SAT'}: ${c.tema}\n${c.texto.slice(0, 1500)}`)
    .join('\n\n')
  const usuario = `Artículos:\n\n${articulos}${otros ? `\n\nArtículos que remiten a los anteriores:\n\n${otros}` : ''}${sat ? `\n\nCriterios del SAT:\n\n${sat}` : ''}\n\nPregunta: ${q}`
  const out = await (modelo.startsWith('claude')
    ? claude(ctx.env, modelo, SISTEMA, usuario)
    : ctx.env.AI.run(
        modelo as keyof AiModels,
        {
          messages: [
            { role: 'system', content: SISTEMA },
            { role: 'user', content: usuario },
          ],
          max_tokens: 2500,
          temperature: 0.2,
          reasoning: { effort: 'low' },
        } as never,
      ).then(salida)
  ).catch(e => {
    console.error('respuesta: el modelo falló', String(e))
    throw fuera()
  })

  const permitidas = new Set([...orden.map(k => k.replace(':', ' ')), ...criterios.map(c => `SAT ${c.n}`)])
  const usadas: string[] = []
  const texto = out
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
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
    .trim()
  const keys = usadas.filter(r => !r.startsWith('SAT')).map(r => r.replace(' ', ':'))
  const citados = usadas.filter(r => r.startsWith('SAT')).map(r => Number(r.slice(4)))
  if (!ctx.evaluando) await ctx.db.all(
    `insert or replace into respuesta (clave, pregunta, texto, fuentes, modelo) values (?1, ?2, ?3, ?4, ?5)`,
    clave,
    q,
    texto,
    JSON.stringify({ keys, criterios: citados }),
    modelo,
  )
  return { text: texto, keys, criterios: citados, model: modelo, cached: false }
}
