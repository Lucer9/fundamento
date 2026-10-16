import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { CORPUS, DATA, EVAL } from '../src/corpus.ts'
import { LEYES } from '../src/parse.ts'
import { claude } from './dev.ts'

/**
 * En pocas palabras: a plain-Spanish topic, summary and three search questions for every article, written by Claude
 * ahead of time and kept in resumenes/<corpus>.json (committed, so every published summary can be read in git).
 *   generar [--limite=N] [--solo=LISR:27,RT:30] [--rehacer]
 *                              summarizes articles whose text changed since their summary (all of them the first time;
 *                              --rehacer redoes the selected ones anyway)
 *   juzgar [--n=40] [--semilla=42]
 *                              Claude Opus checks a fixed random sample against the article text (FIEL or ERROR) and
 *                              writes <eval>/resumenes-juicio.json
 *   subir [--local] [--limpiar]
 *                              writes <data>/resumen.sql and loads it into the site's D1 database (remote unless --local);
 *                              rows are replaced in place, and --limpiar first deletes summaries no longer in the file
 * Usage: [CORPUS=transito] node scripts/resumenes.ts <command> [--modelo=claude-sonnet-5-5]
 */
type Entrada = { ley: string; id: string; tema: string; resumen: string; preguntas: string[]; modelo: string; huella: string; fecha: string }
type Articulo = { ley: string; id: string; ubicacion: string; titulo: string | null; texto: string }

const ARCHIVO = `resumenes/${CORPUS.clave}.json`
const JUICIO = `${EVAL}/resumenes-juicio.json`
const RECORTE = 12000
const opcion = (nombre: string) => process.argv.find(a => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3)
const MODELO = opcion('modelo') ?? 'claude-sonnet-5-5'
const [comando] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const hoy = new Date().toISOString().slice(0, 10)

const db = new DatabaseSync(`${DATA}/fundamento.db`, { readOnly: true })
const articulos = (db.prepare(`select ley, id, ubicacion, titulo, texto from articulo order by ley, orden`).all() as Articulo[]).filter(
  a => a.texto.trim().length >= 60 && !/^\(?\s*(se deroga|derogad[oa])/i.test(a.texto.trim()),
)
const clave = (a: { ley: string; id: string }) => `${a.ley}:${a.id}`
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex').slice(0, 16)
const porClave = new Map((existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Entrada[]) : []).map(e => [clave(e), e]))

const guardar = () => {
  mkdirSync('resumenes', { recursive: true })
  writeFileSync(ARCHIVO, JSON.stringify(articulos.flatMap(a => porClave.get(clave(a)) ?? []), null, 1) + '\n')
}

/** The article as the model reads it: law, number, title, where it sits in the law, and its text cut at RECORTE characters. */
const documento = (a: Articulo) => {
  const doc = LEYES[a.ley]
  const ubicacion = (JSON.parse(a.ubicacion) as string[]).join(' > ')
  return [
    `${doc.nombre}, ${doc.tipo === 'reglas' ? 'regla' : 'artículo'} ${a.id}${a.titulo ? `: ${a.titulo}` : ''}`,
    ...(ubicacion ? [`Ubicación: ${ubicacion}`] : []),
    '',
    a.texto.length > RECORTE ? `${a.texto.slice(0, RECORTE)}\n[…texto recortado]` : a.texto,
  ].join('\n')
}

