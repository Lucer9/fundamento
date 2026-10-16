import { badge, coincidencias, corto, DOCS, editor, elLa, errorHtml, esc, etiqueta, familia, fecha, fechaLargaDe, gaceta, gql, html, marcar, multaHtml, numero, pesos, raw, ruta, SITIO, terminos, tieneCriterios, titulo, tituloPagina, TRAMOS, ubicacionCorta, ubicacionHtml, unidad } from './lib.js'

/** The article query; criteria only where the site has any, fines only where the API turns them into pesos. */
const consulta = () => `query Articulo($law: LawCode!, $n: String!) {
  article(law: $law, number: $n) {
    key number title location text repealed amendedOn amountsUpdatedOn
    law { code name kind source regulates { code name } }
    links { start end target { key number law { code } } }
    cites { key number title law { code } location }
    citedBy { key number title law { code } location }
    ${tieneCriterios() ? 'criteria { id kind title text }' : ''}
    fines { start end times }
  }
}`

const cache = new Map()

const FRACCION = /^((?:[IVXL]+\.\s+)+)(?=\S)/
const INCISO = /^([a-z]{1,2}\)|\d{1,2}\.)\s+(?=\S)/
const DEROGA = /^(\(?\s*se deroga\s*\.?\)?\.?|derogad[oa]\.?)$/i
const NOTA = /^(\d{2}-\d{2}-\d{4}\.\s*)?(cantidad(es)?\s+)?actualizad[oa]s?\s+(en el\s+)?DOF\s+\d{2}-\d{2}-\d{4}\.?$/i

