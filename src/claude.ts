import type { Env } from './indice.ts'

export type Mensaje = { role: 'user' | 'assistant'; content: string }

const pedido = (env: Env, cuerpo: object) =>
  fetch(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(cuerpo),
  })

const textoDe = (j: { content: { type: string; text?: string }[] }) => j.content.flatMap(b => (b.type === 'text' ? [b.text ?? ''] : [])).join('')

/** Claude through the Anthropic Messages API, or through scripts/claude.ts in dev (ANTHROPIC_BASE_URL). */
export async function claude(env: Env, model: string, system: string, content: string, maxTokens = 1024) {
  const res = await pedido(env, { model, system, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return textoDe(await res.json())
}

/**
 * Server-sent events, fed text in chunks of any size: calls `alEvento` with each complete event's name and data.
 * Returns the feeder; feed it a final '\n\n' to flush.
 */
export function sse(alEvento: (evento: string, datos: string) => void) {
  let resto = ''
  return (trozo: string) => {
    resto += trozo
    for (let m = /\r?\n\r?\n/.exec(resto); m; m = /\r?\n\r?\n/.exec(resto)) {
      const bloque = resto.slice(0, m.index)
      resto = resto.slice(m.index + m[0].length)
      let evento = 'message'
      const datos: string[] = []
      for (const linea of bloque.split(/\r?\n/)) {
        if (linea.startsWith('event:')) evento = linea.slice(6).trim()
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''))
      }
      if (datos.length) alEvento(evento, datos.join('\n'))
    }
  }
}

/**
 * The text of a Messages API response, handed to `alTexto` as it arrives. A streamed response comes delta by delta;
 * a plain JSON message (scripts/claude.ts in dev does not stream) comes as one piece. An error event mid-stream throws.
 */
export async function leerRespuesta(res: Response, alTexto: (t: string) => void) {
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    const texto = textoDe(await res.json())
    if (texto) alTexto(texto)
    return texto
  }
  let todo = ''
  const leer = sse((_, datos) => {
    const d = JSON.parse(datos) as { type: string; delta?: { type: string; text?: string }; error?: { type: string; message: string } }
    if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta' && d.delta.text) {
      todo += d.delta.text
      alTexto(d.delta.text)
    } else if (d.type === 'error') throw new Error(`${d.error?.type}: ${d.error?.message}`)
  })
  const decodificador = new TextDecoder()
  for await (const trozo of res.body as unknown as AsyncIterable<Uint8Array>) leer(decodificador.decode(trozo, { stream: true }))
  leer(`${decodificador.decode()}\n\n`)
  return todo
}

/** Claude on a conversation, streamed: each piece of text reaches `alTexto` as it is written; returns the whole text. */
export async function claudeEnVivo(env: Env, model: string, system: string, messages: Mensaje[], alTexto: (t: string) => void, maxTokens = 1024) {
  const res = await pedido(env, { model, system, max_tokens: maxTokens, messages, stream: true })
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return leerRespuesta(res, alTexto)
}

/**
 * The instruction for rewriting a question in the law's own words before keyword search. Keyword search on the
 * rewrite fused with vectors scored best on both eval sets; scripts/reescribir.ts uses the same text for the eval.
 */
export const pedidoReescritura = (materia: string) =>
  `Reescribe la pregunta como términos de búsqueda en el lenguaje de ${materia}: las palabras y frases que aparecerían en el artículo que la responde. ` +
  'Incluye sinónimos técnicos. No inventes números de artículo ni de regla. Devuelve solo los términos, en una línea.'
