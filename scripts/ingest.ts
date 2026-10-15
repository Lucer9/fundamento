import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from '../src/db.ts'
import { ANEXO_7, LEYES, citas, parseCriterios, parseLey, type Ley } from '../src/parse.ts'

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
const todas = articulos.flatMap(a => citas(a.texto, a.ley).map(c => ({ de_ley: a.ley, de_id: a.id, a_ley: c.ley, a_id: c.id })))
const aristas = todas.filter(c => existe.has(`${c.a_ley}:${c.a_id}`) && `${c.de_ley}:${c.de_id}` !== `${c.a_ley}:${c.a_id}`)
const criterios = parseCriterios(await texto(ANEXO_7, 'anexo7')).filter(c => c.citas.some(r => existe.has(`${r.ley}:${r.id}`)))

await sql.unsafe(readFileSync('schema.sql', 'utf8'))
await sql.begin(async tx => {
  await tx`truncate articulo, cita, criterio`
  await tx`insert into articulo ${tx(articulos, 'ley', 'id', 'orden', 'ubicacion', 'texto', 'reformas')}`
  await tx`insert into cita ${tx(aristas)}`
  await tx`insert into criterio ${tx(criterios.map((c, n) => ({ n, ...c, citas: tx.json(c.citas) })), 'n', 'id', 'materia', 'tema', 'texto', 'citas')}`
})

const porLey = leyes.map(l => `${l} ${articulos.filter(a => a.ley === l).length}`).join(', ')
console.log(`articulos: ${porLey}`)
console.log(`citas: ${aristas.length} (${todas.length - aristas.length} dropped: self or unknown target)`)
console.log(`criterios: ${criterios.length}`)
await sql.end()
