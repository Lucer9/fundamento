import { buscarTexto, sql } from '../src/db.ts'

/**
 * Asks every SAT criterio's title as a question and checks whether an article the criterio
 * itself cites comes back in the top k. Prints hit@1/5/10 and a few misses.
 */
const criterios = await sql<{ tema: string; citas: { ley: string; id: string }[] }[]>`select tema, citas from criterio order by n`
const K = [1, 5, 10]
const hits = Object.fromEntries(K.map(k => [k, 0]))
const fallos: string[] = []
for (const c of criterios) {
  const esperado = new Set(c.citas.map(r => `${r.ley}:${r.id}`))
  const rank = (await buscarTexto(c.tema, 10)).findIndex(h => esperado.has(`${h.ley}:${h.id}`))
  for (const k of K) if (rank >= 0 && rank < k) hits[k]++
  if (rank < 0 && fallos.length < 5) fallos.push(`  ${c.tema.slice(0, 80)} → ${[...esperado].join(' ')}`)
}
const pct = (n: number) => `${((100 * n) / criterios.length).toFixed(1)}%`
console.log(`keyword  n=${criterios.length}  ${K.map(k => `hit@${k} ${pct(hits[k])}`).join('  ')}`)
console.log(`misses:\n${fallos.join('\n')}`)
await sql.end()
