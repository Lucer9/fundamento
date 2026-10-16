import { anunciar, asistente, badge, cargarEval, cargarFaqs, coincidencias, consejos, corto, cuenta, DOCS, docDeFaq, errorHtml, esAborto, esDoc, extracto, guardarIa, html, iaActiva, multaHtml, niveles, nf, normal, opcionesDocs, pct, raw, request, ruta, SITIO, terminos, titulo, titular } from './lib.js'
import { detenerConversa, FLECHA, montarConversa } from './conversa.js'

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
let portada = null

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

const conReglas = () => Object.values(DOCS).some(d => d.familia === 'reglas')
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
    const yo = asistente()
    el.innerHTML = html`<div class="buscar">
      <div class="buscar-top" data-slot="top"></div>
      <form class="ask" role="search" action="/" method="get" novalidate>
        <div class="ask-card">
          <div class="ask-campo">
            <label class="sr-only" for="q">Tu pregunta</label>
            <textarea id="q" name="q" rows="1" maxlength="300" placeholder=" " autocomplete="off" autocapitalize="sentences" spellcheck="true" enterkeyhint="search"></textarea>
            <p class="ask-ph" aria-hidden="true"><span class="ask-ph-lead">Pregunta en tus palabras.</span> <span class="ask-ph-ej" data-slot="ej"></span></p>
          </div>
          <div class="ask-bar">
            <label class="switch">
              <input type="checkbox" name="ia" role="switch">
              <span class="switch-pista" aria-hidden="true"></span>
              <span class="switch-texto"><span class="switch-de">Respuesta de </span><span class="switch-nombre">${raw(yo.html)}</span></span>
            </label>
            <label class="pill">
              <span class="sr-only">Buscar en</span>
              <select name="ley"><option value="">Todo</option>${opcionesDocs()}</select>
            </label>
            <button class="ask-go" type="submit" aria-label="Buscar">${FLECHA}</button>
          </div>
        </div>
        <input type="hidden" name="modo">
      </form>
      <div data-slot="below"></div>
    </div>`
    const form = el.querySelector('form')
    const campo = form.q
    campo.addEventListener('input', () => {
      crecer(campo)
      if (campo.value) clearInterval(rotador)
      else if (!estado?.q) rotar()
    })
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
    form.ia.addEventListener('change', () => {
      guardarIa(form.ia.checked)
      if (estado?.q) ponerIa(form.ia.checked, estado.q)
    })
    form.ley.addEventListener('change', () => estado?.q && form.requestSubmit())
    await this.update(ctx)
    return () => {
      clearInterval(rotador)
      detenerConversa()
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
    form.ia.checked = iaActiva()
    estado = s
    titular(s.q)
    if (!s.q) return inicio()
    clearInterval(rotador)
    return resultados(s, ctx)
  },
}

const crecer = campo => {
  campo.style.height = 'auto'
  campo.style.height = `${campo.scrollHeight}px`
}

/** The example questions take turns in the empty box until the visitor focuses it. */
function rotar() {
  clearInterval(rotador)
  const slot = el.querySelector('[data-slot=ej]')
  const ejemplos = SITIO.site.examples
  if (!slot || !ejemplos.length) return
  let i = Number(slot.dataset.i ?? -1)
  const siguiente = () => {
    i = (i + 1) % ejemplos.length
    slot.dataset.i = i
    slot.classList.remove('is-entrando')
    void slot.offsetWidth
    slot.textContent = ejemplos[i]
    slot.classList.add('is-entrando')
  }
  if (i < 0) siguiente()
  if (!reducido()) rotador = setInterval(siguiente, 3600)
}

