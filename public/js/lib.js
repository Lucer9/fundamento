export const EN_USO = 'vector gemma'

export const TIPO_CRITERIO = { NORMATIVE: 'Criterio normativo', IMPROPER_PRACTICE: 'Práctica indebida' }

export const FAMILIAS = [
  { id: 'ley', nombre: 'Leyes', uno: 'ley', kind: 'LAW' },
  { id: 'reglamento', nombre: 'Reglamentos', uno: 'reglamento', kind: 'REGULATION' },
  { id: 'miscelanea', nombre: 'Miscelánea', uno: 'miscelánea', kind: 'RULES' },
]

/** Every document the API indexes, in reading order, with the short label used on chips and badges. */
export const DOCS = {
  LISR: { corto: 'Ley del ISR', nombre: 'Ley del Impuesto sobre la Renta', familia: 'ley' },
  LIVA: { corto: 'Ley del IVA', nombre: 'Ley del Impuesto al Valor Agregado', familia: 'ley' },
  LIEPS: { corto: 'Ley del IEPS', nombre: 'Ley del Impuesto Especial sobre Producción y Servicios', familia: 'ley' },
  CFF: { corto: 'Código Fiscal', nombre: 'Código Fiscal de la Federación', familia: 'ley' },
  LIF: { corto: 'Ley de Ingresos 2026', nombre: 'Ley de Ingresos de la Federación para 2026', familia: 'ley' },
  RLISR: { corto: 'Reglamento LISR', nombre: 'Reglamento de la Ley del Impuesto sobre la Renta', familia: 'reglamento', de: 'LISR' },
  RLIVA: { corto: 'Reglamento LIVA', nombre: 'Reglamento de la Ley del Impuesto al Valor Agregado', familia: 'reglamento', de: 'LIVA' },
  RLIEPS: { corto: 'Reglamento LIEPS', nombre: 'Reglamento de la Ley del Impuesto Especial sobre Producción y Servicios', familia: 'reglamento', de: 'LIEPS' },
  RCFF: { corto: 'Reglamento CFF', nombre: 'Reglamento del Código Fiscal de la Federación', familia: 'reglamento', de: 'CFF' },
  RMF: { corto: 'Miscelánea 2026', nombre: 'Resolución Miscelánea Fiscal para 2026', familia: 'miscelanea' },
}

export const esDoc = c => Object.hasOwn(DOCS, c)
export const elLa = nombre => (/^C[oó]digo/.test(nombre) ? 'el' : 'la')
export const deLa = nombre => (/^C[oó]digo/.test(nombre) ? 'del' : 'de la')
export const corto = c => DOCS[c]?.corto ?? c
export const familia = c => DOCS[c]?.familia ?? 'ley'
export const unidad = c => (familia(c) === 'miscelanea' ? 'Regla' : 'Artículo')

/** `<optgroup>`s of every document grouped by family, for native selects. */
export const opcionesDocs = (actual = '') =>
  FAMILIAS.map(
    f => html`<optgroup label="${f.nombre}">${Object.entries(DOCS)
      .filter(([, d]) => d.familia === f.id)
      .map(([c, d]) => html`<option value="${c}" ${c === actual ? 'selected' : ''}>${d.corto}</option>`)}</optgroup>`,
  )

export const badge = c => html`<abbr class="badge" data-fam="${familia(c)}" title="${DOCS[c]?.nombre ?? c}">${corto(c)}</abbr>`

/**
 * POST a GraphQL operation. Resolves to the full response body; GraphQL errors and network
 * failures reject with an Error whose message can be shown to the user as-is.
 */
export async function request(query, variables = {}, signal) {
  let res
  try {
    res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.')
  }
  let body
  try {
    body = await res.json()
  } catch {
    throw new Error(`El servidor respondió con un error (${res.status}).`)
  }
  if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join(' '))
  return body
}

export const gql = (query, variables, signal) => request(query, variables, signal).then(b => b.data)

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c])

class Raw {
  constructor(s) {
    this.s = s
  }
  toString() {
    return this.s
  }
}
export const raw = s => new Raw(s)
const show = v => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(show).join('') : esc(v))

/** Tagged template that escapes every interpolation unless it is `raw()`, nested `html`, or an array of those. */
export const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? show(vals[i]) : ''), ''))

