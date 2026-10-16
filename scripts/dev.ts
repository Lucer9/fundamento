import { existsSync, readFileSync } from 'node:fs'

/** Workers AI through the dev Worker's /dev/ai route (`npm run dev`), retried because wrangler dev restarts on file changes. */
export async function ai(model: string, input: unknown): Promise<any> {
  const url = `${process.env.DEV_URL ?? 'http://localhost:8787'}/dev/ai`
  for (let intento = 0; ; intento++) {
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ model, input }) })
      if (res.ok) return await res.json()
      if (intento >= 5) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    } catch (e) {
      if (intento >= 5) throw e
    }
    await new Promise(r => setTimeout(r, 1500 * (intento + 1)))
  }
}

/** Plain text out of any Workers AI text-generation response shape. */
export const texto = (out: any): string =>
  typeof out.response === 'string'
    ? out.response
    : out.choices?.[0]?.message?.content ??
      (out.output ?? []).filter((p: any) => p.type === 'message').flatMap((p: any) => p.content ?? []).map((c: any) => c.text ?? '').join('')

/** An Anthropic API key from the environment or .dev.vars, if one is set there (it never leaves this machine except to the API). */
function llaveApi(): string | null {
  if (process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) return process.env.ANTHROPIC_API_KEY
  if (!existsSync('.dev.vars')) return null
  const m = readFileSync('.dev.vars', 'utf8').match(/^ANTHROPIC_API_KEY=(sk-ant-\S+)$/m)
  return m?.[1] ?? null
}

/**
 * Claude, a system prompt and one message → text. With an API key in the environment or .dev.vars it calls the
 * Anthropic API (billed to the key's organization, e.g. Claude Max's monthly credit); otherwise scripts/claude.ts,
 * the Claude Code login on this machine.
 */
export async function claude(model: string, system: string, mensaje: string): Promise<string> {
  const llave = llaveApi()
  const url = llave ? 'https://api.anthropic.com/v1/messages' : `${process.env.CLAUDE_URL ?? 'http://localhost:8799'}/v1/messages`
  const headers: Record<string, string> = llave ? { 'content-type': 'application/json', 'x-api-key': llave, 'anthropic-version': '2023-06-01' } : {}
  for (let intento = 0; ; intento++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model, system, max_tokens: 2048, messages: [{ role: 'user', content: mensaje }] }) })
      if (res.ok) return ((await res.json()) as { content: { text: string }[] }).content.map(c => c.text).join('')
      if (intento >= 3) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    } catch (e) {
      if (intento >= 3) throw e
    }
    await new Promise(r => setTimeout(r, 3000 * (intento + 1)))
  }
}
