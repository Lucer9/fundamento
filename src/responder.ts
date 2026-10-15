import { GraphQLError } from 'graphql'
import { encabezado } from './buscar.ts'
import type { Ley } from './parse.ts'
import { cargar, contexto, type Ctx } from './indice.ts'

const SISTEMA = `Eres "fundamento", un buscador de la legislación fiscal federal mexicana (LISR, LIVA y CFF).
Responde en español, en dos a cinco frases, usando solo los artículos que se te dan.
Después de cada afirmación cita su fuente entre corchetes con su clave exacta, por ejemplo [LISR 151], [CFF 29-A] o [SAT 12].
Los criterios del SAT son la interpretación oficial de la autoridad: si uno responde la pregunta, apóyate en él y cítalo.
Si los artículos solo responden una parte, responde esa parte y di qué falta; si no responden nada, dilo en una frase.
No inventes reglas, plazos ni cifras que no aparezcan en los artículos, y no des asesoría personalizada.
Escribe texto plano, sin markdown.`

const REF = /(LISR|LIVA|CFF|SAT)\D{0,20}?(\d+(?:-[A-Za-z]+)*)/i

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
  const clave = await sha256(`${modelo}\n${q.toLowerCase()}`)
  if (!ctx.evaluando) {
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
  const articulos = orden
    .map(k => {
      const [ley, id] = k.split(':') as [Ley, string]
      const texto = trozos.filter(h => `${h.ley}:${h.id}` === k).map(h => h.texto).join('\n[…]\n')
      return `[${ley} ${id}] ${encabezado(ley, id, JSON.parse(filas.get(k)?.ubicacion ?? '[]'))}\n${texto}`
    })
    .join('\n\n')
  const sat = criterios
    .map(c => `[SAT ${c.n}] ${c.anexo === 3 ? 'Práctica que el SAT considera indebida' : 'Criterio normativo del SAT'}: ${c.tema}\n${c.texto.slice(0, 1500)}`)
    .join('\n\n')
  const out = await ctx.env.AI.run(
    modelo as keyof AiModels,
    {
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: `Artículos:\n\n${articulos}${sat ? `\n\nCriterios del SAT:\n\n${sat}` : ''}\n\nPregunta: ${q}` },
      ],
      max_tokens: 2500,
      temperature: 0.2,
      reasoning: { effort: 'low' },
    } as never,
  ).catch(() => {
    throw fuera()
  })

  const permitidas = new Set([...orden.map(k => k.replace(':', ' ')), ...criterios.map(c => `SAT ${c.n}`)])
  const usadas: string[] = []
  const texto = salida(out)
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
