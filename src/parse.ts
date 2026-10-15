export type Ley = 'LISR' | 'LIVA' | 'LIEPS' | 'CFF' | 'LIF' | 'RLISR' | 'RLIVA' | 'RLIEPS' | 'RCFF' | 'RMF'
export type Ref = { ley: Ley; id: string }
export type Articulo = Ref & { orden: number; ubicacion: string[]; texto: string; reformas: string[]; actualizaciones: string[]; titulo?: string }
export type Criterio = { id: string | null; materia: Ley; tema: string; texto: string; citas: Ref[] }

const BIBLIO = 'https://www.diputados.gob.mx/LeyesBiblio'
const RMF = 'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf'
const ANEXOS_RMF = `${RMF}/anexos`

/**
 * Every document in the index. Laws and regulations come from the Cámara de Diputados (texto vigente); the
 * Resolución Miscelánea Fiscal is SAT's compiled 2026 edition, whose numbered rules stand in for articles.
 */
export const LEYES: Record<Ley, { titulo: string; nombre: string; tipo: 'ley' | 'reglamento' | 'reglas'; pdf: string; reglamenta?: Ley }> = {
  LISR: { titulo: 'LEY DEL IMPUESTO SOBRE LA RENTA', nombre: 'Ley del Impuesto sobre la Renta', tipo: 'ley', pdf: `${BIBLIO}/pdf/LISR.pdf` },
  LIVA: { titulo: 'LEY DEL IMPUESTO AL VALOR AGREGADO', nombre: 'Ley del Impuesto al Valor Agregado', tipo: 'ley', pdf: `${BIBLIO}/pdf/LIVA.pdf` },
  LIEPS: {
    titulo: 'LEY DEL IMPUESTO ESPECIAL SOBRE PRODUCCIÓN Y SERVICIOS',
    nombre: 'Ley del Impuesto Especial sobre Producción y Servicios',
    tipo: 'ley',
    pdf: `${BIBLIO}/pdf/LIEPS.pdf`,
  },
  CFF: { titulo: 'CÓDIGO FISCAL DE LA FEDERACIÓN', nombre: 'Código Fiscal de la Federación', tipo: 'ley', pdf: `${BIBLIO}/pdf/CFF.pdf` },
  LIF: {
    titulo: 'LEY DE INGRESOS DE LA FEDERACIÓN PARA EL EJERCICIO FISCAL DE 2026',
    nombre: 'Ley de Ingresos de la Federación para 2026',
    tipo: 'ley',
    pdf: `${BIBLIO}/pdf/LIF_2026.pdf`,
  },
  RLISR: {
    titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO SOBRE LA RENTA',
    nombre: 'Reglamento de la Ley del Impuesto sobre la Renta',
    tipo: 'reglamento',
    pdf: `${BIBLIO}/regley/Reg_LISR_060516.pdf`,
    reglamenta: 'LISR',
  },
  RLIVA: {
    titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO AL VALOR AGREGADO',
    nombre: 'Reglamento de la Ley del Impuesto al Valor Agregado',
    tipo: 'reglamento',
    pdf: `${BIBLIO}/regley/Reg_LIVA_250914.pdf`,
    reglamenta: 'LIVA',
  },
  RLIEPS: {
    titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO ESPECIAL SOBRE PRODUCCIÓN Y SERVICIOS',
    nombre: 'Reglamento de la Ley del Impuesto Especial sobre Producción y Servicios',
    tipo: 'reglamento',
    pdf: `${BIBLIO}/regley/Reg_LIEPS.pdf`,
    reglamenta: 'LIEPS',
  },
  RCFF: {
    titulo: 'REGLAMENTO DEL CÓDIGO FISCAL DE LA FEDERACIÓN',
    nombre: 'Reglamento del Código Fiscal de la Federación',
    tipo: 'reglamento',
    pdf: `${BIBLIO}/regley/Reg_CFF.pdf`,
    reglamenta: 'CFF',
  },
  RMF: {
    titulo: 'RESOLUCIÓN MISCELÁNEA FISCAL PARA 2026',
    nombre: 'Resolución Miscelánea Fiscal para 2026',
    tipo: 'reglas',
    pdf: `${RMF}/compiladas/Compilado_Primera_Modificacion_a_la-Resolucion_Miscelanea_Fiscal_para_2026.pdf`,
  },
}

