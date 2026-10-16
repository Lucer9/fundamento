import { createServer } from 'node:http'
import { AutoModel, AutoTokenizer } from '@huggingface/transformers'
import { MODELOS, type Modelo } from '../src/buscar.ts'

/**
 * Embeddings computed on this machine from the same open weights Workers AI serves (ONNX export, fp32), so indexing
 * and evals don't spend the daily neuron allowance. For gemma, 40 passages and 40 questions matched the cached
 * Workers AI vectors at cosine ≥ 0.9993. Production still embeds each search query on Workers AI.
 * Imported by scripts/embed.ts; run directly, it serves the Workers AI response shape ({ data: number[][] }) on
 * POST / for the dev Worker (EMBED_URL in .dev.vars), so the answer eval can retrieve without Workers AI.
 * Usage: node scripts/embeddings.ts [port]  (default 8798)
 */
const cargados = new Map<string, Promise<[Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>, Awaited<ReturnType<typeof AutoModel.from_pretrained>>]>>()

export async function embeberLocal(modelo: Modelo, textos: string[], lote = 16): Promise<number[][]> {
  const onnx = MODELOS[modelo].onnx
  if (!cargados.has(onnx)) cargados.set(onnx, Promise.all([AutoTokenizer.from_pretrained(onnx), AutoModel.from_pretrained(onnx, { dtype: 'fp32' })]))
  const [tok, model] = await cargados.get(onnx)!
  const out: number[][] = []
  for (let i = 0; i < textos.length; i += lote) {
    const { sentence_embedding: e } = await model(await tok(textos.slice(i, i + lote), { padding: true, truncation: true }))
    const d = e.dims[1]
    for (let j = 0; j < e.dims[0]; j++) out.push(Array.from((e.data as Float32Array).subarray(j * d, (j + 1) * d)))
  }
  return out
}

if (import.meta.main) {
  const porId = new Map((Object.keys(MODELOS) as Modelo[]).map(m => [MODELOS[m].id as string, m]))
  const puerto = Number(process.argv[2] ?? 8798)
  createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    try {
      const { model, text } = JSON.parse(body) as { model: string; text: string[] }
      const m = porId.get(model)
      if (!m) throw new Error(`modelo desconocido: ${model}`)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: await embeberLocal(m, text) }))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e) }))
    }
  }).listen(puerto, 'localhost', () => console.log(`embeddings locales en http://localhost:${puerto}`))
}
