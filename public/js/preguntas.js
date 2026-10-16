import { badge, cargarFaqs, citasHtml, corto, cuenta, DOCS, docDeFaq, errorHtml, fechaLargaDe, gql, html, modeloBonito, nf, normal, ruta, SITIO, tieneCriterios, TIPO_CRITERIO, titular, titulo, ubicacionCorta } from './lib.js'

const UNA = `query Pregunta($s: ID!) {
  faq(slug: $s) {
    slug question answer model verified date
    sources { key number title law { code name } location }
    criteria { number id kind title text }
  }
}`

const cache = new Map()
const SIN_DOC = '—'
let vista = { texto: '', doc: '' }

/** The heading a question is filed under: its first cited document, or SAT criteria / other when it cites no article. */
const grupoDe = f => docDeFaq(f) || SIN_DOC
const nombreGrupo = g => (g === SIN_DOC ? (tieneCriterios() ? 'Solo criterios del SAT' : 'Otras') : corto(g))

/** Groups in the site's document order, the questions that cite no article last. */
function agrupar(faqs) {
  const grupos = new Map()
  for (const f of faqs) {
    const g = grupoDe(f)
    if (!grupos.has(g)) grupos.set(g, [])
    grupos.get(g).push(f)
  }
  const orden = [...Object.keys(DOCS), SIN_DOC]
  return [...grupos].sort(([a], [b]) => orden.indexOf(a) - orden.indexOf(b))
}

/** How a checked answer was checked, in this site's terms, for one answer or for several. */
const revision = (varias = false) =>
  tieneCriterios()
    ? `comparada${varias ? 's' : ''} por un segundo modelo (Claude Opus) con el criterio del SAT del que salió ${varias ? 'cada' : 'la'} pregunta, y marcada${varias ? 's' : ''} como correcta${varias ? 's' : ''}`
    : `comparada${varias ? 's' : ''} por un segundo modelo (Claude Opus) con una respuesta escrita a mano a partir de los artículos, y marcada${varias ? 's' : ''} como correcta${varias ? 's' : ''}`

export default {
  nombre: 'preguntas',
  async mount(main, ctx) {
    const slug = ctx.url.pathname.match(/^\/preguntas\/([^/]+)\/?$/)?.[1]
    return slug ? detalle(main, ctx, decodeURIComponent(slug)) : indice(main, ctx)
  },
}

async function indice(main, ctx) {
  titular('Preguntas frecuentes')
  if (!ctx.ssr)
    main.innerHTML = html`<header class="page-head"><h1 tabindex="-1">Preguntas frecuentes</h1></header>
      <div aria-hidden="true" class="faq-loading">${Array.from({ length: 8 }, () => html`<span class="sk"></span>`)}</div>`
  const faqs = (await cargarFaqs()).filter(f => f.verified)
  if (ctx.signal.aborted) return
  const revisadas = faqs.length
  const docs = agrupar(faqs).map(([g]) => g)
  main.innerHTML = html`<header class="page-head">
      <h1 tabindex="-1">Preguntas frecuentes</h1>
      <p class="deck">${
        faqs.length
          ? `${cuenta(faqs.length, 'pregunta')} respondidas con los artículos que las sustentan. ${
              revisadas === faqs.length ? 'Todas fueron' : revisadas ? `${nf.format(revisadas)} fueron` : 'Ninguna ha sido'
            } ${revision(revisadas !== 1)}${revisadas && revisadas < faqs.length ? '; las demás se generaron con Claude y no se han revisado' : ''}.`
          : 'Todavía no hay preguntas publicadas para este sitio.'
      }</p>
    </header>
    ${faqs.length
      ? html`<form class="faq-filters" role="search" aria-label="Filtrar preguntas">
          <label class="field"><span>Buscar en las preguntas</span><input type="search" name="texto" autocomplete="off" value="${vista.texto}"></label>
          ${docs.length > 1 ? html`<label class="field"><span>Documento</span><select name="doc"><option value="">Todos</option>${docs.map(g => html`<option value="${g}" ${vista.doc === g ? 'selected' : ''}>${nombreGrupo(g)}</option>`)}</select></label>` : ''}
        </form>
        <p class="exp-count small" data-slot="count" aria-live="polite"></p>
        <div data-slot="lista"></div>`
      : html`<p><a class="button" href="/">Ir al buscador</a></p>`}`
  if (!faqs.length) return
  const form = main.querySelector('.faq-filters')
  form.addEventListener('submit', e => e.preventDefault())
  form.addEventListener('input', () => {
    vista = { texto: form.texto.value, doc: form.doc?.value ?? '' }
    pintarIndice(main, faqs)
  })
  pintarIndice(main, faqs)
}

