import { GraphQLError } from 'graphql'
import { claude, type Mensaje } from './claude.ts'
import { CORPUS } from './corpus.ts'
import { db, loaders, type Criterio, type Ctx, type Env } from './indice.ts'
import { FUERA, SISTEMA, cobrar, escribir, fuentes, guardada, guardar, type Respuesta } from './responder.ts'

/** Added to the corpus prompt after the first turn. */
const CONVERSACION =
  '\nEsto es una conversación: responde la última pregunta en el contexto de las anteriores, usando solo los artículos que vienen en el último mensaje y citándolos igual. ' +
  'Si esos artículos no responden lo que se pregunta, dilo.'

const PEDIDO_SOLA =
  `Convierte la última pregunta de esta conversación sobre ${CORPUS.materia} en una sola pregunta que se entienda sin la conversación, ` +
  'con los datos que aporta lo anterior. Devuelve solo la pregunta, en una línea.'

const error = (status: number, message: string) => Response.json({ message }, { status })

/** The request body as a conversation that ends in a question, or why it isn't one (in Spanish). */
function conversacion(cuerpo: unknown): Mensaje[] | string {
  const ms = (cuerpo as { messages?: unknown } | null)?.messages
  if (!Array.isArray(ms) || !ms.length) return 'Falta la conversación: { "messages": [{ "role": "user", "content": "…" }] }.'
  if (ms.length > 12) return 'La conversación admite hasta 12 mensajes; empieza una nueva.'
  if (!ms.every(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim()))
    return 'Cada mensaje necesita un rol (user o assistant) y texto.'
  if (ms.at(-1).role !== 'user') return 'El último mensaje debe ser una pregunta.'
  if (ms.some(m => m.content.length > 1500)) return 'Cada mensaje admite hasta 1,500 caracteres.'
  if (ms.reduce((n: number, m) => n + m.content.length, 0) > 8000) return 'La conversación es demasiado larga; empieza una nueva.'
  return ms.map(m => ({ role: m.role, content: m.content.trim() }))
}

/** The conversation as one standalone search question, written by Haiku; without it, the last two questions together. */
async function preguntaSola(ctx: Ctx, mensajes: Mensaje[]) {
  const respaldo = mensajes
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => m.content)
    .join(' ')
    .slice(-300)
  if (!ctx.env.ANTHROPIC_API_KEY) return respaldo
  const charla = mensajes
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'Pregunta' : 'Respuesta'}: ${m.content.slice(0, 800)}`)
    .join('\n\n')
  return claude(ctx.env, ctx.env.REWRITE_MODEL ?? 'claude-haiku-5-5', PEDIDO_SOLA, charla, 200)
    .then(t => t.replace(/\s+/g, ' ').trim().slice(0, 300) || respaldo)
    .catch(e => {
      console.error('chat: no se pudo reformular la pregunta', String(e))
      return respaldo
    })
}

/** The SAT criterios an answer cites, in the shape GraphQL gives them. */
async function criterios(ctx: Ctx, ns: number[]) {
  if (!ns.length) return []
  const filas = await ctx.db.all<Criterio>(`select * from criterio where n in (select value from json_each(?1))`, JSON.stringify(ns))
  return ns
    .flatMap(n => filas.filter(c => c.n === n))
    .map(c => ({ number: c.n, id: c.id || null, kind: c.anexo === 3 ? 'IMPROPER_PRACTICE' : 'NORMATIVE', title: c.tema }))
}

/**
 * POST /chat: the answer box as a conversation, streamed as server-sent events: `delta` events with text, then one
 * `fin` with the sources, or one `error`. The first turn is the GraphQL answer, with the same FAQ match, cache and
 * prompt. A follow-up becomes one standalone question (Haiku) for retrieval and is answered with the earlier turns as
 * real messages. Every new turn spends the per-IP limit and daily cap that answers do. The per-request context is the
 * one the GraphQL endpoint builds, dev headers included.
 */
export async function chat(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'Usa POST.')
  const mensajes = conversacion(await request.json().catch(() => null))
  if (typeof mensajes === 'string') return error(400, mensajes)
  const q = mensajes.at(-1)!.content.replace(/\s+/g, ' ')
  if (q.length < 3) return error(400, 'La pregunta debe tener al menos 3 caracteres.')
  const d = db(env)
  const dev = env.DEV === '1'
  const ctx: Ctx = {
    env,
    db: d,
    ip: request.headers.get('cf-connecting-ip') ?? 'local',
    modeloRespuesta: (dev && request.headers.get('x-answer-model')) || (env.ANTHROPIC_API_KEY ? env.CLAUDE_MODEL : env.ANSWER_MODEL),
    evaluando: dev && request.headers.get('x-eval') === '1',
    excluir: dev && request.headers.get('x-excluir-criterio') ? Number(request.headers.get('x-excluir-criterio')) : null,
    sinCriterios: dev && request.headers.get('x-sin-criterios') === '1',
    load: loaders(d, true),
  }
  const primera = mensajes.length === 1
  const hecha = primera && !ctx.evaluando ? await guardada(ctx, q) : null
  if (!hecha && !ctx.evaluando) {
    const no = await cobrar(ctx)
    if (no) return error(429, no)
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const w = writable.getWriter()
  const bytes = new TextEncoder()
  const enviar = (evento: string, datos: unknown) => w.write(bytes.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)).catch(() => {})
  const fin = async (r: Respuesta) =>
    enviar('fin', {
      sources: r.keys.map(k => {
        const [law, number] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        return { key: `${law} ${number}`, law, number }
      }),
      criteria: await criterios(ctx, r.criterios),
      model: r.model,
      cached: r.cached,
    })
  void (async () => {
    try {
      if (hecha) {
        void enviar('delta', { text: hecha.text })
        return await fin(hecha)
      }
      const consulta = primera && q.length <= 300 ? q : await preguntaSola(ctx, mensajes)
      const { bloque, permitidas } = await fuentes(ctx, consulta)
      const ultima: Mensaje = { role: 'user', content: `${bloque}\n\nPregunta: ${primera ? q : mensajes.at(-1)!.content}` }
      const r = await escribir(ctx, primera ? SISTEMA : SISTEMA + CONVERSACION, [...mensajes.slice(0, -1), ultima], permitidas, text => void enviar('delta', { text }))
      if (primera && !ctx.evaluando) await guardar(ctx, q, r)
      await fin({ text: r.texto, keys: r.keys, criterios: r.criterios, model: ctx.modeloRespuesta, cached: false })
    } catch (e) {
      if (!(e instanceof GraphQLError)) console.error('chat: falló', String(e))
      await enviar('error', { message: e instanceof GraphQLError ? e.message : FUERA })
    } finally {
      await w.close().catch(() => {})
    }
  })()
  return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } })
}
