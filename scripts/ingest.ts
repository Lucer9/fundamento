import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { encabezado, terminos } from '../src/buscar.ts'
import { ANEXOS, LEYES, derogado, fragmentos, menciones, parseCriterios, parseLey, type Ley } from '../src/parse.ts'

const RAW = 'data/raw'
mkdirSync(RAW, { recursive: true })

/** Downloads a PDF once into data/raw and extracts its text with macOS PDFKit (macOS only; pdfjs-dist would make this portable). */
async function texto(url: string, nombre: string) {
  const pdf = resolve(RAW, `${nombre}.pdf`)
  if (!existsSync(pdf)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()))
  }
  const js = `ObjC.import('PDFKit'); $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(${JSON.stringify(pdf)})).string.js`
  return execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { encoding: 'utf8', maxBuffer: 1 << 26 })
}

const leyes = Object.keys(LEYES) as Ley[]
const articulos = (await Promise.all(leyes.map(async l => parseLey(await texto(LEYES[l].pdf, l), l)))).flat()
const existe = new Set(articulos.map(a => `${a.ley}:${a.id}`))
const enlaces = articulos.flatMap(a =>
  menciones(a.texto, a.ley)
    .filter(m => existe.has(`${m.ley}:${m.id}`) && !(m.ley === a.ley && m.id === a.id))
    .map(m => ({ de_ley: a.ley, de_id: a.id, inicio: m.inicio, fin: m.fin, a_ley: m.ley, a_id: m.id })),
)
const criterios = (
  await Promise.all(([7, 3] as const).map(async anexo => parseCriterios(await texto(ANEXOS[anexo], `anexo${anexo}`)).map(c => ({ ...c, anexo }))))
)
  .flat()
  .map(c => ({ ...c, citas: c.citas.filter(r => existe.has(`${r.ley}:${r.id}`)) }))
  .filter(c => c.citas.length)
const frags = articulos
  .filter(a => !derogado(a.texto))
  .flatMap(a => fragmentos(a.texto).map((t, n) => ({ ley: a.ley, id: a.id, n, texto: t, titulo: encabezado(a.ley, a.id, a.ubicacion) })))
  .map((f, i) => ({ rowid: i + 1, ...f }))

const lit = (v: unknown) => (typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`)

/** Multi-row INSERTs kept under D1's 100 KB statement limit. */
function inserts(tabla: string, filas: Record<string, unknown>[], cols: string[]) {
  const out: string[] = []
  let lote: string[] = []
  let tam = 0
  const cerrar = () => lote.length && out.push(`insert into ${tabla} (${cols.join(', ')}) values\n${lote.join(',\n')};`)
  for (const f of filas) {
    const fila = `(${cols.map(c => lit(f[c])).join(', ')})`
    if (tam + fila.length > 90_000) cerrar(), (lote = []), (tam = 0)
    lote.push(fila)
    tam += fila.length
  }
  cerrar()
  return out.join('\n')
}

const seed = [
  readFileSync('schema.sql', 'utf8'),
  inserts(
    'articulo',
    articulos.map(a => ({ ...a, ubicacion: JSON.stringify(a.ubicacion), reformas: JSON.stringify(a.reformas), actualizaciones: JSON.stringify(a.actualizaciones) })),
    ['ley', 'id', 'orden', 'ubicacion', 'texto', 'reformas', 'actualizaciones'],
  ),
  inserts('enlace', enlaces, ['de_ley', 'de_id', 'inicio', 'fin', 'a_ley', 'a_id']),
  inserts(
    'criterio',
    criterios.map((c, n) => ({ ...c, n, id: c.id ?? '' })),
    ['n', 'anexo', 'id', 'materia', 'tema', 'texto'],
  ),
  inserts(
    'criterio_cita',
    criterios.flatMap((c, n) => c.citas.map(r => ({ n, ...r }))),
    ['n', 'ley', 'id'],
  ),
  inserts('fragmento', frags, ['rowid', 'ley', 'id', 'n', 'texto']),
  inserts(
    'fts',
    frags.map(f => ({ rowid: f.rowid, terminos: terminos(`${f.titulo}\n${f.texto}`).join(' ') })),
    ['rowid', 'terminos'],
  ),
].join('\n')

writeFileSync('data/seed.sql', seed)
rmSync('data/fundamento.db', { force: true })
const db = new DatabaseSync('data/fundamento.db')
db.exec(seed)
db.close()

const porLey = leyes.map(l => `${l} ${articulos.filter(a => a.ley === l).length}`).join(', ')
console.log(`articulos: ${porLey}`)
console.log(`enlaces: ${enlaces.length} menciones → ${new Set(enlaces.map(e => `${e.de_ley}:${e.de_id}>${e.a_ley}:${e.a_id}`)).size} aristas`)
console.log(`fragmentos: ${frags.length} (de ${articulos.filter(a => !derogado(a.texto)).length} artículos vigentes)`)
console.log(`criterios: anexo 7 ${criterios.filter(c => c.anexo === 7).length}, anexo 3 ${criterios.filter(c => c.anexo === 3).length}`)
console.log(`data/seed.sql ${(seed.length / 1e6).toFixed(1)} MB, data/fundamento.db`)
