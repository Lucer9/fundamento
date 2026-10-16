import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CORPUS, EVAL } from '../src/corpus.ts'
import { pedidoReescritura } from '../src/claude.ts'
import { claude } from './dev.ts'

/**
 * Asks Claude to rewrite each plain-language eval question in the law's own words, the terms that would appear in
 * the article that answers it, and caches the result in <eval>/reescrituras.json. scripts/eval.ts then scores keyword
 * search over question + rewrite: search that needs no embeddings, only an LLM call per query.
 * Usage: [CORPUS=transito] node scripts/reescribir.ts [--modelo=claude-haiku-5-5]
 */
export const MODELO = process.argv.find((a: string) => a.startsWith('--modelo='))?.slice(9) ?? 'claude-haiku-5-5'

const ARCHIVO = `${EVAL}/reescrituras.json`
const hechas: Record<string, string> = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : {}
const preguntas = (JSON.parse(readFileSync(`${EVAL}/preguntas.json`, 'utf8')) as { pregunta: string }[]).map(p => p.pregunta).filter(p => !hechas[p])

let i = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < preguntas.length) {
      const p = preguntas[i++]
      hechas[p] = (await claude(MODELO, pedidoReescritura(CORPUS.materia), p)).replace(/\s+/g, ' ').trim()
      if (Object.keys(hechas).length % 20 === 0) writeFileSync(ARCHIVO, JSON.stringify(hechas, null, 1) + '\n')
    }
  }),
)
writeFileSync(ARCHIVO, JSON.stringify(hechas, null, 1) + '\n')
console.log(`${Object.keys(hechas).length} reescrituras en ${ARCHIVO}`)
