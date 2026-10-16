import { anunciar, badge, tema, cargarFaqs, cargarRespuestas, coincidencias, consejos, corto, cuenta, docDeFaq, errorHtml, esAborto, esDoc, extracto, html, multaHtml, niveles, nf, normal, pct, raw, request, ruta, SITIO, terminos, titulo, titular } from './lib.js'
import { citasDe, preguntar } from './conversa.js'

const MODOS = [
  { id: 'semantica', api: 'VECTOR', nombre: 'Semántica', frase: 'semántica' },
  { id: 'hibrida', api: 'HYBRID', nombre: 'Híbrida', frase: 'híbrida' },
  { id: 'palabras', api: 'KEYWORD', nombre: 'Palabras', frase: 'por palabras' },
]

const HIT = `fragment hit on SearchHit { score passage fines { start end times } article { key number title law { code name } location repealed } }`

/** One request for every list the site splits results into (`site.lists`), or a single list for one document. */
const consulta = ley =>
  ley
    ? `query Buscar($q: String!, $mode: SearchMode, $law: LawCode) { l0: search(query: $q, mode: $mode, law: $law, first: 10) { ...hit } } ${HIT}`
    : `query Buscar($q: String!, $mode: SearchMode) { ${SITIO.site.lists
        .map((l, i) => `l${i}: search(query: $q, mode: $mode, laws: [${l.laws.join(', ')}], first: ${i ? 5 : 10}) { ...hit }`)
        .join(' ')} } ${HIT}`

const busquedas = new Map()

/** The site's own search mode (`site.defaultMode`): what a plain `/?q=` link means. */
const porDefecto = () => MODOS.find(m => m.api === SITIO.site.defaultMode) ?? MODOS[0]

const leer = params => ({
  q: (params.get('q') ?? '').trim(),
  modo: MODOS.find(m => m.id === params.get('modo')) ?? porDefecto(),
  ley: esDoc(params.get('ley')) ? params.get('ley') : '',
})

const enlace = ({ q, modo, ley }) => {
  const p = new URLSearchParams({ q })
  if (modo !== porDefecto()) p.set('modo', modo.id)
  if (ley) p.set('ley', ley)
  return `/?${p}`
}

const mayuscula = t => (t ? t[0].toUpperCase() + t.slice(1) : '')
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches

let el = null
let estado = null
let contexto = null
let rotador = 0
const citados = new Set()

export default {
  nombre: 'buscar',
  async mount(main, ctx) {
    el = main
    contexto = ctx
    el.innerHTML = html`<div class="buscar">
      <div class="buscar-top" data-slot="top"></div>
      <form class="ask" role="search" action="/" method="get" novalidate>
        <div class="ask-card">
          <div class="ask-campo">
            <label class="sr-only" for="q">Tu pregunta</label>
            <textarea id="q" name="q" rows="1" maxlength="300" placeholder=" " autocomplete="off" autocapitalize="sentences" spellcheck="true" enterkeyhint="search"></textarea>
            <p class="ask-ph" aria-hidden="true"><span class="ask-ph-lead">${tema().pregunta}</span> <span class="ask-ph-ej" data-slot="ej"></span></p>
          </div>
          <button class="ask-go" type="submit" aria-label="Preguntar"><span class="ico ico--flecha" aria-hidden="true"></span></button>
        </div>
        <input type="hidden" name="modo">
        <input type="hidden" name="ley">
      </form>
      <div data-slot="below"></div>
    </div>`
    const form = el.querySelector('form')
    const campo = form.q
    campo.addEventListener('input', () => {
      crecer(campo)
      if (campo.value) clearTimeout(rotador)
    })
    campo.addEventListener('focus', () => {
      clearTimeout(rotador)
      const slot = el.querySelector('[data-slot=ej]')
      if (slot) slot.textContent = SITIO.site.examples[Number(slot.dataset.i ?? 0)] ?? ''
    })
    campo.addEventListener('blur', () => !campo.value && !estado?.q && rotar())
    campo.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        form.requestSubmit()
      }
    })
    form.addEventListener('submit', e => {
      e.preventDefault()
      const q = campo.value.replace(/\s+/g, ' ').trim()
      if (!q) {
        campo.focus()
        return
      }
      const to = enlace({ q, modo: MODOS.find(m => m.id === form.modo.value) ?? porDefecto(), ley: form.ley.value })
      ctx.navigate(to, { replace: to === location.pathname + location.search })
      campo.blur()
    })
    const alCitar = e => e.detail.q === estado?.q && marcarCitados(e.detail.claves)
    const alResaltar = e => {
      for (const h of el.querySelectorAll(`.results-layout .hit[data-key="${CSS.escape(e.detail.clave)}"]`)) h.classList.toggle('is-resaltado', e.detail.on)
    }
    document.addEventListener('citas', alCitar)
    document.addEventListener('resaltar', alResaltar)
    await this.update(ctx)
    return () => {
      clearTimeout(rotador)
      document.removeEventListener('citas', alCitar)
      document.removeEventListener('resaltar', alResaltar)
    }
  },

  async update(ctx) {
    contexto = ctx
    const s = leer(ctx.params)
    const form = el.querySelector('form')
    if (document.activeElement !== form.q) form.q.value = s.q
    el.querySelector('.buscar').classList.toggle('buscar--resultados', !!s.q)
    crecer(form.q)
    form.modo.value = s.modo.id
    form.ley.value = s.ley
    estado = s
    titular(s.q)
    if (!s.q) return inicio()
    clearTimeout(rotador)
    return resultados(s, ctx)
  },
}

