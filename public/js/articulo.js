import { coincidencias, errorHtml, esc, fecha, fechaLargaDe, gql, html, LEYES, marcar, numero, raw, ruta, terminos, ubicacionCorta, ubicacionHtml } from './lib.js'

const QUERY = `query Articulo($law: LawCode!, $n: String!) {
  article(law: $law, number: $n) {
    key number law { code name } location text repealed amendedOn
    links { start end target { key number law { code } } }
    cites { key number law { code } location }
    citedBy { key number law { code } location }
    criteria { id kind title text }
  }
}`

const cache = new Map()

const FRACCION = /^((?:[IVXL]+\.\s+)+)(?=\S)/
const INCISO = /^([a-z]{1,2}\)|\d{1,2}\.)\s+(?=\S)/
const DEROGA = /^(\(?\s*se deroga\s*\.?\)?\.?|derogad[oa]\.?)$/i

export default {
  nombre: 'articulo',
  async mount(main, ctx) {
    const ley = ctx.match[1].toUpperCase()
    const n = decodeURIComponent(ctx.match[2])
    document.title = `${ley} ${numero(n)} · fundamento`
    main.innerHTML = html`<article class="art" aria-busy="true">
      <header class="art-head">
        <p class="kicker">${ley} · ${LEYES[ley]}</p>
        <h1 tabindex="-1">Artículo ${numero(n)}</h1>
        <div aria-hidden="true" class="art-loading"><span class="sk sk-m"></span><span class="sk sk-s"></span></div>
      </header>
      <div class="lawtext" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(i => html`<p><span class="sk"></span><span class="sk"></span><span class="sk ${i % 2 ? 'sk-l' : 'sk-m'}"></span></p>`)}</div>
    </article>`
    const key = `${ley}:${n}`
    let p = cache.get(key)
    if (!p) {
      p = gql(QUERY, { law: ley, n }, ctx.signal)
      cache.set(key, p)
      p.catch(() => cache.delete(key))
    }
    let data
    try {
      data = await p
    } catch (e) {
      if (ctx.signal.aborted) throw e
      main.innerHTML = html`<section class="empty-page">
        <p class="kicker">${ley} ${numero(n)}</p>
        <h1 tabindex="-1">No se pudo cargar el artículo</h1>
        ${errorHtml(e, 'Detalle')}
        <p><a class="button" href="${location.pathname + location.search}">Reintentar</a></p>
      </section>`
      return
    }
    if (ctx.signal.aborted) return
    const a = data.article
    if (!a) {
      document.title = `Artículo no encontrado · fundamento`
      main.innerHTML = html`<section class="empty-page">
        <p class="kicker">Error 404</p>
        <h1 tabindex="-1">${ley} no tiene un artículo ${numero(n)}</h1>
        <p class="deck">Revisa el número. Los artículos con letra o bis se escriben con guiones, como <a href="/CFF/29-A">CFF 29-A</a> o <a href="/LIVA/18-H-Bis">LIVA 18-H Bis</a>.</p>
        <p class="actions"><a class="button" href="/">Ir al buscador</a><a class="button button--quiet" href="/explorar">Ver los más citados</a></p>
      </section>`
      return
    }
    document.title = `${a.law.code} ${numero(a.number)} · ${a.law.name} · fundamento`
    const q = (ctx.params.get('q') ?? '').trim()
    const { cuerpo, primero } = texto(a, q, ctx.state)
    main.innerHTML = html`<article class="art${a.repealed ? ' art--derogado' : ''}">
      <header class="art-head">
        <p class="kicker"><abbr class="badge" title="${a.law.name}">${a.law.code}</abbr> ${a.law.name}</p>
        <h1 tabindex="-1">Artículo ${numero(a.number)}</h1>
        ${a.location.length ? html`<ol class="art-loc" aria-label="Ubicación en la ley">${ubicacionHtml(a.location)}</ol>` : ''}
        <dl class="art-facts">
          <div><dt>Reformas</dt><dd>${a.amendedOn.length ? html`<a href="#reformas">${a.amendedOn.length}</a><span class="fact-sub">última ${fecha(a.amendedOn[a.amendedOn.length - 1])}</span>` : html`0<span class="fact-sub">sin anotar</span>`}</dd></div>
          <div><dt>Lo citan</dt><dd>${a.citedBy.length ? html`<a href="#lo-citan">${a.citedBy.length}</a>` : '0'}<span class="fact-sub">${a.citedBy.length === 1 ? 'artículo' : 'artículos'}</span></dd></div>
          <div><dt>Criterios</dt><dd>${a.criteria.length ? html`<a href="#criterios">${a.criteria.length}</a>` : '0'}<span class="fact-sub">del SAT</span></dd></div>
        </dl>
      </header>
      ${a.repealed ? html`<p class="derogado-note"><span class="tag tag--solid">Derogado</span> Este artículo ya no está vigente. La ley conserva su número.</p>` : ''}
      ${q && primero >= 0 ? html`<p class="highlight-note"><span>Resaltado: <strong>«${q}»</strong></span><a href="${location.pathname}">Quitar</a></p>` : ''}
      <div class="art-grid">
        <div class="art-main">
          <div class="lawtext">${cuerpo}</div>
          ${criteriosHtml(a.criteria)}
        </div>
        <aside class="art-rail" aria-label="Relaciones del artículo">
          ${listaHtml('Este artículo cita', 'cita', a.cites, a.law.code, 'No cita otros artículos de estas leyes.')}
          ${listaHtml(`Lo citan`, 'lo-citan', a.citedBy, a.law.code, 'Ningún artículo lo cita.')}
          ${reformasHtml(a.amendedOn)}
        </aside>
      </div>
    </article>`
    const hit = main.querySelector('.lawtext .is-hit')
    if (hit && ctx.state.pasaje) {
      requestAnimationFrame(() => hit.scrollIntoView({ block: 'center' }))
    } else if (ctx.state.pasaje) window.scrollTo(0, 0)
  },
}