export default {
  nombre: 'articulo',
  async mount(main, ctx) {
    const ley = ctx.match[1].toUpperCase()
    const n = decodeURIComponent(ctx.match[2])
    document.title = tituloPagina(`${etiqueta(`${ley}:${n}`)} · ${corto(ley)}`)
    main.innerHTML = html`<article class="art" aria-busy="true">
      <header class="art-head">
        <p class="kicker art-doc">${badge(ley)} <span>${DOCS[ley].nombre}</span></p>
        <h1 tabindex="-1">${titulo(ley, n)}</h1>
        <div aria-hidden="true" class="art-loading"><span class="sk sk-m"></span><span class="sk sk-s"></span></div>
      </header>
      <div class="lawtext" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(i => html`<p><span class="sk"></span><span class="sk"></span><span class="sk ${i % 2 ? 'sk-l' : 'sk-m'}"></span></p>`)}</div>
    </article>`
    const key = `${ley}:${n}`
    let p = cache.get(key)
    if (!p) {
      p = gql(consulta(), { law: ley, n }, ctx.signal)
      cache.set(key, p)
      p.catch(() => cache.delete(key))
    }
    let data
    try {
      data = await p
    } catch (e) {
      if (ctx.signal.aborted) throw e
      main.innerHTML = html`<section class="empty-page">
        <p class="kicker">${etiqueta(`${ley}:${n}`)}</p>
        <h1 tabindex="-1">No se pudo cargar ${unidad(ley) === 'Regla' ? 'la regla' : 'el artículo'}</h1>
        ${errorHtml(e, 'Detalle')}
        <p><a class="button" href="${location.pathname + location.search}">Reintentar</a></p>
      </section>`
      return
    }
    if (ctx.signal.aborted) return
    const a = data.article
    if (!a) {
      const regla = unidad(ley) === 'Regla'
      document.title = tituloPagina(`${regla ? 'Regla' : 'Artículo'} no encontrado`)
      main.innerHTML = html`<section class="empty-page">
        <p class="kicker">Error 404</p>
        <h1 tabindex="-1">${regla ? `La ${DOCS[ley].corto} no tiene una regla ${n}` : `${DOCS[ley].corto} no tiene un artículo ${numero(n)}`}</h1>
        <p class="deck">Revisa el número. Los artículos con letra o bis se escriben con guiones, como 29-A o 18-H-Bis${Object.values(DOCS).some(d => d.familia === 'reglas') ? '; las reglas, con puntos, como 2.7.1.21' : ''}.</p>
        <p class="actions"><a class="button" href="/">Ir al buscador</a><a class="button button--quiet" href="/explorar">Ver los más citados</a></p>
      </section>`
      return
    }
    document.title = tituloPagina(`${a.title ? `${etiqueta(a.key)}. ${a.title}` : etiqueta(a.key)} · ${corto(a.law.code)}`)
    const esRegla = familia(a.law.code) === 'reglas'
    const criterios = a.criteria ?? []
    const multas = a.fines ?? []
    const reglasCitan = a.citedBy.filter(r => familia(r.law.code) === 'reglas').length
    const citantes = !a.citedBy.length
      ? esRegla ? 'reglas' : 'artículos'
      : reglasCitan === a.citedBy.length ? (reglasCitan === 1 ? 'regla' : 'reglas') : reglasCitan ? 'artículos y reglas' : a.citedBy.length === 1 ? 'artículo' : 'artículos'
    const q = (ctx.params.get('q') ?? '').trim()
    const { cuerpo, primero } = texto(a, q, ctx.state)
    main.innerHTML = html`<article class="art${a.repealed ? ' art--derogado' : ''}">
      <header class="art-head">
        <p class="kicker art-doc">${badge(a.law.code)} <span>${a.law.name}</span></p>
        ${docLinea(a.law)}
        ${esRegla ? html`<p class="art-num">Regla ${a.number}</p><h1 class="art-h1--regla" tabindex="-1">${a.title ?? `Regla ${a.number}`}</h1>` : html`<h1 tabindex="-1">${titulo(a.law.code, a.number)}</h1>`}
        ${a.location.length ? html`<ol class="art-loc" aria-label="Ubicación en el documento">${ubicacionHtml(a.location)}</ol>` : ''}
        <dl class="art-facts">
          ${esRegla && !a.amendedOn.length ? '' : html`<div><dt>Reformas</dt><dd>${a.amendedOn.length ? html`<a href="#reformas">${a.amendedOn.length}</a><span class="fact-sub">última ${fecha(a.amendedOn[a.amendedOn.length - 1])}</span>` : html`0<span class="fact-sub">sin anotar</span>`}</dd></div>`}
          <div><dt>Lo citan</dt><dd>${a.citedBy.length ? html`<a href="#lo-citan">${a.citedBy.length}</a>` : '0'}<span class="fact-sub">${citantes}</span></dd></div>
          ${tieneCriterios() ? html`<div><dt>Criterios</dt><dd>${criterios.length ? html`<a href="#criterios">${criterios.length}</a>` : '0'}<span class="fact-sub">del SAT</span></dd></div>` : ''}
        </dl>
      </header>
      ${multas.length && SITIO.site.uma ? umaNota(multas) : ''}
      ${a.repealed ? html`<p class="derogado-note"><span class="tag tag--solid">Derogado</span> ${esRegla ? 'Esta regla ya no está vigente.' : 'Este artículo ya no está vigente. La ley conserva su número.'}</p>` : ''}
      ${q && primero >= 0 ? html`<p class="highlight-note"><span>Resaltado: <strong>«${q}»</strong></span><a href="${location.pathname}">Quitar</a></p>` : ''}
      <div class="art-grid">
        <div class="art-main">
          <div class="lawtext">${cuerpo}</div>
          ${tieneCriterios() ? criteriosHtml(criterios, esRegla) : ''}
        </div>
        <aside class="art-rail" aria-label="Relaciones del artículo">
          ${listaHtml(esRegla ? 'Esta regla cita' : 'Este artículo cita', 'cita', a.cites, a.law.code, 'No cita otros textos de este índice.')}
          ${listaHtml(`Lo citan`, 'lo-citan', a.citedBy, a.law.code, esRegla ? 'Ningún texto del índice cita esta regla.' : 'Ningún texto del índice lo cita.')}
          ${esRegla && !a.amendedOn.length && !(a.amountsUpdatedOn ?? []).length ? '' : reformasHtml(a.amendedOn, a.amountsUpdatedOn ?? [], a.law.code)}
        </aside>
      </div>
    </article>`
    const hit = main.querySelector('.lawtext .is-hit')
    if (hit && ctx.state.pasaje) {
      requestAnimationFrame(() => hit.scrollIntoView({ block: 'center' }))
    } else if (ctx.state.pasaje) window.scrollTo(0, 0)
  },
}

const NOMBRES_TRAMO = { min: 'mínima', med: 'media', max: 'máxima' }

