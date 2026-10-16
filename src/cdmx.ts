import type { Articulo, Ley } from './parse.ts'

type Linea = { p: number; x: number; y: number; t: string }
type Parrafo = { lineas: Linea[]; fechas: string[] }

const MARGEN_SUPERIOR = 720
const MAX_INTERLINEA = 16
const PIE = /\s*CONSEJERÍA JURÍDICA Y DE SERVICIOS LEGALES$/u
const IMAGEN = /\s*No se puede mostrar la imagen en este momento\.?/gu
const NOTA =
  /^\p{L}[\p{L} ]*?\s(?:reformad|adicionad|modificad|derogad|recorrid|actualizad)[oa]s?\b[\p{L} ]*?G\.?\s?O[.,]?\s?CDMX\.?\s*(\d{1,2})\s*\/\s*(\d{1,3})\s*\/\s*(\d{4}|\d{2})\.?$/iu
const LATIN = 'Bis|Ter|Quáter|Quater|Quinquies|Sexies|Quintus|Sextus|Septimus'
const SUF = String.raw`(?<suf>(?:\s*-\s*\d+|[\s-]+(?:\d+|${LATIN}|${LATIN.toUpperCase()})(?!\p{L}))*)`
const ART = String.raw`(?:Art[íi]culo|ART[ÍI]CULO)\s*\.?\s*(?<n>\d+)${SUF}`
const ENCABEZADO = new RegExp(String.raw`^${ART}\s*(?:\.\s*[-–]?|[-–])\s*(?![\s\p{Ll}])(?<resto>.*)$`, 'u')
const AL_FINAL = new RegExp(String.raw`^[-–]\s*(?<resto>.*?)\s*${ART}\s*\.$`, 'u')
const DIVISION =
  /^(LIBRO|T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N)\s+(?:[IVXLC]+|PRIMER|SEGUND|TERCER|CUART|QUINT|SEXT|S[ÉE]PTIM|OCTAV|NOVEN|D[ÉE]CIM|VIG[ÉE]SIM|[ÚU]NIC)/iu
const NIVELES = ['LIBRO', 'TITULO', 'CAPITULO', 'SECCION']
const MARCA = /^(?:[IVXLC]+(?:\s+(?:Bis|Ter|Quáter|BIS|TER))?\.|[a-zñ][).]\.?|\d+[.)])\s+(?!\p{Ll})/u

/**
 * Article id in parse.ts normId's canonical form ("12 Bis" → "12-Bis", "127 TER" → "127-Ter"), extended to what normId
 * has no slot for: numbered sub-articles ("449-1", "155 BIS 1" → "155-Bis-1") and rarer Latin suffixes ("449-QUINTUS").
 */
const idDe = (n: string, suf: string) => [n, ...(suf.match(/\d+|\p{L}+/gu) ?? []).map(p => p[0] + p.slice(1).toLowerCase())].join('-')
const esMayus = (t: string) => t === t.toUpperCase() && /\p{Lu}/u.test(t)
const sinAcentos = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '')
const unir = (ts: string[]) => ts.filter(Boolean).reduce((a, t) => (/\p{L}-$/u.test(a) ? a + t : `${a} ${t}`), '').trim()
const fecha = ([, d, m, y]: RegExpMatchArray) => `${y.length === 2 ? `20${y}` : y}-${String(Number(m)).padStart(2, '0')}-${d.padStart(2, '0')}`

/** Body lines of a scripts/pdf-lineas.js dump, without the running header, the CEJUR footer and missing-image placeholders. */
function lineas(raw: string): Linea[] {
  return raw
    .split('\n')
    .map(l => {
      const [p, x, y, ...t] = l.split('\t')
      return { p: Number(p), x: Number(x), y: Number(y), t: t.join(' ').replace(IMAGEN, '').replace(PIE, '').trim() }
    })
    .filter(l => l.t && l.y <= MARGEN_SUPERIOR)
}

/**
 * Groups lines into paragraphs by line spacing: inside a paragraph lines sit 12–13 pt apart, between paragraphs 24–26 pt.
 * Across a page break, a line continues the paragraph unless the page ended on [.:;]. Fracción/inciso markers, article
 * headings and division headings always open a paragraph: some lists are set at line spacing, and the Código Fiscal sets
 * some headings 13 pt below the previous line.
 * Reform notes ("Fracción reformada G.O. CDMX 06/05/2026") follow the paragraph they annotate; their dates go to it.
 */
function parrafos(ls: Linea[]): Parrafo[] {
  const out: Parrafo[] = []
  let prev: Linea | null = null
  for (const l of ls) {
    const nota = l.t.match(NOTA)
    if (nota) {
      out.at(-1)?.fechas.push(fecha(nota))
      continue
    }
    const abre = MARCA.test(l.t) || ENCABEZADO.test(l.t) || AL_FINAL.test(l.t) || (l.x >= 150 && DIVISION.test(l.t))
    const sigue = !abre && prev && (prev.p === l.p ? prev.y - l.y <= MAX_INTERLINEA : !/[.:;]$/.test(prev.t))
    if (sigue) out.at(-1)!.lineas.push(l)
    else out.push({ lineas: [l], fechas: [] })
    prev = l
  }
  return out
}