const reglamentoDe = (ley: Ley | null) => (Object.keys(LEYES) as Ley[]).find(l => LEYES[l].reglamenta === ley) ?? null

/** Anexo 7: criterios normativos (how SAT reads the law). Anexo 3: criterios no vinculativos (practices SAT calls improper). */
export const ANEXOS = { 7: `${ANEXOS_RMF}/Anexo_7_RMF2026-09012026.pdf`, 3: `${ANEXOS_RMF}/Anexo_3_RMF2026-09012026.pdf` } as const

const WORDS = 'Bis|Ter|Quáter|Quinquies|Sexies|BIS|TER|QUÁTER|QUINQUIES|SEXIES'
const SUF = String.raw`(?:\.?-[A-Z](?![a-záéíóú])|[- ](?:${WORDS}))*`
const HEADING = new RegExp(String.raw`^Artículo (\d+)o?(${SUF})\.-?(?:\s+(.*))?$`)
const NUM = new RegExp(String.raw`(\d+)o?(${SUF})`, 'gu')
const LEAD = new RegExp(String.raw`^(?:[\s,.]|(?:así como|al|y|e|o|u|a)(?!\p{L})|\d+o?${SUF})+`, 'u')
const ORD = '(?:primer|segund|tercer|cuart|quint|sext|séptim|octav|noven|décim|undécim|duodécim|últim|penúltim|antepenúltim)[oa]?s?'
const QUAL = new RegExp(
  String.raw`(?<!\p{L})(?:` +
    [
      String.raw`fracci(?:ón|ones)\s+[IVXLC]+(?:\s*(?:,|y|e|a)\s*[IVXLC]+)*`,
      String.raw`(?:sub)?incisos?\s+[a-z0-9]+\)(?:\s*(?:,|y|e)\s*[a-z0-9]+\))*`,
      String.raw`apartados?\s+[A-Z](?!\p{L})(?:\s*(?:,|y)\s*[A-Z](?!\p{L}))*`,
      String.raw`numerales?\s+[\d.]+(?:\s*(?:,|y)\s*[\d.]+)*`,
      String.raw`(?:${ORD}(?:\s*(?:,|y|e)\s*)?)+\s*párrafos?`,
      String.raw`párrafos?(?:\s+${ORD}(?:\s*(?:,|y|e)\s*)?)*`,
    ].join('|') +
    String.raw`)(?!\p{L})`,
  'gu',
)
const LAW =
  /(?<!\p{L})(?:de|del)\s+(?:(?:la|el)\s+)?(?:(esta|este|presente|dich[ao]|citad[ao]|mism[ao]|referid[ao])\s+)?(Ley|Código|RLISR|RLIVA|RLIEPS|RCFF|LISR|LIVA|LIEPS|CFF|LIF|RMF|ordenamiento|Reglamento|Decreto|Resolución|Constitución|Convenio|Tratado|Acuerdo|Norma)(?!\p{L})([^,;:()]{0,60})/u
const STOP = /[;:(]|\.\s+\p{Lu}/u
const NOISE = [
  /^\d+ de \d+$/,
  /^CÁMARA DE DIPUTADOS DEL H\. CONGRESO DE LA UNIÓN$/,
  /^Secretaría (General|de Servicios Parlamentarios)$/,
  /^Última Reforma DOF/,
  /^Nuev[oa] (Ley|Reglamento) DOF/,
]
const REFORMA = /^\p{Lu}[\p{L} ,.]{2,100}?DOF \d{2}-\d{2}-\d{4}/u
const SOLO_FECHAS = /^\d{2}-\d{2}-\d{4}(?:\d{2}-\d{2}-\d{4}|DOF|Actualizad[ao]s?|Compilad[ao]s?|Reformad[ao]s?|Adicionad[ao]s?|Derogad[ao]s?|y|[,.\s])*$/
const FECHA = /(\d{2})-(\d{2})-(\d{4})/g
const MISCELANEA = /miscel[aá]nea|actualizad[ao]s?\b|compilad[ao]s?\b/i
const DIVISION = /^(T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N)\s+\S+/
const MARCA = /^(?:[IVXLC]+\.|[a-z]\)|\d+\.)\s/
const ID_CRITERIO = /\b\d+\/(?:[A-Z]+\/)+[A-Z]+\b/g
const MATERIA: Record<string, Ley> = { 'del CFF': 'CFF', 'de la Ley del ISR': 'LISR', 'de la Ley del IVA': 'LIVA', 'de la Ley del IEPS': 'LIEPS', 'de la LIF': 'LIF' }