/** The UMA line over an article with fines, keyed with only the tiers its fines use (none when every fine is a single amount). */
function umaNota(multas) {
  const { uma } = SITIO.site
  const usados = new Set(multas.flatMap(f => TRAMOS[f.times.length] ?? []))
  const clave = ['min', 'med', 'max'].filter(t => usados.has(t))
  return html`<p class="uma-note">Multas en pesos de ${uma.since.slice(0, 4)}: cada UMA vale ${pesos(uma.value)} desde el ${fechaLargaDe(uma.since)}.${
    clave.length ? html` <span class="uma-key" aria-hidden="true">${clave.map(t => html`<span class="multa-m" data-t="${t}">${NOMBRES_TRAMO[t]}</span>`)}</span>` : ''
  }</p>`
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
  const multas = (a.fines ?? []).map(f => ({ fin: f.end, html: multaHtml(f.times) })).filter(m => m.html)

  const tramo = (s, e, resaltar) => {
    let out = ''
    let i = s
    const plano = (x, y) => {
      if (x >= y) return ''
      const t = text.slice(x, y)
      const extras = multas.filter(m => m.fin > x && m.fin <= y).map(m => ({ at: m.fin - x, html: m.html }))
      if (!resaltar && !extras.length) return esc(t)
      return marcar(t, resaltar ? coincidencias(t, stems) : [], extras).s
    }
    for (const l of enlaces) {
      if (l.end <= s || l.start >= e) continue
      out += plano(i, l.start)
      const t = l.target
      const ext = t.law.code !== a.law.code
      out += `<a class="ref${ext ? ' ref--ext' : ''}" href="${ruta(t.law.code, t.number)}" title="${esc(`${DOCS[t.law.code]?.nombre ?? t.law.code}, ${titulo(t.law.code, t.number).toLowerCase()}`)}"${ext ? ` data-ley="${t.law.code}"` : ''}>${esc(text.slice(l.start, l.end))}</a>`
      i = l.end
    }
    return out + plano(i, e)
  }

  let pos = 0
  let primero = -1
  const rangos = []
  for (const linea of text.split('\n')) {
    const r = { s: pos, e: pos + linea.length }
    pos = r.e + 1
    const prev = rangos[rangos.length - 1]
    const t = linea.trim()
    if (prev && /^[a-záéíóúñü]/.test(t) && !INCISO.test(t) && !/[.:;)]$/.test(text.slice(prev.s, prev.e).trim())) prev.e = r.e
    else rangos.push(r)
  }
  const pars = rangos.map(({ s, e }, idx) => {
    const par = text.slice(s, e)
    if (!par.trim()) return ''
    if (NOTA.test(par.trim())) return `<p class="is-nota"><span>${esc(par.trim())}</span></p>`
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

/** One quiet line under the document name: the law a reglamento carries out, and the official PDF. */
function docLinea(law) {
  const quien = law.source ? editor(law.source).corto : ''
  const partes = [
    law.regulates && html`Reglamenta ${elLa(law.regulates.name)} <a href="/explorar?ley=${law.regulates.code}">${law.regulates.name}</a>`,
    law.source && html`<a class="ext" href="${law.source}" target="_blank" rel="noopener">Texto oficial en PDF${quien ? `, ${quien}` : ''}<span class="sr-only"> (abre en otra pestaña)</span></a>`,
  ].filter(Boolean)
  return partes.length ? html`<p class="art-docline">${partes.map(p => html`<span>${p}</span>`)}</p>` : ''
}

const orden = Object.keys(DOCS)

const numerico = (x, y) => x.number.localeCompare(y.number, 'es', { numeric: true })

/** References grouped by document: the article's own document first, then the rest in index order. */
function listaHtml(encabezado, id, lista, ley, vacio) {
  const grupos = new Map()
  for (const r of [...lista].sort(numerico)) (grupos.get(r.law.code) ?? grupos.set(r.law.code, []).get(r.law.code)).push(r)
  const docs = [...grupos.keys()].sort((x, y) => (x === ley ? -1 : y === ley ? 1 : orden.indexOf(x) - orden.indexOf(y)))
  const item = r => html`<li><a href="${ruta(r.law.code, r.number)}"><span class="ref-key">${etiqueta(r.key)}</span><span class="ref-loc">${r.title ?? ubicacionCorta(r.location)}</span></a></li>`
  const varios = docs.length > 1
  const grupo = c => {
    const xs = grupos.get(c)
    const n = varios ? 4 : 8
    return html`${varios ? html`<h3 class="ref-group">${corto(c)} <span class="count">${xs.length}</span></h3>` : ''}<ul class="reflist">${xs.slice(0, n).map(item)}</ul>${xs.length > n + 1 ? html`<details class="more"><summary>Ver ${xs.length - n} más${varios ? ` de ${corto(c)}` : ''}</summary><ul class="reflist">${xs.slice(n).map(item)}</ul></details>` : xs.length === n + 1 ? html`<ul class="reflist">${item(xs[n])}</ul>` : ''}`
  }
  return html`<section class="rail-sec" id="${id}" aria-labelledby="${id}-h">
    <h2 class="label" id="${id}-h">${encabezado}${lista.length ? html` <span class="count">${lista.length}</span>` : ''}</h2>
    ${lista.length ? docs.map(grupo) : html`<p class="muted small">${vacio}</p>`}
  </section>`
}

function reformasHtml(fechas, montos, ley) {
  const fila = f => html`<li><time datetime="${f}" title="${fechaLargaDe(f)}">${fecha(f)}</time></li>`
  const lista = (xs, n = 6) =>
    xs.length <= n + 2
      ? html`<ol class="dates">${xs.map(fila)}</ol>`
      : html`<ol class="dates">${xs.slice(0, n).map(fila)}</ol>${xs.length > n ? html`<details class="more"><summary>Ver ${xs.length - n} más</summary><ol class="dates">${xs.slice(n).map(fila)}</ol></details>` : ''}`
  const cantidades = montos.length
    ? html`<div class="amounts">
        <h3 class="amounts-h">Cantidades actualizadas por la RMF <span class="count">${montos.length}</span></h3>
        ${lista([...montos].reverse(), 4)}
        <p class="muted small">Actualizaciones por inflación de montos en pesos. No son reformas.</p>
      </div>`
    : ''
  if (!fechas.length)
    return html`<section class="rail-sec" id="reformas" aria-labelledby="ref-h"><h2 class="label" id="ref-h">Reformas</h2><p class="muted small">El texto no anota reformas.</p>${cantidades}</section>`
  const t = fechas.map(f => Date.parse(f))
  const min = Math.min(...t)
  const max = Math.max(...t)
  const x = f => (max === min ? 50 : ((Date.parse(f) - min) / (max - min)) * 100)
  return html`<section class="rail-sec" id="reformas" aria-labelledby="ref-h">
    <h2 class="label" id="ref-h">Reformas <span class="count">${fechas.length}</span></h2>
    <div class="strip" aria-hidden="true">
      <div class="strip-line">${fechas.map(f => html`<i style="left:${x(f).toFixed(2)}%"></i>`)}</div>
      <div class="strip-ends"><span>${fechas[0].slice(0, 4)}</span><span>${fechas[fechas.length - 1].slice(0, 4)}</span></div>
    </div>
    ${lista([...fechas].reverse())}
    <p class="muted small">Fechas ${gaceta(ley) === 'Gaceta Oficial' ? 'de la Gaceta Oficial' : 'del Diario Oficial'} anotadas en el texto.</p>
    ${cantidades}
  </section>`
}

function criteriosHtml(criterios, esRegla) {
  const grupos = [
    { kind: 'NORMATIVE', titulo: `Cómo ${esRegla ? 'la' : 'lo'} interpreta el SAT`, nota: 'Criterios normativos, Anexo 7 de la RMF 2026.' },
    { kind: 'IMPROPER_PRACTICE', titulo: 'Prácticas que el SAT considera indebidas', nota: 'Prácticas fiscales indebidas, Anexo 3 de la RMF 2026.' },
  ]
    .map(g => ({ ...g, items: criterios.filter(c => c.kind === g.kind) }))
    .filter(g => g.items.length)
  if (!grupos.length) return html`<section class="crit" id="criterios"><h2 class="label">Criterios del SAT</h2><p class="muted small">Ningún criterio del SAT cita ${esRegla ? 'esta regla' : 'este artículo'}.</p></section>`
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