function rango(text, q, state) {
  const stems = terminos(q)
  if (state.pasaje) {
    const inicio = text.indexOf(state.pasaje.slice(0, 80))
    if (inicio >= 0) return { stems, desde: inicio, hasta: inicio + state.pasaje.length }
  }
  if (!stems.length) return { stems, desde: -1, hasta: -1 }
  let best = { n: 0, desde: -1, hasta: -1 }
  let pos = 0
  for (const par of text.split('\n')) {
    const vistos = new Set(coincidencias(par, stems).map(([s, e]) => par.slice(s, e).toLowerCase().slice(0, 5)))
    if (vistos.size > best.n) best = { n: vistos.size, desde: pos, hasta: pos + par.length }
    pos += par.length + 1
  }
  return { stems, ...best }
}

function texto(a, q, state) {
  const { text, links } = a
  const { stems, desde, hasta } = q ? rango(text, q, state) : { stems: [], desde: -1, hasta: -1 }
  const enlaces = [...links].sort((x, y) => x.start - y.start)

  const tramo = (s, e, resaltar) => {
    let out = ''
    let i = s
    const plano = (x, y) => {
      if (x >= y) return ''
      if (!resaltar) return esc(text.slice(x, y))
      const t = text.slice(x, y)
      return marcar(t, coincidencias(t, stems)).s
    }
    for (const l of enlaces) {
      if (l.end <= s || l.start >= e) continue
      out += plano(i, l.start)
      const t = l.target
      const ext = t.law.code !== a.law.code
      out += `<a class="ref${ext ? ' ref--ext' : ''}" href="${ruta(t.law.code, t.number)}" title="${esc(`${t.law.code} ${numero(t.number)}`)}"${ext ? ` data-ley="${t.law.code}"` : ''}>${esc(text.slice(l.start, l.end))}</a>`
      i = l.end
    }
    return out + plano(i, e)
  }

  let pos = 0
  let primero = -1
  const pars = text.split('\n').map((par, idx) => {
    const s = pos
    const e = pos + par.length
    pos = e + 1
    if (!par.trim()) return ''
    const resaltar = desde >= 0 && e > desde && s < hasta
    if (resaltar && primero < 0) primero = idx
    const clases = [resaltar ? 'is-hit' : '', DEROGA.test(par.replace(/^([IVXL]+\.|[a-z]{1,2}\))\s*/, '').trim()) ? 'is-derogado' : '']
    const f = par.match(FRACCION)
    if (f) {
      const nums = f[1].trim().split(/\s+/)
      return `<p class="${['fr', ...clases].join(' ').trim()}"><span class="num">${nums.map(x => `<span>${esc(x)}</span>`).join('')}</span>${tramo(s + f[0].length, e, resaltar)}</p>`
    }
    const i = par.match(INCISO)
    if (i) return `<p class="${['inc', ...clases].join(' ').trim()}"><span class="num">${esc(i[1])}</span>${tramo(s + i[0].length, e, resaltar)}</p>`
    return `<p${clases.join('').trim() ? ` class="${clases.join(' ').trim()}"` : ''}>${tramo(s, e, resaltar)}</p>`
  })
  return { cuerpo: raw(pars.join('')), primero }
}

