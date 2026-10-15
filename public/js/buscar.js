import { anunciar, cuenta, EN_USO, errorHtml, esAborto, esc, extracto, gql, html, LEYES, niveles, numero, pct, raw, request, ruta, terminos, TIPO_CRITERIO } from './lib.js'

const MODOS = [
  { id: 'semantica', api: 'VECTOR', nombre: 'Semántica' },
  { id: 'hibrida', api: 'HYBRID', nombre: 'Híbrida' },
  { id: 'palabras', api: 'KEYWORD', nombre: 'Palabras' },
]

const EJEMPLOS = [
  '¿El deducible del seguro de gastos médicos es deducible?',
  '¿Cuándo debo expedir un CFDI?',
  '¿Qué tasa de IVA aplica a la exportación de servicios?',
  '¿Qué gastos médicos puedo deducir en mi declaración anual?',
  '¿Cuánto tiempo debo conservar mi contabilidad?',
  '¿Cuándo prescribe un crédito fiscal?',
]

const SEARCH = `query Buscar($q: String!, $mode: SearchMode, $law: LawCode) {
  search(query: $q, mode: $mode, law: $law, first: 10) {
    score passage
    article { key number law { code name } location repealed }
  }
}`
const ANSWER = `query Responder($q: String!) {
  answer(question: $q) { text model cached sources { key number law { code } } criteria { number id kind title } }
}`

const busquedas = new Map()
const respuestas = new Map()
let portada = null

const leer = params => ({
  q: (params.get('q') ?? '').trim(),
  modo: MODOS.find(m => m.id === params.get('modo')) ?? MODOS[0],
  ley: LEYES[params.get('ley')] ? params.get('ley') : '',
})

const enlace = ({ q, modo, ley }) => {
  const p = new URLSearchParams({ q })
  if (modo !== MODOS[0]) p.set('modo', modo.id)
  if (ley) p.set('ley', ley)
  return `/?${p}`
}

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
            <span class="sr-only">Ley</span>
            <select name="ley">
              <option value="">Todas</option>
              ${Object.keys(LEYES).map(k => html`<option value="${k}">${k}</option>`)}
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
      const to = enlace({ q, modo: MODOS.find(m => m.id === form.modo.value) ?? MODOS[0], ley: form.ley.value })
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
    document.title = s.q ? `${s.q} · fundamento` : 'fundamento · la ley fiscal, en tus palabras'
    if (!s.q) return inicio(ctx)
    return resultados(s, ctx)
  },
}

function inicio(ctx) {
  el.querySelector('[data-slot=top]').innerHTML = html`<header class="hero">
    <p class="kicker">LISR · LIVA · CFF <span aria-hidden="true">—</span> texto vigente</p>
    <h1 tabindex="-1">La ley fiscal, en tus palabras.</h1>
    <p class="deck">Busca en la Ley del ISR, la Ley del IVA y el Código Fiscal de la Federación. Cada resultado lleva al artículo vigente, con lo que cita y quién lo cita.</p>
  </header>`
  const below = el.querySelector('[data-slot=below]')
  below.innerHTML = html`<section class="examples" aria-labelledby="ej-h">
      <h2 class="label" id="ej-h">Prueba con</h2>
      <ul class="chips">${EJEMPLOS.map(q => html`<li><a class="chip" href="${enlace({ q, modo: MODOS[0], ley: '' })}">${q}</a></li>`)}</ul>
    </section>
    <section class="figures" aria-label="En cifras" data-slot="cifras"></section>`
  portada ??= Promise.all([gql('{ stats { articles citations } }'), fetch('/eval.json').then(r => (r.ok ? r.json() : null)).catch(() => null)]).catch(() => null)
  return portada.then(datos => {
    const slot = below.querySelector('[data-slot=cifras]')
    if (!datos || !slot) return
    const [{ stats }, ev] = datos
    const set = ev?.naturales ?? ev
    const prod = set?.metodos?.find(m => m.nombre === EN_USO)
    slot.innerHTML = html`<dl class="figures-row">
      <div><dt>artículos vigentes en tres leyes</dt><dd>${stats.articles.toLocaleString('es-MX')}</dd></div>
      <div><dt>citas entre artículos, cada una un enlace</dt><dd>${stats.citations.toLocaleString('es-MX')}</dd></div>
      ${prod ? html`<div><dt>de ${set.n} preguntas en lenguaje común, escritas a partir de criterios del SAT, traen entre sus 5 primeros resultados un artículo que el criterio cita. <a href="/como-funciona">Cómo se mide</a></dt><dd>${pct(prod.hit5, 0)}</dd></div>` : ''}
    </dl>`
  })
}