const crecer = campo => {
  campo.style.height = 'auto'
  campo.style.height = `${campo.scrollHeight}px`
}

/** The example questions type themselves into the empty box, one after another, until the visitor focuses it. */
function rotar() {
  clearTimeout(rotador)
  const slot = el.querySelector('[data-slot=ej]')
  const ejemplos = SITIO.site.examples
  if (!slot || !ejemplos.length) return
  let i = Number(slot.dataset.i ?? 0)
  slot.dataset.i = i
  if (reducido()) {
    slot.textContent = ejemplos[i]
    return
  }
  let borrando = slot.textContent === ejemplos[i]
  const paso = () => {
    const actual = slot.textContent
    if (borrando) {
      slot.textContent = actual.slice(0, -2)
      if (slot.textContent) return void (rotador = setTimeout(paso, 16))
      borrando = false
      i = (i + 1) % ejemplos.length
      slot.dataset.i = i
      return void (rotador = setTimeout(paso, 380))
    }
    slot.textContent = ejemplos[i].slice(0, actual.length + 1)
    if (slot.textContent === ejemplos[i]) {
      borrando = true
      rotador = setTimeout(paso, 2600)
    } else rotador = setTimeout(paso, 34 + Math.random() * 46)
  }
  rotador = setTimeout(paso, borrando ? 1600 : 500)
}

function inicio() {
  const { site } = SITIO
  el.querySelector('[data-slot=top]').innerHTML = html`<header class="hero">
    <h1 tabindex="-1"${site.tagline.length > 40 ? ' class="is-largo"' : ''}>${mayuscula(site.tagline)}.</h1>
    <p class="deck">${site.description}</p>
  </header>`
  rotar()
  const tips = consejos()
  const below = el.querySelector('[data-slot=below]')
  below.innerHTML = html`${tips ? guiaHtml(tips) : ''}<section class="examples" aria-labelledby="ej-h">
      <h2 class="label" id="ej-h">Prueba con</h2>
      <ul class="chips">${site.examples.map(q => html`<li><a class="chip" href="${enlace({ q, modo: porDefecto(), ley: '' })}">${q}</a></li>`)}</ul>
    </section>
    <section class="faq-teaser" aria-labelledby="faq-t-h" data-slot="faqs" hidden></section>
    ${tips ? '' : html`<section class="figures" aria-label="Qué tan bien responde" data-slot="cifras"></section>`}`
  cargarFaqs().then(fs => {
    const slot = below.querySelector('[data-slot=faqs]')
    if (!slot || !fs.length) return
    slot.innerHTML = html`<h2 class="label" id="faq-t-h">Preguntas frecuentes</h2>
      <ul class="chips chips--faq">${destacadas(fs).map(f => html`<li><a class="chip" href="/preguntas/${f.slug}">${f.question}</a></li>`)}</ul>
      <p class="faq-teaser-all"><a href="/preguntas">Ver las ${nf.format(fs.length)} preguntas respondidas</a></p>`
    slot.hidden = false
  })
  if (tips) return
  return cargarRespuestas()
    .then(r => {
      const slot = below.querySelector('[data-slot=cifras]')
      const c = r?.corridas?.at(-1)
      const partes = c ? ['anexo7', 'anexo3', 'todas'].map(k => c[k]).filter(Boolean) : []
      const n = partes.reduce((t, p) => t + p.n, 0)
      if (!slot || !n) return
      const tasa = k => pct(partes.reduce((t, p) => t + p[k] * p.n, 0) / n, 0)
      slot.innerHTML = html`<p class="cifras-frase">Probamos las respuestas con ${nf.format(n)} preguntas sacadas de los criterios del SAT: ${tasa('correcta')} coincidieron con el criterio, ${tasa('incompleta')} se quedaron cortas y ${tasa('incorrecta')} lo contradijeron. <a href="/como-funciona">Cómo lo medimos</a></p>`
    })
    .catch(() => {})
}

