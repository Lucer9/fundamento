export type Ley = 'LISR' | 'LIVA' | 'CFF'
export type Ref = { ley: Ley; id: string }
export type Articulo = Ref & { orden: number; ubicacion: string[]; texto: string; reformas: string[] }
export type Criterio = { id: string | null; materia: Ley; tema: string; texto: string; citas: Ref[] }

const BIBLIO = 'https://www.diputados.gob.mx/LeyesBiblio/pdf'

export const LEYES: Record<Ley, { titulo: string; pdf: string }> = {
  LISR: { titulo: 'LEY DEL IMPUESTO SOBRE LA RENTA', pdf: `${BIBLIO}/LISR.pdf` },
  LIVA: { titulo: 'LEY DEL IMPUESTO AL VALOR AGREGADO', pdf: `${BIBLIO}/LIVA.pdf` },
  CFF: { titulo: 'CÓDIGO FISCAL DE LA FEDERACIÓN', pdf: `${BIBLIO}/CFF.pdf` },
}

export const ANEXO_7 =
  'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_7_RMF2026-09012026.pdf'

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
  /(?<!\p{L})(?:de|del)\s+(?:(?:la|el)\s+)?(?:(esta|este|presente|dich[ao]|citad[ao]|mism[ao]|referid[ao])\s+)?(Ley|Código|CFF|ordenamiento|Reglamento|Decreto|Resolución|Constitución|Convenio|Tratado|Acuerdo|Norma)(?!\p{L})([^,;:()]{0,60})/u
const STOP = /[;:(]|\.\s+\p{Lu}/u
const NOISE = [
  /^\d+ de \d+$/,
  /^CÁMARA DE DIPUTADOS DEL H\. CONGRESO DE LA UNIÓN$/,
  /^Secretaría (General|de Servicios Parlamentarios)$/,
  /^Última Reforma DOF/,
]
const REFORMA = /^\p{Lu}[\p{L} ,.]{2,100}?DOF \d{2}-\d{2}-\d{4}/u
const SOLO_FECHAS = /^(?:\d{2}-\d{2}-\d{4}[,. ]*)+$/
const FECHA = /(\d{2})-(\d{2})-(\d{4})/g
const DIVISION = /^(T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N)\s+\S+/
const MARCA = /^(?:[IVXLC]+\.|[a-z]\)|\d+\.)\s/
const ID_CRITERIO = /\b\d+\/[A-Z]+(?:\/[A-Z]+)*\/N\b/g
const MATERIA: Record<string, Ley> = { 'del CFF': 'CFF', 'de la Ley del ISR': 'LISR', 'de la Ley del IVA': 'LIVA' }

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

function resolver(det: string | undefined, word: string, rest: string, self: Ley | null, last: Ley | null): Ley | null {
  if (det && /^(esta|este|presente)$/.test(det)) return self
  if (det) return last
  const r = rest.toLowerCase()
  if (word === 'CFF') return 'CFF'
  if (word === 'Ley') return /impuesto sobre la renta|^\s*del isr\b/.test(r) ? 'LISR' : /valor agregado|^\s*del iva\b/.test(r) ? 'LIVA' : null
  if (word === 'Código') return /^\s*(civil|penal|de comercio|nacional|federal)/.test(r) ? null : 'CFF'
  return null
}

/**
 * Article references in a passage, resolved to one of the three laws.
 * A reference with no law named before the sentence ends counts as `self`; pass null to drop those.
 * Ranges ("artículos 27 a 31") yield only their ends.
 */
export function citas(texto: string, self: Ley | null): Ref[] {
  const t = texto.replace(/\s+/g, ' ')
  const out = new Map<string, Ref>()
  let last = self
  for (const m of t.matchAll(/(?<!\p{L})[Aa]rt[íi]culos?\s+(?=\d)/gu)) {
    const w = t.slice(m.index + m[0].length, m.index + m[0].length + 240)
    const stop = w.search(STOP)
    const lm = LAW.exec(w)
    const aqui = lm && (stop < 0 || lm.index < stop)
    const ley = aqui ? resolver(lm[1], lm[2], lm[3], self, last) : self
    if (aqui) last = ley
    if (!ley) continue
    const seg = w.slice(0, aqui ? lm.index : stop < 0 ? w.length : stop).replace(QUAL, ' ')
    for (const n of (seg.match(LEAD)?.[0] ?? '').matchAll(NUM)) {
      const id = normId(n[1], n[2])
      out.set(`${ley}:${id}`, { ley, id })
    }
  }
  return [...out.values()]
}

/** Splits a Cámara de Diputados law PDF's text into articles, stopping at the transitorios. */
export function parseLey(raw: string, ley: Ley): Articulo[] {
  const titulo = LEYES[ley].titulo
  const out: (Articulo & { lineas: string[] })[] = []
  const ruta: Record<string, string> = {}
  let nombrando: string | null = null
  let nombres = 0
  for (const l of raw.split('\n').map(s => s.trim())) {
    if (!l || l === titulo || NOISE.some(r => r.test(l))) continue
    if (out.length && esMayus(l) && l.includes('TRANSITORI')) break
    const cur = out[out.length - 1]
    if (REFORMA.test(l) || SOLO_FECHAS.test(l)) {
      for (const [, d, mo, y] of l.matchAll(FECHA)) cur?.reformas.push(`${y}-${mo}-${d}`)
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
        lineas: h[3] ? [h[3]] : [],
      })
      continue
    }
    cur?.lineas.push(l)
  }
  return out.map(({ lineas, ...a }) => ({ ...a, texto: parrafos(lineas), reformas: [...new Set(a.reformas)].sort() }))
}

/**
 * Anexo 7 (criterios normativos) → one entry per criterio in force for CFF, ISR or IVA.
 * Titles are recovered by matching body lines against the index, since the PDF's id column
 * comes out detached from its text.
 */
export function parseCriterios(raw: string): Criterio[] {
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean)
  const origen = (l: string) => l.startsWith('Origen Primer antecedente')
  const primerOrigen = lines.findIndex(origen)
  const inicio = lines.findLastIndex((l, i) => i < primerOrigen && l === 'I. Criterios del CFF')
  const fin = lines.indexOf('B. Criterios normativos derogados.')
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