const SISTEMA = `Escribes la sección "En pocas palabras" de un sitio que explica ${CORPUS.materia} en español claro. La leen personas sin formación jurídica y también profesionales.
Recibes un artículo y respondes solo con un objeto JSON, sin texto antes ni después:
{"tema": "...", "resumen": "...", "preguntas": ["...", "...", "..."]}
tema: de 3 a 8 palabras que digan de qué trata el artículo, sin su número ni el nombre de la ley, con mayúscula solo al inicio, nombrando a los sujetos exactos del texto. Se usa como título de página. Ejemplo: "Multas por estacionarse en doble fila".
resumen: 2 o 3 oraciones cortas en español mexicano claro, 90 palabras como máximo. Di a quién aplica y qué obliga, permite o prohíbe. Conserva las condiciones de las que depende la regla: a quién aplica exactamente, desde cuándo corre un plazo, en qué territorio, sobre qué se calcula un porcentaje y, si la regla vale solo para efectos de ciertos artículos o trámites, dilo. Cuando una obligación o una cifra aplica solo a ciertas personas, vehículos o casos, dilo así y no la extiendas a otros. No escribas "solo", "siempre" o "todos" si el texto no lo dice. Copia las cifras exactas como aparecen en el texto (montos, porcentajes, plazos, veces la UMA), sin redondearlas ni convertirlas en rangos. Si el artículo enumera muchos casos, nombra los más importantes y di que hay más: es mejor dejar fuera un caso que una condición. No agregues nada que el texto no diga: ni ejemplos que no estén en él, ni consejos, ni opiniones, ni lo que dicen otros artículos. Si el artículo solo define términos o remite a otros artículos, dilo así. Si el texto viene recortado, resume lo que sí está sin mencionar el recorte.
preguntas: 3 preguntas que una persona escribiría en Google y que el texto de este artículo contesta por completo, en español mexicano natural, sin números de artículo. No preguntes qué significa un término que el artículo no define. Si el artículo trata un caso particular, la pregunta nombra ese caso en vez de ser general. Si el artículo solo enumera, define, ordena o remite, pregunta por eso mismo y no por detalles que el texto no da.`

/** The first JSON object in a reply (code fences or stray text around it are ignored). */
function objeto(r: string) {
  const inicio = r.indexOf('{')
  for (let fin = r.indexOf('}', inicio); inicio >= 0 && fin > 0; fin = r.indexOf('}', fin + 1))
    try {
      return JSON.parse(r.slice(inicio, fin + 1))
    } catch {}
  throw new Error(`respuesta sin JSON: ${r.slice(0, 120)}`)
}

/** The reply's tema, resumen and 3 preguntas, or an error if any is missing. */
function leer(r: string) {
  const j = objeto(r)
  if (typeof j.tema !== 'string' || typeof j.resumen !== 'string' || !Array.isArray(j.preguntas) || j.preguntas.length !== 3 || !j.preguntas.every((p: unknown) => typeof p === 'string'))
    throw new Error(`respuesta sin tema, resumen y 3 preguntas: ${r.slice(0, 120)}`)
  return { tema: j.tema.trim().replace(/\.$/, ''), resumen: j.resumen.trim(), preguntas: (j.preguntas as string[]).map(p => p.trim()) }
}

/** Runs `tarea` over `items` with `n` at a time. */
async function enParalelo<T>(items: T[], n: number, tarea: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await tarea(items[i++]) }))
}