/** The traffic site's "if an agent stops you" guide, right under the search box: its first steps, and a way to all of them. */
const guiaHtml = c => html`<section class="guia-home" aria-labelledby="guia-h">
    <div class="guia-home-cab">
      <span class="guia-home-luz" aria-hidden="true"><i></i><i></i><i></i></span>
      <div>
        <h2 id="guia-h"><a href="/si-te-para-un-agente">Si te para un agente de tránsito</a></h2>
        <p class="guia-home-sub">Qué puede y qué no puede hacer, con el artículo que lo dice.</p>
      </div>
    </div>
    <ol class="guia-home-lista">${c.tips.slice(0, 6).map(t => html`<li><a href="/si-te-para-un-agente#${t.slug}">${t.title}</a></li>`)}</ol>
    <p class="guia-home-todos"><a href="/si-te-para-un-agente">Los ${nf.format(c.tips.length)} consejos, con sus artículos</a></p>
  </section>`

/** Up to four checked questions for the home page, one per document, shortest first, none repeating an example. */
function destacadas(fs) {
  const ejemplos = new Set(SITIO.site.examples.map(normal))
  const vistos = new Set()
  return [...fs]
    .filter(f => f.verified && !ejemplos.has(normal(f.question)) && f.question.length <= 90)
    .sort((a, b) => a.question.length - b.question.length)
    .filter(f => {
      const d = docDeFaq(f)
      if (vistos.has(d)) return false
      vistos.add(d)
      return true
    })
    .slice(0, 4)
}

/**
 * Published questions that share most of the query's words (accent- and case-insensitive stems): at least two
 * of them and half of all, or the one word of a one-word query. Best overlap first, then the shorter question.
 */
function parecidas(fs, q) {
  const stems = terminos(q)
  if (!stems.length) return []
  const exacta = normal(q)
  return fs
    .filter(f => f.verified)
    .map(f => ({ f, n: stems.filter(st => coincidencias(f.question, [st]).length).length, exacta: normal(f.question) === exacta }))
    .filter(x => x.exacta || (stems.length === 1 ? x.n === 1 : x.n >= 2 && x.n / stems.length >= 0.5))
    .sort((a, b) => b.exacta - a.exacta || b.n / stems.length - a.n / stems.length || a.f.question.length - b.f.question.length)
    .slice(0, 3)
    .map(x => x.f)
}

const esqueleto = n => html`<ol class="hits" aria-hidden="true">${Array.from({ length: n }, () => html`<li class="hit hit--skeleton"><span class="sk sk-s"></span><span class="sk sk-m"></span><span class="sk"></span><span class="sk sk-l"></span></li>`)}</ol>`

/** The lists this search shows: the site's own (`site.lists`), or one list named after the filtered document. */
const listasDe = s => (s.ley ? [{ title: corto(s.ley), note: '', laws: [s.ley] }] : SITIO.site.lists)