export const nf = new Intl.NumberFormat('es-MX')
export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`

const fechaCorta = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fechaLarga = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const aFecha = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
export const fecha = iso => fechaCorta.format(aFecha(iso)).replace('.', '')
export const fechaLargaDe = iso => fechaLarga.format(aFecha(iso))

/** "18-H-Bis" → "18-H Bis", the way the law prints it. */
export const numero = n => String(n).replace(/-(Bis|Ter|Qu[aá]ter|Quinquies|Sexies|Septies|Octies|Nonies)\b/gi, (_, s) => ` ${s[0].toUpperCase()}${s.slice(1).toLowerCase()}`)

export const ruta = (ley, n) => `/${ley}/${encodeURIComponent(n)}`
export const rutaClave = key => {
  const [ley, n] = key.split(':')
  return ruta(ley, n)
}
export const etiqueta = key => {
  const i = key.indexOf(':')
  const ley = key.slice(0, i)
  const n = key.slice(i + 1)
  return familia(ley) === 'miscelanea' ? `Regla ${n}` : `${ley} ${numero(n)}`
}

export const titulo = (ley, n) => `${unidad(ley)} ${numero(n)}`

const NIVEL = /^(T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N)\s+(\d+(?:\.\d+)*\.?|[IVXL]+(?:\s+(?:BIS|TER|QU[AÁ]TER))?|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO|NOVENO|D[EÉ]CIMO|[UÚ]NICO)(?=\s|$)\s*(.*)$/i
const ACENTOS = { titulo: 'Título', capitulo: 'Capítulo', seccion: 'Sección', unico: 'Único', septimo: 'Séptimo', decimo: 'Décimo' }
const plano = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const palabra = w => ACENTOS[plano(w)] ?? w[0].toUpperCase() + w.slice(1).toLowerCase()
const oracion = s => (!s ? '' : s === s.toUpperCase() ? s[0] + s.slice(1).toLowerCase() : s[0].toUpperCase() + s.slice(1))

/**
 * One heading from `Article.location` ("TÍTULO IV DE LAS PERSONAS FÍSICAS", "CAPITULO UNICO")
 * → `{ label: 'Título IV', name: 'De las personas físicas' }`, sentence-cased whatever the source casing.
 */
export function nivel(s) {
  const m = s.trim().match(NIVEL)
  if (!m) return { label: '', name: oracion(s.trim()) }
  const ord = m[2]
    .replace(/\.$/, '')
    .split(/\s+/)
    .map(w => (/^[IVXL]+$/i.test(w) ? w.toUpperCase() : palabra(w)))
    .join(' ')
  return { label: `${palabra(m[1])} ${ord}`, name: oracion(m[3]) }
}

/** Every level of a location, splitting the "Disposiciones generales" heading the PDFs glue onto títulos. */
export function niveles(location) {
  const out = []
  location.forEach((s, i) => {
    const n = nivel(s)
    const g = n.name.match(/^(.+?)\s+disposiciones generales$/i)
    if (g && /^T[ií]tulo/.test(n.label)) {
      out.push({ ...n, name: g[1] })
      if (i === location.length - 1) out.push({ label: '', name: 'Disposiciones generales' })
    } else out.push(n)
  })
  return out
}

export const ubicacionHtml = location =>
  niveles(location).map(n => html`<li><span class="lvl">${n.label}</span> <span class="lvl-name">${n.name}</span></li>`)

export const ubicacionCorta = location => {
  const ns = niveles(location).filter(n => n.name)
  return ns.length ? ns[ns.length - 1].name : ''
}

const VACIAS = new Set(
  'a al ante bajo con contra de del desde durante el en entre es esta este hacia hasta la las le les lo los mas me mi mis muy no o para pero por que se si sin sobre su sus te tu un una uno unos unas y ya cual cuales cuando cuanto como donde quien debo puedo puede pueden tengo hay ser son esta estan aplica'.split(' '),
)

/** Accent- and case-insensitive word stems from a query, for highlighting. */
export function terminos(q) {
  const out = new Set()
  for (const w of plano(q).split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || VACIAS.has(w)) continue
    out.add(w.length > 4 ? w.replace(/(es|s)$/, '') : w)
  }
  return [...out]
}

const plegar = s => [...s].map(c => plano(c)[0] ?? c).join('')

/** `[start, end]` spans in `text` where a word starts with one of the stems. */
export function coincidencias(text, stems) {
  if (!stems.length) return []
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`, 'gu')
  const out = []
  for (const m of plegar(text).matchAll(re)) out.push([m.index, m.index + m[0].length])
  return out
}

/** `text` as escaped HTML with `<mark>` around the given spans. */
export function marcar(text, spans) {
  let out = ''
  let i = 0
  for (const [s, e] of spans) {
    out += esc(text.slice(i, s)) + '<mark>' + esc(text.slice(s, e)) + '</mark>'
    i = e
  }
  return raw(out + esc(text.slice(i)))
}

/** The window of `text` (about `len` chars, cut at spaces) holding the most matches, with ellipses where trimmed. */
export function extracto(text, stems, len = 300) {
  const t = text.replace(/\s*\n\s*/g, ' ').trim()
  const spans = coincidencias(t, stems)
  let start = 0
  let best = -1
  for (const [s] of spans) {
    const from = Math.max(0, s - 60)
    const n = spans.filter(([a, b]) => a >= from && b <= from + len).length
    if (n > best) {
      best = n
      start = from
    }
  }
  if (start > 0) start = t.indexOf(' ', start) + 1 || start
  let end = Math.min(t.length, start + len)
  if (end < t.length) end = t.lastIndexOf(' ', end) > start ? t.lastIndexOf(' ', end) : end
  const pedazo = t.slice(start, end)
  const local = spans.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start, b - start])
  return html`${start > 0 ? '…' : ''}${marcar(pedazo, local)}${end < t.length ? '…' : ''}`
}

export const anunciar = msg => {
  const el = document.getElementById('anuncio')
  el.textContent = ''
  requestAnimationFrame(() => (el.textContent = msg))
}

export const errorHtml = (e, titulo = 'Algo salió mal') => html`<div class="error" role="alert"><p class="error-title">${titulo}</p><p>${e.message}</p></div>`

export const esAborto = e => e?.name === 'AbortError'

/** Plural helper: `cuenta(3, 'artículo')` → "3 artículos". */
export const cuenta = (n, uno, varios = `${uno}s`) => `${nf.format(n)} ${n === 1 ? uno : varios}`