function pintarIndice(main, faqs) {
  const t = normal(vista.texto)
  const lista = faqs.filter(f => (!vista.doc || grupoDe(f) === vista.doc) && (!t || normal(f.question).includes(t)))
  main.querySelector('[data-slot=count]').textContent = lista.length === faqs.length ? cuenta(faqs.length, 'pregunta') : `${nf.format(lista.length)} de ${cuenta(faqs.length, 'pregunta')}`
  const grupos = agrupar(lista)
  main.querySelector('[data-slot=lista]').innerHTML = lista.length
    ? html`${grupos.length > 1 && !vista.doc && !t ? html`<nav class="faq-toc" aria-label="Documentos">${grupos.map(([g, fs]) => html`<a href="#faq-${g === SIN_DOC ? 'otras' : g}">${nombreGrupo(g)} <span class="count">${fs.length}</span></a>`)}</nav>` : ''}
      ${grupos.map(
        ([g, fs]) => html`<section class="faq-group" id="faq-${g === SIN_DOC ? 'otras' : g}" aria-labelledby="faq-${g === SIN_DOC ? 'otras' : g}-h">
          <h2 class="faq-group-h" id="faq-${g === SIN_DOC ? 'otras' : g}-h">${g === SIN_DOC ? nombreGrupo(g) : html`${badge(g)}<span class="faq-group-name">${DOCS[g]?.nombre ?? g}</span>`}<span class="count">${fs.length}</span></h2>
          <ul class="faq-list">${fs.map(f => html`<li><a href="/preguntas/${f.slug}"><span>${f.question}</span>${f.verified ? '' : html`<span class="tag tag--quiet">sin revisar</span>`}</a></li>`)}</ul>
        </section>`,
      )}`
    : html`<p class="muted">Ninguna pregunta coincide con esa búsqueda. <a href="/?q=${encodeURIComponent(vista.texto)}">Buscar «${vista.texto}» en los artículos</a>.</p>`
}