/** Marks the law results the conversation about this search cited, so the answer and the law read as one. */
function marcarCitados(claves) {
  if (claves) {
    citados.clear()
    for (const c of claves) citados.add(c)
  }
  for (const h of el.querySelectorAll('.results-layout .hit[data-key]')) h.classList.toggle('hit--citado', citados.has(h.dataset.key))
}

function resultados(s, ctx) {
  el.querySelector('[data-slot=top]').innerHTML = html`<h1 class="resultados-h" tabindex="-1">${s.q}</h1>`
  const below = el.querySelector('[data-slot=below]')
  if (!below.querySelector('.results-layout'))
    below.innerHTML = html`<div class="results-layout">
      <section class="faq-matches" aria-labelledby="faq-m-h" data-slot="faqs" hidden></section>
      <section class="results" aria-labelledby="lista-0-h" data-slot="results"></section>
      <div class="results-side" data-slot="side"></div>
    </div>`
  const layout = below.querySelector('.results-layout')
  if (!layout.dataset.escucha) {
    layout.dataset.escucha = '1'
    layout.addEventListener('change', e => {
      if (!e.target.matches('[data-modo]')) return
      ctx.navigate(enlace({ q: estado.q, modo: MODOS.find(m => m.id === e.target.value) ?? porDefecto(), ley: estado.ley }))
    })
  }
  citados.clear()
  for (const c of citasDe(s.q)) citados.add(c)
  preguntar(s.q)
  const caja = below.querySelector('[data-slot=faqs]')
  caja.hidden = true
  cargarFaqs().then(fs => {
    if (ctx.signal.aborted || estado?.q !== s.q) return
    const ps = parecidas(fs, s.q)
    caja.hidden = !ps.length
    caja.innerHTML = ps.length
      ? html`<h2 class="label" id="faq-m-h">Preguntas frecuentes parecidas</h2>
        <ul class="faq-mini">${ps.map(f => html`<li><a href="/preguntas/${f.slug}">${f.question}</a></li>`)}</ul>`
      : ''
  })

  const listas = listasDe(s)
  const slot = below.querySelector('[data-slot=results]')
  const lado = below.querySelector('[data-slot=side]')
  const llave = `${s.modo.api}|${s.ley}|${s.q}`
  let p = busquedas.get(llave)
  if (!p) {
    p = request(consulta(s.ley), s.ley ? { q: s.q, mode: s.modo.api, law: s.ley } : { q: s.q, mode: s.modo.api })
    busquedas.set(llave, p)
    p.catch(() => busquedas.delete(llave))
  }
  slot.setAttribute('aria-busy', 'true')
  slot.innerHTML = html`<div class="results-head"><h2 id="lista-0-h" class="label">${listas[0].title}</h2></div>${esqueleto(4)}`
  lado.innerHTML = listas.slice(1).map((l, i) => html`<section class="results results--side" id="lista-${i + 1}" aria-labelledby="lista-${i + 1}-h">${cabeza(l, i + 1)}${esqueleto(2)}</section>`).join('')
  return p.then(
    ({ data, extensions }) => {
      if (ctx.signal.aborted) return
      slot.removeAttribute('aria-busy')
      const hits = listas.map((_, i) => data[`l${i}`] ?? [])
      const otras = listas.slice(1).map((l, i) => ({ l, i: i + 1, n: hits[i + 1].length })).filter(o => o.n)
      slot.innerHTML = principalHtml(hits[0], s, listas[0], extensions?.degraded, otras)
      lado.innerHTML = listas
        .slice(1)
        .map((l, i) => (hits[i + 1].length || hits[0].length ? html`<section class="results results--side" id="lista-${i + 1}" aria-labelledby="lista-${i + 1}-h">${secundariaHtml(hits[i + 1], s, l, i + 1)}</section>` : ''))
        .join('')
      const total = hits.reduce((n, h) => n + h.length, 0)
      marcarCitados()
      anunciar(!total ? 'Sin resultados.' : listas.length === 1 ? `${cuenta(total, 'resultado')}.` : `${listas.map((l, i) => `${nf.format(hits[i].length)} en ${l.title}`).join(', ')}.`)
    },
    e => {
      if (esAborto(e) || ctx.signal.aborted) return
      slot.removeAttribute('aria-busy')
      slot.innerHTML = html`<div class="results-head"><h2 id="lista-0-h" class="label">${listas[0].title}</h2></div>${errorHtml(e, 'No se pudo buscar')}`
      lado.innerHTML = ''
    },
  )
}

