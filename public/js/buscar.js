import { anunciar, badge, cargarEval, corto, cuenta, DOCS, errorHtml, familiasPresentes, esAborto, esc, esDoc, etiqueta, extracto, html, modeloBonito, multaHtml, niveles, nf, opcionesDocs, pct, raw, request, ruta, SITIO, terminos, tieneCriterios, TIPO_CRITERIO, titulo, tituloPagina } from './lib.js'

const MODOS = [
  { id: 'semantica', api: 'VECTOR', nombre: 'Semántica', frase: 'semántica' },
  { id: 'hibrida', api: 'HYBRID', nombre: 'Híbrida', frase: 'híbrida' },
  { id: 'palabras', api: 'KEYWORD', nombre: 'Palabras', frase: 'por palabras' },
]

const ANSWER = `query Responder($q: String!) {
  answer(question: $q) { text model cached sources { key number law { code } } criteria { number id kind title } }
}`

const HIT = `fragment hit on SearchHit { score passage fines { start end times } article { key number title law { code name } location repealed } }`

/** One request for every list the site splits results into (`site.lists`), or a single list for one document. */
const consulta = ley =>
  ley
    ? `query Buscar($q: String!, $mode: SearchMode, $law: LawCode) { l0: search(query: $q, mode: $mode, law: $law, first: 10) { ...hit } } ${HIT}`
    : `query Buscar($q: String!, $mode: SearchMode) { ${SITIO.site.lists
        .map((l, i) => `l${i}: search(query: $q, mode: $mode, laws: [${l.laws.join(', ')}], first: ${i ? 5 : 10}) { ...hit }`)
        .join(' ')} } ${HIT}`

const busquedas = new Map()
const respuestas = new Map()
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

let el = null
let estado = null

export default {
  nombre: 'buscar',
  mount(main, ctx) {
    el = main
    el.innerHTML = html`<div class="buscar">
      <div class="buscar-top" data-slot="top"></div>
      <form class="search" role="search" action="/" method="get" novalidate>
        <label class="search-label" for="q">Tu pregunta</label>
        <div class="search-row">
          <input id="q" name="q" type="search" placeholder="Pregunta en español…" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="search" maxlength="300">
          <button class="button" type="submit">Buscar</button>
        </div>
        <div class="search-opts">
          <fieldset class="seg">
            <legend class="sr-only">Tipo de búsqueda</legend>
            ${MODOS.map(m => html`<label><input type="radio" name="modo" value="${m.id}"><span>${m.nombre}</span></label>`)}
          </fieldset>
          <label class="select">
            <span class="sr-only">Documento</span>
            <select name="ley">
              <option value="">Todos</option>
              ${opcionesDocs()}
            </select>
          </label>
        </div>
      </form>
      <div data-slot="below"></div>
    </div>`
    const form = el.querySelector('form')
    form.addEventListener('submit', e => {
      e.preventDefault()
      const q = form.q.value.trim()
      if (!q) {
        form.q.focus()
        return
      }
      const to = enlace({ q, modo: MODOS.find(m => m.id === form.modo.value) ?? porDefecto(), ley: form.ley.value })
      ctx.navigate(to, { replace: to === location.pathname + location.search })
      form.q.blur()
    })
    form.addEventListener('change', e => {
      if (e.target.name === 'q' || !estado?.q) return
      form.requestSubmit()
    })
    return this.update(ctx)
  },

  async update(ctx) {
    const s = leer(ctx.params)
    const form = el.querySelector('form')
    if (document.activeElement !== form.q) form.q.value = s.q
    form.modo.value = s.modo.id
    form.ley.value = s.ley
    estado = s
    el.querySelector('.buscar').classList.toggle('buscar--resultados', !!s.q)
    document.title = tituloPagina(s.q)
    if (!s.q) return inicio(ctx)
    return resultados(s, ctx)
  },
}