function resultados(s, ctx) {
  el.querySelector('[data-slot=top]').innerHTML = html`<h1 class="sr-only" tabindex="-1">Resultados para «${s.q}»</h1>`
  const below = el.querySelector('[data-slot=below]')
  if (!below.querySelector('.results-layout')) {
    below.innerHTML = html`<div class="results-layout">
      <aside class="answer" aria-labelledby="answer-h"><h2 class="label" id="answer-h">Respuesta breve</h2><div class="answer-body" data-slot="answer"></div></aside>
      <section class="results" aria-labelledby="results-h" data-slot="results"></section>
    </div>`
  }
  respuesta(s.q, below.querySelector('[data-slot=answer]'))

  const slot = below.querySelector('[data-slot=results]')
  const llave = `${s.modo.api}|${s.ley}|${s.q}`
  let p = busquedas.get(llave)
  if (!p) {
    p = request(SEARCH, { q: s.q, mode: s.modo.api, law: s.ley || null })
    busquedas.set(llave, p)
    p.catch(() => busquedas.delete(llave))
  }
  slot.setAttribute('aria-busy', 'true')
  slot.innerHTML = html`<div class="results-head"><h2 id="results-h" class="label">Artículos</h2></div>
    <ol class="hits" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<li class="hit hit--skeleton"><span class="sk sk-s"></span><span class="sk sk-m"></span><span class="sk"></span><span class="sk"></span><span class="sk sk-l"></span></li>`)}</ol>`
  return p.then(
    ({ data: { search }, extensions }) => {
      if (ctx.signal.aborted) return
      slot.removeAttribute('aria-busy')
      slot.innerHTML = listaHtml(search, s, extensions?.degraded)
      anunciar(search.length ? `${cuenta(search.length, 'artículo')} encontrados.` : 'Sin resultados.')
    },
    e => {
      if (esAborto(e) || ctx.signal.aborted) return
      slot.removeAttribute('aria-busy')
      slot.innerHTML = html`<div class="results-head"><h2 id="results-h" class="label">Artículos</h2></div>${errorHtml(e, 'No se pudo buscar')}`
    },
  )
}

function listaHtml(hits, s, degradada) {
  const stems = terminos(s.q)
  const filtro = [degradada ? 'por palabras' : s.modo.nombre.toLowerCase(), s.ley ? `solo ${s.ley}` : ''].filter(Boolean).join(', ')
  const head = html`${degradada ? html`<p class="degraded" role="status">Búsqueda por palabras: el modelo semántico no está disponible en este momento.</p>` : ''}<div class="results-head"><h2 id="results-h" class="label">Artículos</h2><p class="results-count">${cuenta(hits.length, 'resultado')} <span class="muted">· búsqueda ${filtro}</span></p></div>`
  if (!hits.length) return html`${head}<div class="empty"><p>No encontramos artículos para esa búsqueda.</p><p class="muted">Prueba con otras palabras o con una pregunta más corta.</p></div>`
  return html`${head}<ol class="hits">${hits.map((h, i) => {
    const a = h.article
    const ns = niveles(a.location)
    const ultimo = ns[ns.length - 1]
    const href = `${ruta(a.law.code, a.number)}?${new URLSearchParams({ q: s.q })}`
    return html`<li class="hit">
      <span class="hit-rank" aria-hidden="true">${i + 1}</span>
      <div class="hit-body">
        <p class="hit-meta"><abbr class="badge" title="${a.law.name}">${a.law.code}</abbr><span class="hit-law">${a.law.name}</span></p>
        <h3 class="hit-title"><a href="${href}" data-pasaje="${h.passage}">Artículo ${numero(a.number)}</a>${a.repealed ? html` <span class="tag">Derogado</span>` : ''}</h3>
        ${ns.length ? html`<p class="hit-loc">${ns.filter(n => n.label).map(n => n.label).join(' › ')}${ultimo?.name ? html`<span class="hit-loc-name"> · ${ultimo.name}</span>` : ''}</p>` : ''}
        <p class="hit-passage">${extracto(h.passage, stems)}</p>
      </div>
    </li>`
  })}</ol>`
}

function citasHtml(text, criterios) {
  const porNumero = new Map(criterios.map(c => [String(c.number), c]))
  const chip = r => {
    const ley = r.match(/^(LISR|LIVA|CFF)\s+(.+)$/)
    if (ley) return `<a class="cite" href="${ruta(ley[1], ley[2])}">${ley[1]}&nbsp;${esc(numero(ley[2]))}</a>`
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
      const modelo = answer.model.split('/').pop()
      const criterios = answer.criteria ?? []
      slot.innerHTML = html`<div class="answer-text" id="answer-text">${answer.text ? citasHtml(answer.text, criterios) : html`<p>Sin respuesta.</p>`}</div>
        <button class="answer-more" type="button" aria-expanded="false" aria-controls="answer-text" hidden>Leer la respuesta completa</button>
        ${answer.sources.length ? html`<p class="answer-sources"><span class="label">Fuentes</span> ${answer.sources.map(a => html`<a href="${ruta(a.law.code, a.number)}">${a.law.code} ${numero(a.number)}</a>`)}</p>` : ''}
        ${criterios.length ? html`<div class="answer-crit"><p class="label">Criterios del SAT citados</p><ul>${criterios.map(c => html`<li id="sat-${c.number}" tabindex="-1"><span class="answer-crit-meta">${TIPO_CRITERIO[c.kind] ?? 'Criterio'}${c.id ? html` · <span class="crit-id">${c.id}</span>` : ''}</span><span class="answer-crit-title">${c.title}</span></li>`)}</ul></div>` : ''}
        <p class="answer-note">Respuesta generada con IA a partir de los artículos y criterios citados. Puede equivocarse: revisa las fuentes. <span class="answer-model">Modelo: ${modelo}${answer.cached ? ', respuesta guardada' : ''}.</span></p>`
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
