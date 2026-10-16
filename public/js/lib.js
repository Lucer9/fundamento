export const TIPO_CRITERIO = { NORMATIVE: 'Criterio normativo', IMPROPER_PRACTICE: 'Práctica indebida' }

/** Document families, keyed by `Law.kind`; display names fill in once the site's documents load. */
export const FAMILIAS = [
  { id: 'ley', kind: 'LAW', nombre: 'Leyes', uno: 'ley' },
  { id: 'reglamento', kind: 'REGULATION', nombre: 'Reglamentos', uno: 'reglamento' },
  { id: 'reglas', kind: 'RULES', nombre: 'Reglas', uno: 'conjunto de reglas' },
]

/** This site's documents in display order (`{ corto, nombre, familia, de, source, articleCount }`), from `laws`. */
export const DOCS = {}

/** `{ site, stats, laws, slug }` for the site this API serves; set by `cargarSitio()` before the first render. */
export const SITIO = {}

const SITIO_QUERY = `{
  site { name title tagline description disclaimer defaultMode examples lists { title note laws } uma { value since source } evalPath answersEvalPath guide { scope knowTheRules tips { slug title text cites source { name url } } } }
  stats { articles citations chunks criteria }
  laws { code name shortName kind regulates { code name } source articleCount }
}`

/**
 * Loads what the site is (name, search lists, UMA, disclaimer) and its documents, and fills `SITIO` and `DOCS`.
 * The site's slug is the `data-site` the Worker already wrote on `<html>`, or one made from its name.
 */
export async function cargarSitio() {
  const { site, stats, laws } = await gql(SITIO_QUERY)
  for (const l of laws) {
    const fam = FAMILIAS.find(f => f.kind === l.kind) ?? FAMILIAS[0]
    DOCS[l.code] = { corto: l.shortName, nombre: l.name, familia: fam.id, de: l.regulates?.code, source: l.source, articleCount: l.articleCount }
  }
  const reglas = laws.filter(l => l.kind === 'RULES')
  if (reglas.length === 1) FAMILIAS.find(f => f.id === 'reglas').nombre = reglas[0].shortName.replace(/\s+\d{4}$/, '')
  Object.assign(SITIO, { site, stats, laws, slug: document.documentElement.dataset.site || plano(site.name).replace(/[^a-z0-9]+/g, '') })
  return SITIO
}

const ICONO_F =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%238c1d3b'/%3E%3Ctext x='16' y='24' font-family='Georgia,serif' font-size='22' font-style='italic' text-anchor='middle' fill='%23f6f3ec'%3Ef%3C/text%3E%3C/svg%3E"
const ICONO_S =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='8' y='1' width='16' height='30' rx='8' fill='%231d1b17'/%3E%3Ccircle cx='16' cy='8.5' r='4.5' fill='%23d64545'/%3E%3Ccircle cx='16' cy='16' r='4.5' fill='%23e3a33b'/%3E%3Ccircle cx='16' cy='23.5' r='4.5' fill='%2347a86a'/%3E%3C/svg%3E"

/**
 * What only the front end decides per site: the name of its accent colour (for chart captions), the tab icon, and
 * the AI assistant that answers next to the results (its name, its name as set in the logo, and what it is not).
 * Keyed by the site's slug; unknown sites get the neutral defaults.
 */
const TEMAS = {
  fundamento: {
    acento: 'guinda',
    icono: ICONO_F,
    pregunta: '¿Qué quieres saber de tus impuestos?',
    asistente: { nombre: 'SATGPT', html: 'SAT<span class="ia">GPT</span>', aviso: 'No es el SAT ni asesoría fiscal. Lee los artículos antes de decidir.' },
  },
  semaforo: {
    acento: 'verde',
    icono: ICONO_S,
    principal: 'RT',
    pregunta: '¿Qué quieres saber del reglamento?',
    asistente: { nombre: 'Educación vIAl', html: 'Educación v<span class="ia">IA</span>l', aviso: 'No es una autoridad ni asesoría legal. Lee los artículos antes de decidir.' },
  },
}
const NEUTRO = { acento: 'color', icono: ICONO_F, pregunta: '¿Qué quieres saber?', asistente: { nombre: 'el asistente', html: 'Asistente', aviso: 'Puede equivocarse. Lee los artículos.' } }
export const tema = () => TEMAS[SITIO.slug] ?? NEUTRO
export const asistente = () => tema().asistente

/** The site's "if an agent stops you" guide (`site.guide`), or null where the site has none. */
export const consejos = () => SITIO.site?.guide ?? null