function inicio() {
  const { site } = SITIO
  el.querySelector('[data-slot=top]').innerHTML = html`<header class="hero">
    <p class="kicker">${familiasPresentes().map(f => f.nombre).join(' · ')}</p>
    <h1 tabindex="-1"${site.tagline.length > 40 ? ' class="is-largo"' : ''}>${mayuscula(site.tagline)}.</h1>
    <p class="deck">${site.description}</p>
  </header>`
  const below = el.querySelector('[data-slot=below]')
  below.innerHTML = html`<section class="examples" aria-labelledby="ej-h">
      <h2 class="label" id="ej-h">Prueba con</h2>
      <ul class="chips">${site.examples.map(q => html`<li><a class="chip" href="${enlace({ q, modo: porDefecto(), ley: '' })}">${q}</a></li>`)}</ul>
    </section>
    <section class="figures" aria-label="En cifras" data-slot="cifras"></section>`
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

const esqueleto = n => html`<ol class="hits" aria-hidden="true">${Array.from({ length: n }, () => html`<li class="hit hit--skeleton"><span class="sk sk-s"></span><span class="sk sk-m"></span><span class="sk"></span><span class="sk sk-l"></span></li>`)}</ol>`

/** The lists this search shows: the site's own (`site.lists`), or one list named after the filtered document. */
const listasDe = s => (s.ley ? [{ title: corto(s.ley), note: '', laws: [s.ley] }] : SITIO.site.lists)

function resultados(s, ctx) {
  el.querySelector('[data-slot=top]').innerHTML = html`<h1 class="sr-only" tabindex="-1">Resultados para «${s.q}»</h1>`
  const below = el.querySelector('[data-slot=below]')
  if (!below.querySelector('.results-layout')) {
    below.innerHTML = html`<div class="results-layout">
      <aside class="answer" aria-labelledby="answer-h"><h2 class="label" id="answer-h">Respuesta breve</h2><div class="answer-body" data-slot="answer"></div></aside>
      <section class="results" aria-labelledby="lista-0-h" data-slot="results"></section>
      <div class="results-side" data-slot="side"></div>
    </div>`
  }
  respuesta(s.q, below.querySelector('[data-slot=answer]'))

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
  return html`<li class="hit${compacto ? ' hit--compact' : ''}">
    <span class="hit-rank" aria-hidden="true">${i + 1}</span>
    <div class="hit-body">
      <p class="hit-meta">${badge(a.law.code)}${compacto ? '' : html`<span class="hit-law">${a.law.name}</span>`}</p>
      <h3 class="hit-title"><a href="${href}" data-pasaje="${h.passage}">${titulo(a.law.code, a.number)}</a>${a.repealed ? html` <span class="tag">Derogado</span>` : ''}</h3>
      ${a.title ? html`<p class="hit-rule">${a.title}</p>` : ''}
      ${!compacto && ns.length ? html`<p class="hit-loc">${ns.filter(n => n.label).map(n => n.label).join(' › ')}${ultimo?.name ? html`<span class="hit-loc-name"> · ${ultimo.name}</span>` : ''}</p>` : ''}
      <p class="hit-passage">${extracto(h.passage, stems, compacto ? 200 : 300, notasMulta(h))}</p>
    </div>
  </li>`
}

function principalHtml(hits, s, lista, degradada, otras) {
  const stems = terminos(s.q)
  const filtro = [degradada ? 'por palabras' : s.modo.frase, s.ley ? `solo ${corto(s.ley)}` : ''].filter(Boolean).join(', ')
  const saltos = otras.map(o => html`<a class="jump" href="#lista-${o.i}">${nf.format(o.n)} en ${o.l.title}</a>`)
  const head = html`${degradada ? html`<p class="degraded" role="status">Búsqueda por palabras: el modelo semántico no está disponible en este momento.</p>` : ''}<div class="results-head"><h2 id="lista-0-h" class="label">${lista.title}</h2><p class="results-count">${cuenta(hits.length, 'resultado')} <span class="muted">· búsqueda ${filtro}</span></p></div>${saltos.length ? html`<p class="jumps">${saltos}</p>` : ''}`
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

function citasHtml(text, criterios) {
  const porNumero = new Map(criterios.map(c => [String(c.number), c]))
  const chip = r => {
    const ley = r.match(/^([A-Z]{2,8})\s+(\d[\w.-]*)$/)
    if (ley && esDoc(ley[1])) return `<a class="cite" href="${ruta(ley[1], ley[2])}" title="${esc(`${DOCS[ley[1]].nombre}, ${titulo(ley[1], ley[2]).toLowerCase()}`)}">${esc(etiqueta(`${ley[1]}:${ley[2]}`)).replace(' ', '&nbsp;')}</a>`
    const sat = r.match(/^SAT\s+(\d+)$/)
    if (!sat) return null
    const c = porNumero.get(sat[1])
    return `<a class="cite cite--sat" href="#sat-${sat[1]}"${c ? ` title="${esc(c.title)}"` : ''}>${c?.id ? esc(c.id) : `SAT&nbsp;${sat[1]}`}</a>`
  }
  return text
    .split(/\n{2,}/)
    .map(par =>
      html`<p>${raw(
        esc(par).replace(/[\[【]([^\]】]+)[\]】]/g, (todo, dentro) => {
          const refs = dentro.split(/[,;]\s*/).map(r => chip(r.trim().replace(/\u2011/g, '-')))
          return refs.some(r => !r) ? todo : `<span class="cites">${refs.join('')}</span>`
        }),
      )}</p>`,
    )
}

function respuesta(q, slot) {
  if (slot.dataset.q === q) return
  slot.dataset.q = q
  const aside = slot.closest('.answer')
  let p = respuestas.get(q)
  if (!p) {
    p = request(ANSWER, { q })
    respuestas.set(q, p)
    p.catch(() => respuestas.delete(q))
  }
  aside.setAttribute('aria-busy', 'true')
  slot.innerHTML = html`<p class="answer-wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Leyendo los artículos para redactar una respuesta…</p>
    <div aria-hidden="true"><span class="sk"></span><span class="sk"></span><span class="sk sk-l"></span></div>`
  p.then(
    ({ data: { answer } }) => {
      if (slot.dataset.q !== q) return
      aside.removeAttribute('aria-busy')
      const modelo = modeloBonito(answer.model)
      const criterios = answer.criteria ?? []
      slot.innerHTML = html`<div class="answer-text" id="answer-text">${answer.text ? citasHtml(answer.text, criterios) : html`<p>Sin respuesta.</p>`}</div>
        <button class="answer-more" type="button" aria-expanded="false" aria-controls="answer-text" hidden>Leer la respuesta completa</button>
        ${answer.sources.length ? html`<p class="answer-sources"><span class="label">Fuentes</span> ${answer.sources.map(a => html`<a href="${ruta(a.law.code, a.number)}" title="${DOCS[a.law.code]?.nombre ?? a.law.code}">${etiqueta(a.key)}</a>`)}</p>` : ''}
        ${criterios.length ? html`<div class="answer-crit"><p class="label">Criterios del SAT citados</p><ul>${criterios.map(c => html`<li id="sat-${c.number}" tabindex="-1"><span class="answer-crit-meta">${TIPO_CRITERIO[c.kind] ?? 'Criterio'}${c.id ? html` · <span class="crit-id">${c.id}</span>` : ''}</span><span class="answer-crit-title">${c.title}</span></li>`)}</ul></div>` : ''}
        <p class="answer-note">Respuesta generada con IA a partir de los artículos${tieneCriterios() ? ' y criterios' : ''} citados. Puede equivocarse: revisa las fuentes. <span class="answer-model">Modelo: ${modelo}${answer.cached ? ', respuesta guardada' : ''}.</span></p>`
      const texto = slot.querySelector('.answer-text')
      const mas = slot.querySelector('.answer-more')
      texto.classList.add('is-clamped')
      if (texto.scrollHeight > texto.clientHeight + 8) {
        mas.hidden = false
        mas.addEventListener('click', () => {
          const abierto = mas.getAttribute('aria-expanded') === 'true'
          mas.setAttribute('aria-expanded', String(!abierto))
          texto.classList.toggle('is-clamped', abierto)
          mas.textContent = abierto ? 'Leer la respuesta completa' : 'Mostrar menos'
        })
      } else texto.classList.remove('is-clamped')
      anunciar('Respuesta lista.')
    },
    e => {
      if (slot.dataset.q !== q) return
      delete slot.dataset.q
      aside.removeAttribute('aria-busy')
      slot.innerHTML = html`<p class="answer-error" role="status">${e.message}</p>`
    },
  )
}