const esMayus = (l: string) => l === l.toUpperCase() && /\p{Lu}/u.test(l)

/** Canonical article id: "2o.-A" → "2-A", "18-H BIS" → "18-H-Bis". */
export const normId = (num: string, suf = '') =>
  [num, ...(suf.match(new RegExp(`${WORDS}|[A-Z]`, 'g')) ?? []).map(p => p[0] + p.slice(1).toLowerCase())].join('-')

/** Rejoins the PDF's hard-wrapped lines: a line continues the previous one unless that ended a sentence or it opens a fracción/inciso. */
export function parrafos(lines: string[]) {
  const out: string[] = []
  for (const l of lines) {
    if (out.length && !/[.:;]$/.test(out[out.length - 1]) && !MARCA.test(l)) out[out.length - 1] += ' ' + l
    else out.push(l)
  }
  return out.join('\n')
}

/** Which law a "Ley ..." phrase names, from the words after it. */
function cualLey(r: string): Ley | null {
  if (/^\s*(del )?impuesto sobre la renta|^\s*del isr\b/.test(r)) return 'LISR'
  if (/^\s*(del )?impuesto al valor agregado|^\s*del iva\b/.test(r)) return 'LIVA'
  if (/^\s*(del )?impuesto especial sobre producción y servicios|^\s*del ieps\b/.test(r)) return 'LIEPS'
  if (/^\s*de ingresos de la federación/.test(r)) return 'LIF'
  return null
}

function resolver(det: string | undefined, word: string, rest: string, self: Ley | null, last: Ley | null): Ley | null {
  if (det && /^(esta|este|presente)$/.test(det)) return word === 'Reglamento' && self && LEYES[self].tipo === 'ley' ? reglamentoDe(self) : self
  if (det) return last
  const r = rest.toLowerCase()
  if (word in LEYES) return word as Ley
  const nombrada = /^\s*(?:(?:del?|sobre|para)(?!\p{L})|\p{Lu})/u.test(rest)
  if (word === 'Ley') return cualLey(r) ?? (!nombrada && self ? (LEYES[self].reglamenta ?? null) : null)
  if (word === 'Código') return /^\s*(civil|penal|de comercio|nacional|federal)/.test(r) ? null : 'CFF'
  if (word === 'Reglamento') {
    if (/^\s*de esta ley/.test(r)) return reglamentoDe(self)
    if (/^\s*del (código|cff)/.test(r)) return 'RCFF'
    const de = r.match(/^\s*de la ley(.*)/)
    if (de) return reglamentoDe(cualLey(de[1]))
    return !nombrada && self && LEYES[self].tipo === 'reglamento' ? self : null
  }
  if (word === 'Resolución') return /^\s*miscelánea fiscal/.test(r) ? 'RMF' : null
  return null
}

export type Mencion = Ref & { inicio: number; fin: number }

/**
 * Every article mentioned in a passage, resolved to a document in the index, with its character span.
 * A reference with no law named before the sentence ends counts as `self`; pass null to drop those.
 * Ranges ("artículos 27 a 31") yield only their ends. "regla 2.7.1.21." always means the Miscelánea.
 */