function inicio() {
  const { site } = SITIO
  el.querySelector('[data-slot=top]').innerHTML = html`<header class="hero">
    <h1 tabindex="-1"${site.tagline.length > 40 ? ' class="is-largo"' : ''}>${mayuscula(site.tagline)}.</h1>
    <p class="deck">${site.description}</p>
  </header>`
  rotar()
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !location.hash) el.querySelector('#q').focus({ preventScroll: true })
  const tips = consejos()
  const below = el.querySelector('[data-slot=below]')
  below.innerHTML = html`<section class="examples" aria-labelledby="ej-h">
      <h2 class="label" id="ej-h">Prueba con</h2>
      <ul class="chips">${site.examples.map(q => html`<li><a class="chip" href="${enlace({ q, modo: porDefecto(), ley: '' })}">${q}</a></li>`)}</ul>
    </section>
    ${tips ? consejosHtml(tips) : ''}
    <section class="faq-teaser" aria-labelledby="faq-t-h" data-slot="faqs" hidden></section>
    <section class="figures" aria-label="En cifras" data-slot="cifras"></section>`
  cargarFaqs().then(fs => {
    const slot = below.querySelector('[data-slot=faqs]')
    if (!slot || !fs.length) return
    slot.innerHTML = html`<h2 class="label" id="faq-t-h">Preguntas frecuentes</h2>
      <ul class="chips chips--faq">${destacadas(fs).map(f => html`<li><a class="chip" href="/preguntas/${f.slug}">${f.question}</a></li>`)}</ul>
      <p class="faq-teaser-all"><a href="/preguntas">Ver las ${nf.format(fs.length)} preguntas respondidas</a></p>`
    slot.hidden = false
  })
  portada ??= cargarEval().catch(() => null)
  return portada.then(ev => {
    const slot = below.querySelector('[data-slot=cifras]')
    if (!slot) return
    const { stats } = SITIO
    const set = ev?.naturales ?? ev
    const prod = ev?.enUso && set?.metodos?.find(m => m.nombre === ev.enUso)
    const lista = site.lists[0]?.title
    slot.innerHTML = html`<dl class="figures-row">
      <div><dt>${conReglas() ? 'artículos y reglas' : 'artículos'} vigentes en ${cuenta(Object.keys(DOCS).length, 'documento')}</dt><dd>${nf.format(stats.articles)}</dd></div>
      <div><dt>citas entre artículos, cada una un enlace</dt><dd>${nf.format(stats.citations)}</dd></div>
      ${prod ? html`<div><dt>de ${set.n} preguntas de prueba traen el artículo esperado entre los 5 primeros resultados${lista && ev.enUso.endsWith(` · ${lista.toLowerCase()}`) ? html` de «${lista}»` : ''}. <a href="/como-funciona">Cómo se mide</a></dt><dd>${pct(prod.hit5, 0)}</dd></div>` : ''}
    </dl>`
  })
}