if (comando === 'generar') {
  const solo = opcion('solo')?.split(',')
  const pendientes = articulos
    .filter(a => (solo ? solo.includes(clave(a)) : true))
    .filter(a => process.argv.includes('--rehacer') || porClave.get(clave(a))?.huella !== huella(a.texto))
    .slice(0, Number(opcion('limite') ?? Infinity))
  console.log(`${pendientes.length} artículos por resumir con ${MODELO} (${porClave.size} ya en ${ARCHIVO})`)
  let hechos = 0
  await enParalelo(pendientes, 6, async a => {
    try {
      let r = await claude(MODELO, SISTEMA, documento(a))
      let s
      try {
        s = leer(r)
      } catch {
        r = await claude(MODELO, SISTEMA, documento(a))
        s = leer(r)
      }
      porClave.set(clave(a), { ley: a.ley, id: a.id, ...s, modelo: MODELO, huella: huella(a.texto), fecha: hoy })
      if (++hechos % 20 === 0) {
        guardar()
        console.log(`${hechos}/${pendientes.length}`)
      }
    } catch (e) {
      console.error(`${clave(a)}: ${String(e).slice(0, 200)}`)
    }
  })
  guardar()
  console.log(`${hechos} resumidos → ${ARCHIVO} (${porClave.size} en total)`)
} else if (comando === 'juzgar') {
  const n = Number(opcion('n') ?? 40)
  let semilla = Number(opcion('semilla') ?? 42)
  const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const muestra = articulos.filter(a => porClave.has(clave(a)))
  for (let i = muestra.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1))
    ;[muestra[i], muestra[j]] = [muestra[j], muestra[i]]
  }
  const sistema = `Revisas resúmenes de artículos de ${CORPUS.materia}. Compara el tema, el resumen y las preguntas con el texto del artículo.
FIEL: todo lo que afirman está en el texto, con las cifras, plazos y sujetos correctos, y cada pregunta se responde con el artículo.
ERROR: afirman algo que el texto no dice, cambian una cifra, un plazo o a quién aplica, omiten una condición sin la cual el resumen engaña, o una pregunta no se responde con el artículo.
Responde solo con un objeto JSON: {"veredicto": "FIEL" o "ERROR", "motivo": "una línea"}`
  const juicios: { ley: string; id: string; veredicto: string; motivo: string }[] = []
  await enParalelo(muestra.slice(0, n), 4, async a => {
    const s = porClave.get(clave(a))!
    const r = await claude('claude-opus-5-5', sistema, `${documento(a)}\n\n---\nTema: ${s.tema}\nResumen: ${s.resumen}\nPreguntas:\n${s.preguntas.map(p => `- ${p}`).join('\n')}`)
    const j = objeto(r) as { veredicto: string; motivo: string }
    juicios.push({ ley: a.ley, id: a.id, veredicto: j.veredicto, motivo: j.motivo })
  })
  const fieles = juicios.filter(j => j.veredicto === 'FIEL').length
  mkdirSync(EVAL, { recursive: true })
  writeFileSync(
    JUICIO,
    JSON.stringify({ fecha: hoy, juez: 'claude-opus-5-5', modelos: [...new Set(muestra.slice(0, n).map(a => porClave.get(clave(a))!.modelo))], n: juicios.length, fieles, juicios }, null, 1) + '\n',
  )
  console.log(`${fieles}/${juicios.length} fieles (${((100 * fieles) / juicios.length).toFixed(1)}%) → ${JUICIO}`)
  for (const j of juicios.filter(j => j.veredicto !== 'FIEL')) console.log(`ERROR ${j.ley} ${j.id}: ${j.motivo}`)
} else if (comando === 'subir') {
  const entradas = [...porClave.values()]
  const lit = (s: string) => `'${s.replaceAll("'", "''")}'`
  const filas = entradas.map(e => `(${[e.ley, e.id, e.tema, e.resumen, JSON.stringify(e.preguntas), e.modelo, e.huella, e.fecha].map(lit).join(', ')})`)
  const sql = [
    `create table if not exists resumen (ley text not null, id text not null, tema text not null, resumen text not null, preguntas text not null, modelo text not null, huella text not null, fecha text not null, primary key (ley, id));`,
    ...(process.argv.includes('--limpiar') ? [`delete from resumen where ley || ':' || id not in (${entradas.map(e => lit(clave(e))).join(', ')});`] : []),
    ...Array.from({ length: Math.ceil(filas.length / 50) }, (_, i) =>
      `insert or replace into resumen (ley, id, tema, resumen, preguntas, modelo, huella, fecha) values\n${filas.slice(i * 50, (i + 1) * 50).join(',\n')};`,
    ),
  ].join('\n')
  writeFileSync(`${DATA}/resumen.sql`, sql)
  const local = process.argv.includes('--local')
  const env = CORPUS.clave === 'fiscal' ? ['--env='] : ['--env', CORPUS.clave, ...(local ? ['--persist-to', `.wrangler/state-${CORPUS.clave}`] : [])]
  execFileSync('npx', ['wrangler', 'd1', 'execute', CORPUS.prefijo, ...env, local ? '--local' : '--remote', '--file', `${DATA}/resumen.sql`, '-y'], { stdio: 'inherit' })
  console.log(`${filas.length} resúmenes en ${local ? 'local' : 'producción'} (${CORPUS.prefijo})`)
} else {
  console.log('Uso: [CORPUS=transito] node scripts/resumenes.ts generar [--limite=N] [--solo=LEY:ID,...] [--rehacer] | juzgar [--n=40] | subir [--local] [--limpiar]')
}