export function menciones(texto: string, self: Ley | null): Mencion[] {
  const t = texto.replace(/\s/g, ' ')
  const out: Mencion[] = []
  for (const m of t.matchAll(/(?<!\p{L})[Rr]eglas?\s+(?=\d+\.\d)/gu)) {
    const base = m.index + m[0].length
    const lista = t.slice(base, base + 200).match(/^(?:\d+(?:\.\d+)+\.?(?:,?\s*(?:y|e|o|así como)?\s*(?=\d+\.\d))?)+/)?.[0] ?? ''
    for (const n of lista.matchAll(/\d+(?:\.\d+)+/g)) out.push({ ley: 'RMF', id: n[0], inicio: base + n.index, fin: base + n.index + n[0].length })
  }
  let last = self
  for (const m of t.matchAll(/(?<!\p{L})[Aa]rt[íi]culos?\s+(?=\d)/gu)) {
    const base = m.index + m[0].length
    const w = t.slice(base, base + 240)
    const stop = w.search(STOP)
    const lm = LAW.exec(w)
    const aqui = lm && (stop < 0 || lm.index < stop)
    const ley = aqui ? resolver(lm[1], lm[2], lm[3], self, last) : self
    if (aqui) last = ley
    if (!ley) continue
    const seg = w.slice(0, aqui ? lm.index : stop < 0 ? w.length : stop).replace(QUAL, s => ' '.repeat(s.length))
    for (const n of (seg.match(LEAD)?.[0] ?? '').matchAll(NUM)) {
      const inicio = base + n.index
      out.push({ ley, id: normId(n[1], n[2]), inicio, fin: inicio + n[0].length })
    }
  }
  return out
}

/** Distinct articles a passage cites. */
export function citas(texto: string, self: Ley | null): Ref[] {
  return [...new Map(menciones(texto, self).map(({ ley, id }) => [`${ley}:${id}`, { ley, id }])).values()]
}

const ALIAS: Record<string, Ley> = {
  ...(Object.fromEntries(Object.keys(LEYES).map(l => [l, l])) as Record<Ley, Ley>),
  ISR: 'LISR',
  IVA: 'LIVA',
  IEPS: 'LIEPS',
}
const CODIGO = `(${Object.keys(ALIAS)
  .sort((a, b) => b.length - a.length)
  .flatMap(c => [c, c.toLowerCase()])
  .join('|')})`
const ART = '(?:[Aa]rt(?:[íi]culo|\\.)?\\s*)'
const CORTA = new RegExp(
  String.raw`(?<![\p{L}\d])(?:${CODIGO}\s*,?\s*${ART}?(\d+)o?(${SUF})(?!\s*%)|${ART}?(\d+)o?(${SUF})\s*(?:de\s+la\s+|del\s+)?${CODIGO})(?![\p{L}\d])`,
  'gu',
)

/** Article references a search query names outright: "artículo 27 de la Ley del ISR", "CFF 29-A", "151 LISR", "RMF 2.7.1.21". */
export function referencias(q: string): Ref[] {
  const out = new Map(citas(q, null).map(r => [`${r.ley}:${r.id}`, r]))
  for (const m of q.matchAll(CORTA)) {
    const ley = ALIAS[(m[1] ?? m[6]).toUpperCase()]
    if (ley === 'RMF') continue
    const id = normId(m[2] ?? m[4], m[3] ?? m[5])
    out.set(`${ley}:${id}`, { ley, id })
  }
  for (const m of q.matchAll(/(?<!\p{L})(?:RMF|rmf|[Rr]egla)\s*(\d+(?:\.\d+)+)/gu)) out.set(`RMF:${m[1]}`, { ley: 'RMF', id: m[1] })
  return [...out.values()]
}

/** Packs paragraphs into chunks of at most `max` characters, splitting overlong paragraphs at sentence ends. */
export function fragmentos(texto: string, max = 1000): string[] {
  const piezas = texto.split('\n').flatMap(p => (p.length > max ? p.split(/(?<=[.;:])\s+/) : [p]))
  const out: string[] = []
  for (const p of piezas) {
    if (out.length && out[out.length - 1].length + p.length + 1 <= max) out[out.length - 1] += '\n' + p
    else out.push(p)
  }
  return out
}

export const derogado = (texto: string) => /^\(?Se deroga\)?\.?$/i.test(texto.replace(/^-\s*/, '').trim())

