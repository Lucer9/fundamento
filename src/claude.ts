import type { Env } from './indice.ts'

/** Claude through the Anthropic Messages API, or through scripts/claude.ts in dev (ANTHROPIC_BASE_URL). */
export async function claude(env: Env, model: string, system: string, content: string, maxTokens = 1024) {
  const res = await fetch(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, system, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  })
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { content: { type: string; text?: string }[] }
  return j.content.flatMap(b => (b.type === 'text' ? [b.text ?? ''] : [])).join('')
}

/**
 * The instruction for rewriting a question in the law's own words before keyword search. Keyword search on the
 * rewrite fused with vectors scored best on both eval sets; scripts/reescribir.ts uses the same text for the eval.
 */
export const pedidoReescritura = (materia: string) =>
  `Reescribe la pregunta como términos de búsqueda en el lenguaje de ${materia}: las palabras y frases que aparecerían en el artículo que la responde. ` +
  'Incluye sinónimos técnicos. No inventes números de artículo ni de regla. Devuelve solo los términos, en una línea.'