/** The traffic site's "if an agent stops you" guide, abridged for the home page; the full one lives at its own page. */
const consejosHtml = c => html`<section class="consejos-home" aria-labelledby="cons-h">
    <h2 class="consejos-home-h" id="cons-h">Si te para un agente de tránsito</h2>
    <p class="consejos-home-deck">${c.knowTheRules}</p>
    <ol class="consejos-mini">${c.tips.slice(0, 6).map(t => html`<li><a href="/si-te-para-un-agente#${t.slug}">${t.title}</a></li>`)}</ol>
    <p class="faq-teaser-all"><a href="/si-te-para-un-agente">Lee los ${nf.format(c.tips.length)} consejos, con sus artículos</a></p>
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
    .map(f => ({ f, n: stems.filter(st => coincidencias(f.question, [st]).length).length, exacta: normal(f.question) === exacta }))
    .filter(x => x.exacta || (stems.length === 1 ? x.n === 1 : x.n >= 2 && x.n / stems.length >= 0.5))
    .sort((a, b) => b.exacta - a.exacta || b.n / stems.length - a.n / stems.length || a.f.question.length - b.f.question.length)
    .slice(0, 3)
    .map(x => x.f)
}

const esqueleto = n => html`<ol class="hits" aria-hidden="true">${Array.from({ length: n }, () => html`<li class="hit hit--skeleton"><span class="sk sk-s"></span><span class="sk sk-m"></span><span class="sk"></span><span class="sk sk-l"></span></li>`)}</ol>`

/** The lists this search shows: the site's own (`site.lists`), or one list named after the filtered document. */
const listasDe = s => (s.ley ? [{ title: corto(s.ley), note: '', laws: [s.ley] }] : SITIO.site.lists)

/** Marks the law results the assistant cited, so the two columns read as one answer. */
function marcarCitados(claves) {
  if (claves) {
    citados.clear()
    for (const c of claves) citados.add(c)
  }
  for (const h of el.querySelectorAll('.ley .hit[data-key]')) h.classList.toggle('hit--citado', citados.has(h.dataset.key))
}

/** Shows or hides the answer column for this search, starting the answer when it is turned on. */
function ponerIa(activa, q) {
  const layout = el.querySelector('.results-layout')
  if (!layout) return
  layout.dataset.ia = activa ? '1' : '0'
  if (!activa) {
    detenerConversa()
    delete layout.querySelector('[data-slot=ia]').dataset.q
    citados.clear()
    marcarCitados()
    vista(layout, 'ley')
    return
  }
  const slot = layout.querySelector('[data-slot=ia]')
  if (slot.dataset.q !== q) {
    slot.dataset.q = q
    montarConversa(slot, q, { alCitar: marcarCitados })
  }
  vista(layout, 'ia')
}

function vista(layout, cual) {
  layout.dataset.vista = cual
  for (const b of layout.querySelectorAll('.vistas button')) b.setAttribute('aria-pressed', String(b.dataset.vista === cual))
}

function resultados(s, ctx) {
  el.querySelector('[data-slot=top]').innerHTML = html`<h1 class="sr-only" tabindex="-1">Resultados para «${s.q}»</h1>`
  const below = el.querySelector('[data-slot=below]')
  const yo = asistente()
  if (!below.querySelector('.results-layout')) {
    below.innerHTML = html`<div class="results-layout" data-ia="1" data-vista="ia">
      <div class="vistas" role="group" aria-label="Qué ver">
        <button type="button" data-vista="ia" aria-pressed="true">${raw(yo.html)}</button>
        <button type="button" data-vista="ley" aria-pressed="false">La ley<span class="vistas-n" data-slot="n"></span></button>
      </div>
      <section class="conversa" aria-label="Respuesta de ${yo.nombre}" data-slot="ia"></section>
      <div class="ley">
        <section class="faq-matches" aria-labelledby="faq-m-h" data-slot="faqs" hidden></section>
        <section class="results" aria-labelledby="lista-0-h" data-slot="results"></section>
        <div class="results-side" data-slot="side"></div>
      </div>
    </div>`
    const layout = below.querySelector('.results-layout')
    layout.querySelector('.vistas').addEventListener('click', e => {
      const b = e.target.closest('button[data-vista]')
      if (b) vista(layout, b.dataset.vista)
    })
    layout.addEventListener('change', e => {
      if (!e.target.matches('[data-modo]')) return
      const f = el.querySelector('form')
      f.modo.value = e.target.value
      f.requestSubmit()
    })
    layout.addEventListener('click', e => {
      if (!e.target.closest('[data-pedir-ia]')) return
      el.querySelector('form').ia.checked = true
      guardarIa(true)
      ponerIa(true, estado.q)
    })
    const resaltar = (e, on) => {
      const a = e.target.closest('.conversa .cite[href], .conversa .answer-sources a[href]')
      if (!a) return
      const [, ley, n] = decodeURIComponent(new URL(a.href).pathname).split('/')
      for (const h of layout.querySelectorAll(`.ley .hit[data-key="${CSS.escape(`${ley}:${n}`)}"]`)) h.classList.toggle('is-resaltado', on)
    }
    layout.addEventListener('mouseover', e => resaltar(e, true))
    layout.addEventListener('mouseout', e => resaltar(e, false))
    layout.addEventListener('focusin', e => resaltar(e, true))
    layout.addEventListener('focusout', e => resaltar(e, false))
  }
  const layout = below.querySelector('.results-layout')
  citados.clear()
  ponerIa(iaActiva(), s.q)
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
  const cuantos = layout.querySelector('[data-slot=n]')
  cuantos.textContent = ''
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
      cuantos.textContent = total ? ` ${nf.format(total)}` : ''
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
      <p class="hit-meta">${badge(a.law.code)}${compacto ? '' : html`<span class="hit-law">${a.law.name}</span>`}<span class="hit-citado">Citado en la respuesta</span></p>
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
  const yo = asistente()
  const saltos = otras.map(o => html`<a class="jump" href="#lista-${o.i}">${nf.format(o.n)} en ${o.l.title}</a>`)
  const head = html`${degradada ? html`<p class="degraded" role="status">Búsqueda por palabras: el modelo semántico no está disponible en este momento.</p>` : ''}<div class="results-head"><h2 id="lista-0-h" class="label">${lista.title}</h2><p class="results-count">${cuenta(hits.length, 'resultado')} <span class="muted">·</span> ${modoHtml(s, degradada)}${s.ley ? html` <span class="muted">· solo ${corto(s.ley)}</span>` : ''}</p></div>${saltos.length ? html`<p class="jumps">${saltos}</p>` : ''}<p class="pedir-ia"><button class="button button--quiet" type="button" data-pedir-ia>Pedir respuesta a ${raw(yo.html)}</button></p>`
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
