import { GraphQLError } from 'graphql'
import { encabezado } from './buscar.ts'
import { buscar, cargar, type Ctx } from './indice.ts'

const SISTEMA = `Eres "fundamento", un buscador de la legislación fiscal federal mexicana (LISR, LIVA y CFF).
Responde en español, en dos a cinco frases, usando solo los artículos que se te dan.
Después de cada afirmación cita el artículo entre corchetes con su clave exacta, por ejemplo [LISR 151] o [CFF 29-A].
Si los artículos no alcanzan para responder, dilo en una frase y no inventes.
No des asesoría personalizada ni cifras que no aparezcan en los artículos.`

const REF = /(LISR|LIVA|CFF)\D{0,20}?(\d+(?:-[A-Za-z]+)*)/i

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
 */
export async function responder(ctx: Ctx, pregunta: string) {
  const q = pregunta.trim().replace(/\s+/g, ' ')
  if (q.length < 3 || q.length > 300) throw new GraphQLError('La pregunta debe tener entre 3 y 300 caracteres.')
  const modelo = ctx.env.ANSWER_MODEL
  const clave = await sha256(`${modelo}\n${q.toLowerCase()}`)
  const [hecha] = await ctx.db.all<{ texto: string; fuentes: string }>(`select texto, fuentes from respuesta where clave = ?1`, clave)
  if (hecha) return { text: hecha.texto, keys: JSON.parse(hecha.fuentes) as string[], model: modelo, cached: true }

  if (!(await ctx.env.ANSWER_LIMITER.limit({ key: ctx.ip })).success) throw new GraphQLError('Demasiadas preguntas, espera un minuto.')
  const [uso] = await ctx.db.all<{ n: number }>(
    `insert into uso (dia, n) values (date('now'), 1) on conflict (dia) do update set n = n + 1 returning n`,
  )
  if (uso.n > Number(ctx.env.DAILY_ANSWERS)) throw new GraphQLError('Se acabaron las respuestas de hoy. La búsqueda sigue funcionando.')

  const hits = await buscar(ctx.env, ctx.db, q, 'HYBRID', null, 6)
  const filas = new Map((await cargar(ctx, hits.map(h => `${h.ley}:${h.id}`))).map(f => [`${f.ley}:${f.id}`, f]))
  const contexto = hits
    .map(h => `[${h.ley} ${h.id}] ${encabezado(h.ley, h.id, JSON.parse(filas.get(`${h.ley}:${h.id}`)?.ubicacion ?? '[]'))}\n${h.texto}`)
    .join('\n\n')
  const out = await ctx.env.AI.run(
    modelo as keyof AiModels,
    {
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: `Artículos:\n\n${contexto}\n\nPregunta: ${q}` },
      ],
      max_tokens: 700,
      temperature: 0.2,
    } as never,
  )

  const permitidas = new Set(hits.map(h => `${h.ley} ${h.id}`))
  const usadas: string[] = []
  const texto = salida(out)
    .replace(/\[([^\]]+)\]/g, (_, dentro: string) => {
      const refs = dentro
        .split(/[;,]\s*(?=[A-Za-z])/)
        .map(r => r.match(REF))
        .flatMap(m => (m ? [`${m[1].toUpperCase()} ${m[2]}`] : []))
        .filter(r => permitidas.has(r))
      for (const r of refs) if (!usadas.includes(r)) usadas.push(r)
      return refs.length ? `[${refs.join(', ')}]` : ''
    })
    .replace(/[ \t]+([.,;])/g, '$1')
    .trim()
  const keys = usadas.map(r => r.replace(' ', ':'))
  await ctx.db.all(
    `insert or replace into respuesta (clave, pregunta, texto, fuentes, modelo) values (?1, ?2, ?3, ?4, ?5)`,
    clave,
    q,
    texto,
    JSON.stringify(keys),
    modelo,
  )
  return { text: texto, keys, model: modelo, cached: false }
}