/** Splits a Cámara de Diputados law PDF's text into articles, stopping at the transitorios. */
export function parseLey(raw: string, ley: Ley): Articulo[] {
  const titulo = LEYES[ley].titulo
  const out: (Articulo & { lineas: string[] })[] = []
  const ruta: Record<string, string> = {}
  let nombrando: string | null = null
  let nombres = 0
  let destino: 'reformas' | 'actualizaciones' = 'reformas'
  for (const l of raw.split('\n').map(s => s.trim())) {
    if (!l || l === titulo || NOISE.some(r => r.test(l))) continue
    if (out.length && ((esMayus(l) && l.includes('TRANSITORI')) || l === 'Transitorios')) break
    const cur = out[out.length - 1]
    if (REFORMA.test(l) || SOLO_FECHAS.test(l)) {
      if (REFORMA.test(l)) destino = MISCELANEA.test(l) ? 'actualizaciones' : 'reformas'
      for (const [, d, mo, y] of l.matchAll(FECHA)) cur?.[destino].push(`${y}-${mo}-${d}`)
      continue
    }
    const div = l.match(DIVISION)
    if (div && esMayus(l)) {
      const nivel = div[1][0]
      ruta[nivel] = l
      if (nivel === 'T') delete ruta.C, delete ruta.S
      if (nivel === 'C') delete ruta.S
      nombrando = nivel
      nombres = 0
      continue
    }
    if (nombrando && (nombres === 0 || esMayus(l)) && !HEADING.test(l)) {
      ruta[nombrando] += ' ' + l
      nombres++
      continue
    }
    nombrando = null
    const h = l.match(HEADING)
    if (h) {
      out.push({
        ley,
        id: normId(h[1], h[2]),
        orden: out.length,
        ubicacion: ['T', 'C', 'S'].map(k => ruta[k]).filter(Boolean),
        texto: '',
        reformas: [],
        actualizaciones: [],
        lineas: h[3] ? [h[3]] : [],
      })
      continue
    }
    cur?.lineas.push(l)
  }
  const unicas = (xs: string[]) => [...new Set(xs)].sort()
  return out.map(({ lineas, ...a }) => ({ ...a, texto: parrafos(lineas), reformas: unicas(a.reformas), actualizaciones: unicas(a.actualizaciones) }))
}

/**
 * SAT criterios (Anexo 7 normativos, Anexo 3 prácticas indebidas) → one entry per criterio in force for CFF, ISR or IVA.
 * Titles are recovered by matching body lines against the index, since the PDF's id column
 * comes out detached from its text.
 */
export function parseCriterios(raw: string): Criterio[] {
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean)
  const origen = (l: string) => l.startsWith('Origen Primer antecedente')
  const primerOrigen = lines.findIndex(origen)
  const inicio = lines.findLastIndex((l, i) => i < primerOrigen && /^I\. Criterios /.test(l))
  const derogados = lines.findIndex((l, i) => i > inicio && /^B\. .*[Dd]erogados/.test(l))
  const fin = derogados < 0 ? lines.length : derogados
  const norm = (s: string) => s.replace(ID_CRITERIO, ' ').replace(/\s+/g, ' ').trim()
  const indice = norm(lines.slice(0, inicio).join(' '))
  const out: Criterio[] = []
  let materia: Ley | null = null
  let seg: { l: string; materia: Ley | null }[] = []
  const cerrar = () => {
    const ls = seg.map(s => s.l)
    const i = ls.findIndex(l => norm(l).length >= 20 && indice.includes(norm(l)))
    if (i < 0 || !seg[i].materia) return
    let j = i
    while (j + 1 < ls.length && indice.includes(norm(ls.slice(i, j + 2).join(' ')))) j++
    const texto = parrafos(ls.slice(j + 1))
    out.push({
      id: ls[i].match(ID_CRITERIO)?.[0] ?? null,
      materia: seg[i].materia!,
      tema: norm(ls.slice(i, j + 1).join(' ')),
      texto,
      citas: citas(texto, null),
    })
  }
  for (const l of lines.slice(inicio, fin)) {
    const sec = l.match(/^[IVX]+\. Criterios (.+)$/)
    if (sec) materia = MATERIA[sec[1]] ?? null
    else if (/DIARIO OFICIAL|^\(.*Sección\)$/.test(l)) continue
    else if (origen(l)) cerrar(), (seg = [])
    else seg.push({ l, materia })
  }
  cerrar()
  return out
}
