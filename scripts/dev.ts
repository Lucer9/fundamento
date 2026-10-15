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
