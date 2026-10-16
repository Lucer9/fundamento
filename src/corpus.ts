import { FISCAL } from './corpus/fiscal.ts'
import { TRANSITO } from './corpus/transito.ts'

/**
 * One indexed document. `nombra` says how other texts name it: the word that opens the name ("Ley", "Código",
 * "Reglamento", "Resolución") and a pattern for the lowercased words after it. A reglamento without `nombra` is
 * "the Reglamento de la Ley X" of the law it `reglamenta`. `laLey` is what a bare "la Ley" means inside this
 * document when it isn't the law it reglamenta (a law that defines "la Ley" as itself).
 */
export type Doc = {
  titulo: string
  nombre: string
  corto: string
  tipo: 'ley' | 'reglamento' | 'reglas'
  formato: 'diputados' | 'rmf' | 'cdmx'
  pdf: string
  reglamenta?: string
  laLey?: string
  nombra?: { palabra: 'Ley' | 'Código' | 'Reglamento' | 'Resolución'; resto: RegExp }
  articulos?: string[]
}

/**
 * Everything one site needs to know about its laws: the documents in display order, short forms readers type
 * ("ISR"), how search splits its results into lists, the answer prompt, and the site's own name. `prefijo` names
 * the Worker, D1 database and Vectorize index; `anexos` and `materias` exist only where SAT criteria grade the
 * search; `uma` turns fines written in UMA into pesos. `sinonimos` adds the law's wording to a query that uses the
 * street's ("corralón" → "depósito vehicular"); `siguiente` gives answers each chosen chunk's next chunk too, where a
 * rule's sanction comes in the paragraph after it; `entero` gives answers whole articles up to that many characters
 * instead of chunks; `citantes` adds the paragraphs of other articles that cite one in the answer's context (the
 * article listing when a car goes to the depósito names the rules it covers). `modo` is the measured best search mode, the site's default and
 * search default: vectors fused with keyword search on Claude's rewrite of the query (in the words of `materia`).
 * `contexto` is how answers retrieve: closest chunks per result list (tax law, measured that way), or the top
 * articles of the site's search (traffic law).
 */
export type Corpus = {
  clave: 'fiscal' | 'transito'
  prefijo: string
  sitio: { nombre: string; lema: string; descripcion: string; aviso: string; ejemplos: string[] }
  docs: Record<string, Doc>
  alias: Record<string, string>
  listas: { titulo: string; nota: string; leyes: string[] }[]
  prompt: string
  anexos?: { 7: string; 3: string }
  materias?: Record<string, string>
  uma?: { valor: number; desde: string; fuente: string }
  sinonimos?: [RegExp, string][]
  siguiente?: boolean
  entero?: number
  citantes?: boolean
  modo: 'VECTOR' | 'HYBRID'
  contexto: 'trozos' | 'busqueda'
  materia: string
}

declare const __CORPUS__: string | undefined

/** The corpus this build serves: wrangler's `define` sets __CORPUS__ per environment; Node scripts read CORPUS (default fiscal). */
export const CORPUS: Corpus = (typeof __CORPUS__ === 'string' ? __CORPUS__ : process.env.CORPUS) === 'transito' ? TRANSITO : FISCAL

/** Where the corpus's PDFs, database and embeddings live, and its eval files. */
export const DATA = CORPUS.clave === 'fiscal' ? 'data' : `data/${CORPUS.clave}`
export const EVAL = CORPUS.clave === 'fiscal' ? 'eval' : `eval/${CORPUS.clave}`
export const PUBLICO_EVAL = CORPUS.clave === 'fiscal' ? 'public/eval.json' : `public/eval-${CORPUS.clave}.json`
export const PUBLICO_RESPUESTAS = CORPUS.clave === 'fiscal' ? 'public/eval-respuestas.json' : `public/eval-respuestas-${CORPUS.clave}.json`