/** Whether the visitor wants the AI answer next to the results: on unless they turned it off on this device. */
export const iaActiva = () => {
  try {
    return localStorage.getItem('ia') !== '0'
  } catch {
    return true
  }
}
export const guardarIa = activa => {
  try {
    localStorage.setItem('ia', activa ? '1' : '0')
  } catch {}
}

/** A static JSON file, rejecting when it is missing: the SPA fallback answers unknown paths with index.html and a 200. */
const json = async ruta => {
  const r = await fetch(ruta)
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error(`No se encontró ${ruta}.`)
  return r.json()
}
let evalP = null
let respuestasP = null
/** The site's search eval (`site.evalPath`), cached. */
export const cargarEval = () =>
  (evalP ??= json(SITIO.site.evalPath).catch(e => {
    evalP = null
    throw e
  }))
/** The site's answer eval (`site.answersEvalPath`), cached. */
export const cargarRespuestas = () =>
  (respuestasP ??= json(SITIO.site.answersEvalPath).catch(e => {
    respuestasP = null
    throw e
  }))

export const tieneCriterios = () => (SITIO.stats?.criteria ?? 0) > 0
const tituloPagina = t => (t ? `${t} · ${SITIO.site.name}` : SITIO.site.title)

/** Sets the tab title, except on a first load the Worker already titled because it server-rendered the page. */
export const titular = t => {
  if (!SITIO.conservarTitulo) document.title = tituloPagina(t)
}

const FAQS = `{ faqs { slug question verified sources { key } criteria { number } } }`
let faqsP = null
/** Every published question (slug, question, whether it was checked, what it cites), cached; [] when there are none or the request fails. */
export const cargarFaqs = () =>
  (faqsP ??= gql(FAQS).then(
    d => d.faqs ?? [],
    () => {
      faqsP = null
      return []
    },
  ))

/** The document a published question is filed under: the first article it cites, or none when it only cites SAT criteria. */
export const docDeFaq = f => f.sources[0]?.key.split(':')[0] ?? ''
/** Families that have documents, in the order their first document appears (a site that leads with a reglamento lists reglamentos first). */
export const familiasPresentes = () => {
  const orden = Object.values(DOCS).map(d => d.familia)
  return FAMILIAS.filter(f => orden.includes(f.id)).sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))
}

export const esDoc = c => Object.hasOwn(DOCS, c)
const MASCULINO = /^(C[oó]digo|Reglamento)/
export const elLa = nombre => (MASCULINO.test(nombre) ? 'el' : 'la')
export const deLa = nombre => (MASCULINO.test(nombre) ? 'del' : 'de la')
export const corto = c => DOCS[c]?.corto ?? c
export const familia = c => DOCS[c]?.familia ?? 'ley'
export const unidad = c => (familia(c) === 'reglas' ? 'Regla' : 'Artículo')

const EDITORES = [
  [/diputados\.gob\.mx/, 'la Cámara de Diputados', 'Cámara de Diputados'],
  [/sat\.gob\.mx/, 'el SAT', 'SAT'],
  [/cdmx\.gob\.mx/, 'la Consejería Jurídica de la Ciudad de México', 'Consejería Jurídica CDMX'],
  [/dof\.gob\.mx/, 'el Diario Oficial', 'Diario Oficial'],
  [/inegi\.org\.mx/, 'el INEGI', 'INEGI'],
]
/** Who publishes a source PDF, from its host: `{ largo: 'la Cámara de Diputados', corto: 'Cámara de Diputados' }`. */
export const editor = url => {
  const e = EDITORES.find(([re]) => re.test(url ?? ''))
  return e ? { largo: e[1], corto: e[2] } : { largo: 'la fuente oficial', corto: 'fuente oficial' }
}
/** The gazette that records a document's amendments: Mexico City's Gaceta Oficial for CDMX texts, else the Diario Oficial. */
export const gaceta = c => (/cdmx/.test(DOCS[c]?.source ?? '') ? 'Gaceta Oficial' : 'Diario Oficial')