const cabeza = (l, i) => html`<div class="results-head results-head--side"><h2 id="lista-${i}-h" class="label">${l.title}</h2></div>${l.note ? html`<p class="reglas-nota">${l.note}</p>` : ''}`

/** Fine chips for a hit's passage: each fine's own words (`SearchHit.fines` spans are relative to the passage), then its amount in pesos. */
const notasMulta = h => (h.fines ?? []).map(f => ({ texto: h.passage.slice(f.start, f.end), html: multaHtml(f.times) })).filter(n => n.html)

function hitHtml(h, i, s, stems, compacto) {
  const a = h.article
  const ns = niveles(a.location)
  const ultimo = ns[ns.length - 1]
  const href = `${ruta(a.law.code, a.number)}?${new URLSearchParams({ q: s.q })}`
  return html`<li class="hit${compacto ? ' hit--compact' : ''}" data-key="${a.law.code}:${a.number}">
    <span class="hit-rank" aria-hidden="true">${i + 1}</span>
    <div class="hit-body">
      <p class="hit-meta">${badge(a.law.code)}<span class="hit-citado">Citado en la respuesta</span></p>
      <h3 class="hit-title"><a href="${href}" data-pasaje="${h.passage}">${titulo(a.law.code, a.number)}</a>${a.repealed ? html` <span class="tag">Derogado</span>` : ''}</h3>
      ${a.title ? html`<p class="hit-rule">${a.title}</p>` : ''}
      ${!compacto && ns.length ? html`<p class="hit-loc">${ns.filter(n => n.label).map(n => n.label).join(' › ')}${ultimo?.name ? html`<span class="hit-loc-name"> · ${ultimo.name}</span>` : ''}</p>` : ''}
      <p class="hit-passage">${extracto(h.passage, stems, compacto ? 200 : 300, notasMulta(h))}</p>
    </div>
  </li>`
}

const modoHtml = (s, degradada) =>
  degradada
    ? html`<span class="muted">búsqueda por palabras</span>`
    : html`<label class="modo"><span class="sr-only">Tipo de búsqueda</span><select data-modo>${MODOS.map(m => html`<option value="${m.id}"${m === s.modo ? raw(' selected') : ''}>búsqueda ${m.frase}</option>`)}</select></label>`

function principalHtml(hits, s, lista, degradada, otras) {
  const stems = terminos(s.q)
  const saltos = otras.map(o => html`<a class="jump" href="#lista-${o.i}">${nf.format(o.n)} en ${o.l.title}</a>`)
  const head = html`${degradada ? html`<p class="degraded" role="status">Búsqueda por palabras: el modelo semántico no está disponible en este momento.</p>` : ''}<div class="results-head"><h2 id="lista-0-h" class="label">${lista.title}</h2><p class="results-count">${cuenta(hits.length, 'resultado')} <span class="muted">·</span> ${modoHtml(s, degradada)}${s.ley ? html` <span class="muted">· solo ${corto(s.ley)}</span>` : ''}</p></div>${saltos.length ? html`<p class="jumps">${saltos}</p>` : ''}`
  if (!hits.length)
    return otras.length
      ? html`${head}<p class="empty empty--small">Nada en «${lista.title}» coincide con esta búsqueda.</p>`
      : html`${head}<div class="empty"><p>No encontramos artículos para esa búsqueda.</p><p class="muted">Prueba con otras palabras o con una pregunta más corta.</p></div>`
  return html`${head}<ol class="hits">${hits.map((h, i) => hitHtml(h, i, s, stems, false))}</ol>`
}

function secundariaHtml(hits, s, lista, i) {
  if (!hits.length) return html`${cabeza(lista, i)}<p class="empty empty--small">Nada en «${lista.title}» coincide.</p>`
  const stems = terminos(s.q)
  return html`${cabeza(lista, i)}<ol class="hits">${hits.map((h, k) => hitHtml(h, k, s, stems, true))}</ol>`
}