async function detalle(main, ctx, slug) {
  if (!ctx.ssr)
    main.innerHTML = html`<article class="faq" aria-busy="true"><header class="faq-head"><p class="kicker"><a href="/preguntas">Preguntas frecuentes</a></p><div aria-hidden="true"><span class="sk sk-l"></span><span class="sk sk-m"></span></div></header>
      <div class="faq-answer" aria-hidden="true">${Array.from({ length: 5 }, () => html`<span class="sk"></span>`)}</div></article>`
  let p = cache.get(slug)
  if (!p) {
    p = gql(UNA, { s: slug }, ctx.signal)
    cache.set(slug, p)
    p.catch(() => cache.delete(slug))
  }
  const otras = cargarFaqs()
  let f
  try {
    f = (await p).faq
  } catch (e) {
    if (ctx.signal.aborted) throw e
    titular('Pregunta')
    main.innerHTML = html`<section class="empty-page"><p class="kicker"><a href="/preguntas">Preguntas frecuentes</a></p><h1 tabindex="-1">No se pudo cargar la pregunta</h1>${errorHtml(e, 'Detalle')}<p><a class="button" href="${location.pathname}">Reintentar</a></p></section>`
    return
  }
  if (ctx.signal.aborted) return
  if (!f) {
    titular('Pregunta no encontrada')
    main.innerHTML = html`<section class="empty-page"><p class="kicker">Error 404</p><h1 tabindex="-1">Esta pregunta no existe</h1>
      <p class="deck">Puede que el enlace esté mal escrito o que la pregunta se haya retirado.</p>
      <p class="actions"><a class="button" href="/preguntas">Ver todas las preguntas</a><a class="button button--quiet" href="/">Ir al buscador</a></p></section>`
    return
  }
  titular(f.question)
  const quien = modeloBonito(f.model)
  const cuando = /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? fechaLargaDe(f.date) : f.date
  main.innerHTML = html`<article class="faq">
    <header class="faq-head">
      <p class="kicker"><a href="/preguntas">Preguntas frecuentes</a></p>
      <h1 tabindex="-1" class="${f.question.length > 70 ? 'is-largo' : ''}">${f.question}</h1>
      ${f.sources.length ? html`<p class="faq-docs">${[...new Set(f.sources.map(s => s.law.code))].map(badge)}</p>` : ''}
    </header>
    <div class="faq-grid">
      <div class="faq-main">
        <div class="faq-answer">${citasHtml(f.answer, f.criteria)}</div>
        <p class="faq-note${f.verified ? '' : ' faq-note--sin'}">${
          f.verified
            ? `Respuesta generada con ${quien} el ${cuando} y ${revision()}.`
            : `Generada con ${quien} el ${cuando}, sin revisar: confirma en los artículos citados.`
        } <span class="faq-aviso">${SITIO.site.disclaimer}</span></p>
        <p class="faq-actions"><a class="button button--quiet" href="/?q=${encodeURIComponent(f.question)}">Buscar esta pregunta en los artículos</a></p>
      </div>
      <aside class="faq-rail" aria-label="Fuentes de la respuesta">
        ${f.sources.length
          ? html`<section class="rail-sec" aria-labelledby="fuentes-h">
              <h2 class="label" id="fuentes-h">Artículos citados <span class="count">${f.sources.length}</span></h2>
              <ul class="reflist reflist--rel">${f.sources.map(
                s => html`<li><a href="${ruta(s.law.code, s.number)}"><span class="ref-top">${badge(s.law.code)}<span class="ref-key">${titulo(s.law.code, s.number)}</span></span><span class="ref-loc">${s.title ?? ubicacionCorta(s.location)}</span></a></li>`,
              )}</ul>
            </section>`
          : ''}
        ${f.criteria.length
          ? html`<section class="rail-sec" aria-labelledby="crit-faq-h">
              <h2 class="label" id="crit-faq-h">Criterios del SAT citados <span class="count">${f.criteria.length}</span></h2>
              <ul class="crit-list crit-list--rail">${f.criteria.map(
                c => html`<li id="sat-${c.number}" tabindex="-1"><details>
                  <summary><span class="answer-crit-meta">${TIPO_CRITERIO[c.kind] ?? 'Criterio'}${c.id ? html` · <span class="crit-id">${c.id}</span>` : ''}</span><span class="crit-title">${c.title}</span></summary>
                  <div class="crit-text">${c.text.split('\n').filter(Boolean).map(p => html`<p>${p}</p>`)}</div>
                </details></li>`,
              )}</ul>
            </section>`
          : ''}
        <div data-slot="otras"></div>
      </aside>
    </div>
  </article>`
  otras.then(fs => {
    const slot = main.querySelector('[data-slot=otras]')
    if (!slot || ctx.signal.aborted) return
    const g = grupoDe(f)
    const mismas = fs.filter(o => o.slug !== f.slug && grupoDe(o) === g).slice(0, 5)
    if (mismas.length)
      slot.outerHTML = html`<section class="rail-sec" aria-labelledby="otras-h">
        <h2 class="label" id="otras-h">Más preguntas${g === SIN_DOC ? '' : ` sobre ${corto(g)}`}</h2>
        <ul class="reflist reflist--faq">${mismas.map(o => html`<li><a href="/preguntas/${o.slug}"><span class="ref-q">${o.question}</span></a></li>`)}</ul>
        <p class="small rail-more"><a href="/preguntas${g === SIN_DOC ? '' : `#faq-${g}`}">Todas las preguntas</a></p>
      </section>`.s
  })
  const destino = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  if (destino) destino.scrollIntoView()
  return null
}

