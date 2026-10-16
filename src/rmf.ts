import { LEYES, normId, type Articulo, type Ley, type Mencion } from './parse.ts'

const REGLA = /^(\d+(?:\.\d+)+)\.\s+(.*)$/
const DIVISION = /^(Título|Capítulo|Sección)\s+\d+(?:\.\d+)*\.\s/
const RUIDO = [/^NOTA: Este documento constituye/, /^de dar a conocer el texto actualizado/, /^del Contribuyente\. Para sustentar/, /^Página \d+ de \d+$/]
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** The paragraph that closes most rules, listing what it rests on: "CFF 4o., 17-D, LISR 27, RMF 2.1.39., 2.9.3." */
export const FUNDAMENTO = /^[A-Z]{2,}[A-Za-z]*\s+(?:\d|[A-ZÁÉÍÓÚ][a-záéíóú]+\s+[Tt]ransitorio)/

type Linea = { p: number; x: number; y: number; t: string; abre: boolean }

/**
 * Splits the compiled Resolución Miscelánea Fiscal into rules. Input is scripts/pdf-lineas.js output
 * ("page\tx\ty\ttext"): the PDF prints rule numbers in a margin column that plain extraction moves away from their
 * text, and line spacing is the only paragraph signal (≤14 pt inside a paragraph, ≥16 pt between paragraphs; across a
 * page break, a lowercase line after one without closing punctuation continues the paragraph).
 * A rule is its title (the paragraph right above the number), the numbered text, and usually a closing fundamento
 * paragraph. Compilation notes in the far margin ("Regla 2.12.4. - Reformada en la Primera RMRMF ... DOF el 09 de
 * julio de 2026") become the rule's amendment dates. Stops at the transitorios.
 */
export function parseRmf(raw: string): (Articulo & { titulo: string })[] {
  const todas = raw
    .split('\n')
    .map(l => {
      const [p, x, y, ...t] = l.split('\t')
      return { p: Number(p), x: Number(x), y: Number(y), t: t.join(' ').trim(), abre: true }
    })
    .filter(l => l.t && !RUIDO.some(r => r.test(l.t)))
  const inicio = todas.findIndex(l => l.p > 7 && l.x > 150 && /^Título \d+\. /.test(l.t))
  const fin = todas.findIndex((l, i) => i > inicio && l.x > 150 && l.t === 'Transitorios')

  const reformas = new Map<string, string[]>()
  let anotada: string | null = null
  const ls: Linea[] = []
  for (const l of todas.slice(inicio, fin)) {
    if (l.x >= 62) {
      const prev = ls[ls.length - 1]
      const sigue = prev && prev.p !== l.p && !/[.:;]$/.test(prev.t) && /^\p{Ll}/u.test(l.t)
      ls.push({ ...l, abre: !prev || (prev.p !== l.p && !sigue) || (prev.p === l.p && prev.y - l.y > 15) })
      continue
    }
    const r = l.t.match(/^Regla (\d+(?:\.\d+)+)\.?$/)
    if (r) anotada = r[1]
    const f = l.t.match(/DOF el (\d{1,2}) de (\p{L}+) de (\d{4})/u)
    const mes = MESES.indexOf(f?.[2].toLowerCase() ?? '')
    if (anotada && f && mes >= 0) reformas.set(anotada, [...(reformas.get(anotada) ?? []), `${f[3]}-${String(mes + 1).padStart(2, '0')}-${f[1].padStart(2, '0')}`])
  }

  const esRegla = (l: Linea) => l.x < 100 && REGLA.test(l.t)
  const titulos = new Map<number, number>()
  ls.forEach((l, s) => {
    if (!esRegla(l)) return
    let k = s - 1
    while (k > 0 && !ls[k].abre) k--
    const par = ls.slice(k, s)
    const titulo =
      par.length > 0 &&
      par.length <= 4 &&
      par.every(t => t.x >= 110 && t.x <= 150 && !esRegla(t) && !DIVISION.test(t.t)) &&
      /^\p{Lu}/u.test(par[0].t) &&
      !FUNDAMENTO.test(par[0].t) &&
      !/[.;:]$/.test(par[par.length - 1].t)
    if (titulo) titulos.set(k, s)
  })

  const out: (Articulo & { titulo: string })[] = []
  const ubicacion: string[] = []
  let cur: { id: string; titulo: string; lineas: Linea[]; ubicacion: string[] } | null = null
  let titulo = ''
  let division = -1
  const cerrar = () => {
    if (!cur) return
    const pars: string[] = []
    cur.lineas.forEach((l, i) => (i && !l.abre ? (pars[pars.length - 1] += ' ' + l.t) : pars.push(l.t)))
    out.push({
      ley: 'RMF',
      id: cur.id,
      orden: out.length,
      ubicacion: cur.ubicacion,
      titulo: cur.titulo,
      texto: pars.join('\n').replace(/(\p{L})- (\p{Ll})/gu, '$1$2'),
      reformas: reformas.get(cur.id) ?? [],
      actualizaciones: [],
    })
    cur = null
  }
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]
    if (l.x > 100 && l.abre && DIVISION.test(l.t)) {
      cerrar()
      division = ['Título', 'Capítulo', 'Sección'].indexOf(l.t.split(' ')[0])
      ubicacion.splice(division, Infinity, l.t)
      continue
    }
    if (division >= 0 && !l.abre && l.x > 150) {
      ubicacion[division] += ' ' + l.t
      continue
    }
    division = -1
    if (titulos.has(i)) {
      cerrar()
      titulo = ls.slice(i, titulos.get(i)).map(t => t.t).join(' ')
      i = titulos.get(i)! - 1
      continue
    }
    const r = esRegla(l) ? l.t.match(REGLA) : null
    if (r) {
      cerrar()
      cur = { id: r[1], titulo, lineas: [{ ...l, t: r[2], abre: true }], ubicacion: [...ubicacion] }
      titulo = ''
    } else cur?.lineas.push(l)
  }
  cerrar()
  return out
}

/**
 * Citations in a rule's closing fundamento paragraph, with spans: "CFF 4o., 17-D, LCF 13, RMF 2.1.39." → CFF:4,
 * CFF:17-D, RMF:2.1.39. A code outside the index (LCF, Decreto DOF ...) and a code pinned to an old year
 * ("LISR 2021 112", text that has since changed) mute the numbers after it until the next code.
 */
export function fundamentos(texto: string): Mencion[] {
  const out: Mencion[] = []
  let pos = 0
  for (const par of texto.split('\n')) {
    if (FUNDAMENTO.test(par)) {
      let ley: Ley | null = null
      for (const m of par.matchAll(/(?<![\p{L}\d.\/-])(?:([A-Z][A-Za-z]{1,9})(\s+(?:19|20)\d\d(?!\d))?|(\d+(?:\.\d+)*)o?((?:-[A-Z])*(?:[- ](?:Bis|Ter|Quáter|Quinquies|Sexies))?))(?![\p{L}\d\/])/gu)) {
        if (m[1]) ley = !m[2] && m[1] in LEYES ? (m[1] as Ley) : null
        else if (ley && (ley === 'RMF') === m[3].includes('.'))
          out.push({ ley, id: ley === 'RMF' ? m[3] : normId(m[3], m[4]), inicio: pos + m.index, fin: pos + m.index + m[0].length })
      }
    }
    pos += par.length + 1
  }
  return out
}