const ordenar = (lista, ley) =>
  [...lista].sort((x, y) => (x.law.code === ley ? 0 : 1) - (y.law.code === ley ? 0 : 1) || x.law.code.localeCompare(y.law.code) || x.number.localeCompare(y.number, 'es', { numeric: true }))

function listaHtml(titulo, id, lista, ley, vacio) {
  const items = ordenar(lista, ley)
  const item = r => html`<li><a href="${ruta(r.law.code, r.number)}"><span class="ref-key">${r.law.code} ${numero(r.number)}</span><span class="ref-loc">${ubicacionCorta(r.location)}</span></a></li>`
  return html`<section class="rail-sec" id="${id}" aria-labelledby="${id}-h">
    <h2 class="label" id="${id}-h">${titulo}${lista.length ? html` <span class="count">${lista.length}</span>` : ''}</h2>
    ${items.length
      ? html`<ul class="reflist">${items.slice(0, 8).map(item)}</ul>${items.length > 8 ? html`<details class="more"><summary>Ver ${items.length - 8} más</summary><ul class="reflist">${items.slice(8).map(item)}</ul></details>` : ''}`
      : html`<p class="muted small">${vacio}</p>`}
  </section>`
}

function reformasHtml(fechas) {
  if (!fechas.length) return html`<section class="rail-sec" id="reformas" aria-labelledby="ref-h"><h2 class="label" id="ref-h">Reformas</h2><p class="muted small">El texto no anota reformas.</p></section>`
  const t = fechas.map(f => Date.parse(f))
  const min = Math.min(...t)
  const max = Math.max(...t)
  const x = f => (max === min ? 50 : ((Date.parse(f) - min) / (max - min)) * 100)
  const lista = [...fechas].reverse()
  return html`<section class="rail-sec" id="reformas" aria-labelledby="ref-h">
    <h2 class="label" id="ref-h">Reformas <span class="count">${fechas.length}</span></h2>
    <div class="strip" aria-hidden="true">
      <div class="strip-line">${fechas.map(f => html`<i style="left:${x(f).toFixed(2)}%"></i>`)}</div>
      <div class="strip-ends"><span>${fechas[0].slice(0, 4)}</span><span>${fechas[fechas.length - 1].slice(0, 4)}</span></div>
    </div>
    <ol class="dates">${lista.slice(0, 6).map(f => html`<li><time datetime="${f}" title="${fechaLargaDe(f)}">${fecha(f)}</time></li>`)}</ol>
    ${lista.length > 6 ? html`<details class="more"><summary>Ver ${lista.length - 6} más</summary><ol class="dates">${lista.slice(6).map(f => html`<li><time datetime="${f}" title="${fechaLargaDe(f)}">${fecha(f)}</time></li>`)}</ol></details>` : ''}
    <p class="muted small">Fechas del Diario Oficial anotadas en el texto.</p>
  </section>`
}

function criteriosHtml(criterios) {
  const grupos = [
    { kind: 'NORMATIVE', titulo: 'Cómo lo interpreta el SAT', nota: 'Criterios normativos, Anexo 7 de la RMF 2026.' },
    { kind: 'IMPROPER_PRACTICE', titulo: 'Prácticas que el SAT considera indebidas', nota: 'Prácticas fiscales indebidas, Anexo 3 de la RMF 2026.' },
  ]
    .map(g => ({ ...g, items: criterios.filter(c => c.kind === g.kind) }))
    .filter(g => g.items.length)
  if (!grupos.length) return html`<section class="crit" id="criterios"><h2 class="label">Criterios del SAT</h2><p class="muted small">Ningún criterio del SAT cita este artículo.</p></section>`
  return html`<div id="criterios">${grupos.map(
    (g, gi) => html`<section class="crit" aria-labelledby="crit-${gi}">
      <h2 class="crit-h" id="crit-${gi}">${g.titulo} <span class="count">${g.items.length}</span></h2>
      <p class="muted small">${g.nota}</p>
      <ul class="crit-list">${g.items.map(
        c => html`<li><details>
          <summary><span class="crit-title">${c.title}</span>${c.id ? html`<span class="crit-id">${c.id}</span>` : ''}</summary>
          <div class="crit-text">${c.text.split('\n').filter(Boolean).map(p => html`<p>${p}</p>`)}</div>
        </details></li>`,
      )}</ul>
    </section>`,
  )}</div>`
}