/** "claude-opus-5-5" → "Claude Opus", "@cf/meta/llama-3.3-70b-instruct-fp8-fast" → "Llama 3.3 70B". */
export const modeloBonito = id => {
  const s = String(id ?? '')
  const claude = s.match(/claude-(opus|sonnet|haiku)/i)
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)}`
  if (/llama-3\.3-70b/i.test(s)) return 'Llama 3.3 70B'
  return s.split('/').pop()
}

const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
export const pesos = x => moneda.format(x)

/** `<optgroup>`s of every document grouped by family, for native selects. */
export const opcionesDocs = (actual = '') =>
  familiasPresentes().map(
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
/** "LISR:27" → "LISR 27", compact for charts and graphs; rules read "Regla 2.7.1.21". */
export const etiquetaCorta = key => {
  const i = key.indexOf(':')
  const ley = key.slice(0, i)
  const n = key.slice(i + 1)
  return familia(ley) === 'reglas' ? `Regla ${n}` : `${ley} ${numero(n)}`
}

/** "LISR:27" → "Art. 27 LISR", the way Mexican texts cite; the site's main document drops its code ("RT:67" → "Art. 67"). */
export const etiqueta = key => {
  const i = key.indexOf(':')
  const ley = key.slice(0, i)
  const n = key.slice(i + 1)
  if (familia(ley) === 'reglas') return `Regla ${n}`
  return ley === tema().principal ? `Art. ${numero(n)}` : `Art. ${numero(n)} ${ley}`
}

export const titulo = (ley, n) => `${unidad(ley)} ${numero(n)}`

const ORDINAL = String.raw`(?:PRIMER[OA]?|SEGUND[OA]|TERCER[OA]?|CUART[OA]|QUINT[OA]|SEXT[OA]|S[EÉ]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[EÉ]CIM[OA]|UND[EÉ]CIM[OA]|DUOD[EÉ]CIM[OA]|VIG[EÉ]SIM[OA]|[UÚ]NIC[OA])`
const NIVEL = new RegExp(
  String.raw`^(LIBRO|T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N)\s+(\d+(?:\.\d+)*\.?|[IVXLC]+(?:\s+(?:BIS|TER|QU[AÁ]TER))?|${ORDINAL}(?:\s+${ORDINAL})*)(?=[\s.]|$)\.?\s*(.*)$`,
  'i',
)
const ACENTOS = {
  titulo: 'Título',
  capitulo: 'Capítulo',
  seccion: 'Sección',
  unico: 'Único',
  unica: 'Única',
  septimo: 'Séptimo',
  septima: 'Séptima',
  decimo: 'Décimo',
  decima: 'Décima',
  undecimo: 'Undécimo',
  duodecimo: 'Duodécimo',
  vigesimo: 'Vigésimo',
  vigesima: 'Vigésima',
}
const plano = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const palabra = w => ACENTOS[plano(w)] ?? w[0].toUpperCase() + w.slice(1).toLowerCase()
const SIGLAS = /^\(?(CDMX|ISR|IVA|IEPS|RFC|SAT|UMA|CFDI|DOF|IMSS|INFONAVIT|INEGI|SITIS|VEMEPE)\)?[.,;:]?$/i
/** Share of letters that are capitals: headings set in capitals but with a stray "o" or an acronym like "SiTIS" still count. */
const mayusculas = s => {
  const letras = s.match(/\p{L}/gu) ?? []
  return letras.length ? letras.filter(c => c === c.toUpperCase() && c !== c.toLowerCase()).length / letras.length : 0
}
/** A word from a heading set in capitals, lowercased unless it is an acronym ("CDMX") or deliberately mixed ("SiTIS"). */
const minuscula = w => (SIGLAS.test(w) || (/\p{Ll}/u.test(w) && /\p{Lu}/u.test(w.slice(1))) ? w : w.toLowerCase())
const oracion = s => {
  if (!s) return ''
  if (mayusculas(s) < 0.85) return s[0].toUpperCase() + s.slice(1)
  const t = s
    .split(/(\s+)/)
    .map(minuscula)
    .join('')
    .replace(/\bciudad de méxico\b/g, 'Ciudad de México')
    .replace(/\bméxico\b/g, 'México')
  return t[0].toUpperCase() + t.slice(1)
}

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
    .map(w => (/^[IVXLC]+$/i.test(w) ? w.toUpperCase() : palabra(w)))
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

/**
 * `text` as escaped HTML with `<mark>` around `spans`, plus each `extras[i].html` inserted at offset
 * `extras[i].at` (an insertion that falls inside a mark goes right after it).
 */
export function marcar(text, spans, extras = []) {
  const ev = [...spans.map(([s, e]) => ({ s, e })), ...extras.map(x => ({ s: x.at, e: x.at, html: x.html }))].sort((a, b) => a.s - b.s || (a.html ? -1 : 1))
  let out = ''
  let pos = 0
  for (const x of ev) {
    if (x.s < pos) {
      if (x.html) out += x.html
      continue
    }
    out += esc(text.slice(pos, x.s)) + (x.html ?? `<mark>${esc(text.slice(x.s, x.e))}</mark>`)
    pos = x.html ? x.s : x.e
  }
  return raw(out + esc(text.slice(pos)))
}

const unaLinea = t => t.replace(/\s*\n\s*/g, ' ').trim()

/**
 * The window of `text` (about `len` chars, cut at spaces) holding the most matches, with ellipses where trimmed.
 * `notas` (`{ texto, html }`) are inserted right after each place their `texto` appears inside the window.
 */
export function extracto(text, stems, len = 300, notas = []) {
  const t = unaLinea(text)
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
  const extras = notas.flatMap(n => {
    const i = t.indexOf(unaLinea(n.texto))
    const at = i + unaLinea(n.texto).length
    return i >= 0 && at > start && at <= end ? [{ at: at - start, html: n.html }] : []
  })
  return html`${start > 0 ? '…' : ''}${marcar(pedazo, local, extras)}${end < t.length ? '…' : ''}`
}

export const TRAMOS = { 1: ['uno'], 2: ['min', 'max'], 3: ['min', 'med', 'max'] }
const NOMBRE_TRAMO = { min: 'mínima', med: 'media', max: 'máxima', uno: '' }

/** A fine written in UMA (`times`, e.g. [30, 32, 35]) as pesos at the site's UMA, tiered mínima/media/máxima when there are three. */
export function multaHtml(times) {
  const uma = SITIO.site?.uma
  if (!uma || !times?.length) return ''
  const tramos = TRAMOS[times.length] ?? times.map(() => 'uno')
  const montos = times.map(t => t * uma.value)
  const leer = montos.map((m, i) => [NOMBRE_TRAMO[tramos[i]], pesos(m)].filter(Boolean).join(' ')).join(', ')
  const detalle = times.map(t => `${nf.format(t)} UMA`).join(' · ')
  return `<span class="multa" role="note" aria-label="${esc(`Multa en pesos: ${leer}`)}" title="${esc(`${detalle} × ${pesos(uma.value)}`)}">${montos.map((m, i) => `<span class="multa-m" data-t="${tramos[i]}">${esc(pesos(m))}</span>`).join('')}</span>`
}

/** Answer text as paragraphs, with each [LISR 151], [RMF 2.7.1.21] or [SAT 12] marker turned into a link chip. */
export function citasHtml(text, criterios = []) {
  const porNumero = new Map(criterios.map(c => [String(c.number), c]))
  const chip = r => {
    const ley = r.match(/^([A-Z]{2,8})\s+(\d[\w.-]*)$/)
    if (ley && esDoc(ley[1])) return `<a class="cite" href="${ruta(ley[1], ley[2])}" title="${esc(`${DOCS[ley[1]].nombre}, ${titulo(ley[1], ley[2]).toLowerCase()}`)}">${esc(etiqueta(`${ley[1]}:${ley[2]}`)).replaceAll(' ', '&nbsp;')}</a>`
    const sat = r.match(/^SAT\s+(\d+)$/)
    if (!sat) return null
    const c = porNumero.get(sat[1])
    return `<a class="cite cite--sat" href="#sat-${sat[1]}"${c ? ` title="${esc(c.title)}"` : ''}>${c?.id ? esc(c.id) : `SAT&nbsp;${sat[1]}`}</a>`
  }
  const linea = t =>
    esc(t.replace(/⟨([^⟩]*)⟩/g, '($1)'))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/[\[【]([^\]】]+)[\]】]/g, (todo, dentro) => {
        const refs = dentro.split(/[,;]\s*/).map(r => chip(r.trim().replace(/\u2011/g, '-')))
        return refs.some(r => !r) ? todo : `<span class="cites">${refs.join('')}</span>`
      })
  const bloques = []
  for (const l of text.split(/\n+/).map(l => l.trim()).filter(Boolean)) {
    const punto = l.match(/^[-•*]\s+(.*)$/)
    if (punto) {
      const ultimo = bloques[bloques.length - 1]
      if (Array.isArray(ultimo)) ultimo.push(punto[1])
      else bloques.push([punto[1]])
    } else bloques.push(l)
  }
  return bloques.map(b => (Array.isArray(b) ? html`<ul>${b.map(p => html`<li>${raw(linea(p))}</li>`)}</ul>` : html`<p>${raw(linea(b))}</p>`))
}

/** Lowercase, accentless, punctuation-free text, for comparing questions. */
export const normal = s => plano(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export const anunciar = msg => {
  const el = document.getElementById('anuncio')
  el.textContent = ''
  requestAnimationFrame(() => (el.textContent = msg))
}

export const errorHtml = (e, titulo = 'Algo salió mal') => html`<div class="error" role="alert"><p class="error-title">${titulo}</p><p>${e.message}</p></div>`

export const esAborto = e => e?.name === 'AbortError'

/** Plural helper: `cuenta(3, 'artículo')` → "3 artículos". */
export const cuenta = (n, uno, varios = `${uno}s`) => `${nf.format(n)} ${n === 1 ? uno : varios}`