/** CEJUR (Consejería Jurídica CDMX) law PDF, as scripts/pdf-lineas.js lines → articles, stopping at the transitorios. */
export function parseCdmx(raw: string, ley: string, opciones: { articulos?: string[] } = {}): Articulo[] {
  const out: (Articulo & { pars: string[] })[] = []
  const ruta: string[] = []
  let nombrando = -1
  for (const par of parrafos(lineas(raw))) {
    const [l, ...resto] = par.lineas
    const cur = out.at(-1)
    const compacto = l.t.replace(/\s/g, '')
    if (cur && ((esMayus(l.t) && compacto.includes('TRANSITORI')) || compacto === 'Transitorios')) break
    const div = l.x >= 150 ? l.t.match(DIVISION) : null
    if (div) {
      const nivel = NIVELES.indexOf(sinAcentos(div[1].toUpperCase()))
      ruta.length = nivel
      ruta[nivel] = unir(par.lineas.map(t => t.t))
      nombrando = par.lineas.length === 1 ? nivel : -1
      continue
    }
    const h = (l.t.match(ENCABEZADO) ?? l.t.match(AL_FINAL))?.groups
    if (!h && nombrando >= 0) {
      ruta[nombrando] = unir([ruta[nombrando], ...par.lineas.map(t => t.t)])
      nombrando = -1
      continue
    }
    nombrando = -1
    if (h) {
      out.push({
        ley: ley as Ley,
        id: idDe(h.n, h.suf),
        orden: out.length,
        ubicacion: ruta.filter(Boolean),
        texto: '',
        reformas: [...par.fechas],
        actualizaciones: [],
        pars: [unir([h.resto, ...resto.map(t => t.t)])],
      })
      continue
    }
    if (!cur) continue
    cur.pars.push(unir(par.lineas.map(t => t.t)))
    cur.reformas.push(...par.fechas)
  }
  const quiero = opciones.articulos && new Set(opciones.articulos)
  return out
    .filter(a => !quiero || quiero.has(a.id))
    .map(({ pars, ...a }, orden) => ({
      ...a,
      orden,
      texto: pars.filter(Boolean).join('\n').replace(/^[-–]\s*/, ''),
      reformas: [...new Set(a.reformas)].sort(),
    }))
}

const UNIDADES = 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho veintinueve'.split(' ')
const DECENAS = 'treinta cuarenta cincuenta sesenta setenta ochenta noventa'.split(' ')
const CIENTOS = 'cien ciento doscient trescient cuatrocient quinient seiscient setecient ochocient novecient'.split(' ')
const PALABRA = `(?:${[...UNIDADES, ...DECENAS, 'cien(?:to)?', ...CIENTOS.slice(2).map(c => `${c}[oa]s`), 'mil'].join('|')})(?!\\p{L})`
const NUMERO = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+|${PALABRA}(?:\s+(?:y\s+)?${PALABRA})*)`
const SEPARADOR = /\s*,\s+(?:o\s+)?|\s+[oa]\s+/
const MULTA = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:multa|sanci[óo]n)(?!\p{L})(?:\s+(?:será|por|el|equivalente|a|al|de))*\s*|(?<y>y\s+de\s+))` +
    String.raw`(?<n>${NUMERO}(?:(?:${SEPARADOR.source})${NUMERO})*)\s+(?:veces\s+la\s+(?:Unidad\s+de\s+Medida|UMA)|Unidades\s+de\s+Medida)(?:\s+y\s+Actualizaci[óo]n)?(?!\p{L})`,
  'giu',
)

/** "ciento sesenta" → 160, "cincuenta mil" → 50000, "1,000" → 1000. */
function valor(n: string): number {
  if (/^\d/.test(n)) return Number(n.replace(/,/g, ''))
  let total = 0
  let actual = 0
  for (const w of n.toLowerCase().split(/\s+/)) {
    if (w === 'mil') (total += (actual || 1) * 1000), (actual = 0)
    else if (UNIDADES.includes(w)) actual += UNIDADES.indexOf(w)
    else if (DECENAS.includes(w)) actual += 30 + 10 * DECENAS.indexOf(w)
    else if (w === 'cien' || w === 'ciento') actual += 100
    else if (w !== 'y') actual += 100 * CIENTOS.findIndex(c => w.startsWith(c))
  }
  return total + actual
}

/**
 * Fines written as multiples of the UMA, with spans in `texto`: "multa equivalente a 30, 32 o 35 veces la Unidad de Medida y
 * Actualización" → { veces: [30, 32, 35], inicio, fin }. Also the single amount ("multa de 60 veces", "sanción de ciento
 * ochenta veces"), ranges ("multa por el equivalente de 1 a 10 veces", "multa de cuarenta a sesenta veces") and, after a
 * fine in the same sentence, a second tier ("… y de sesenta a ochenta veces la Unidad …"), and the Ley de Cultura Cívica's
 * "multa equivalente de 11 a 40 Unidades de Medida". Numbers may be digits or words.
 * Not fines: arrest ("arresto de 20 a 36 horas"), insurance coverage, damage thresholds, the UMA's definition.
 */
export function multas(texto: string): { veces: number[]; inicio: number; fin: number }[] {
  const out: { veces: number[]; inicio: number; fin: number }[] = []
  for (const m of texto.matchAll(MULTA)) {
    if (m.groups!.y && !(out.length && !/[.;]/.test(texto.slice(out.at(-1)!.fin, m.index)))) continue
    const veces = m.groups!.n.split(SEPARADOR).map(valor)
    out.push({ veces, inicio: m.index, fin: m.index + m[0].length })
  }
  return out
}
