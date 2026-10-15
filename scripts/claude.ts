import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

/**
 * Local stand-in for the Anthropic Messages API, answered by the Claude Code CLI on this machine (your own
 * login, no API key). The dev Worker reaches it through ANTHROPIC_BASE_URL in .dev.vars, and the eval scripts
 * call it directly. Each request runs `claude -p` with no tools, plugins, hooks or CLAUDE.md, so the model sees
 * only the system prompt and the message. Logs the list-price cost of every call, which is what the same request
 * would cost through the API. Dev and evals only: a public site has to use a real API key.
 * Usage: node scripts/claude.ts [port]  (default 8799)
 */
const PORT = Number(process.argv[2] ?? 8799)

type Pedido = { model: string; system?: string; messages: { role: string; content: string }[] }

function claude({ model, system = '', messages }: Pedido) {
  const args = ['-p', '--safe-mode', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--model', model, '--system-prompt', system]
  return new Promise<{ result: string; total_cost_usd: number; usage: unknown; is_error: boolean }>((ok, mal) => {
    const p = spawn('claude', args, { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', code => {
      try {
        ok(JSON.parse(out))
      } catch {
        mal(new Error(`claude salió con ${code}: ${(err || out).slice(0, 300)}`))
      }
    })
    p.stdin.end(messages.map(m => m.content).join('\n\n'))
  })
}

let total = 0
createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/messages') return res.writeHead(404).end()
  let body = ''
  for await (const c of req) body += c
  const t0 = Date.now()
  try {
    const pedido = JSON.parse(body) as Pedido
    const r = await claude(pedido)
    if (r.is_error) throw new Error(r.result)
    total += r.total_cost_usd
    console.log(`${pedido.model} ${((Date.now() - t0) / 1000).toFixed(1)} s  $${r.total_cost_usd.toFixed(4)}  (total $${total.toFixed(2)})`)
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ type: 'message', role: 'assistant', model: pedido.model, content: [{ type: 'text', text: r.result }], usage: r.usage, cost_usd: r.total_cost_usd }),
    )
  } catch (e) {
    console.error(String(e))
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { message: String(e) } }))
  }
}).listen(PORT, 'localhost', () => console.log(`Claude local en http://localhost:${PORT}/v1/messages`))
