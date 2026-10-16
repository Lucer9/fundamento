import { cuenta, deLa, DOCS, errorHtml, esAborto, esDoc, etiqueta, FAMILIAS, familia, fecha, fechaLargaDe, gql, html, nf, opcionesDocs, ruta, ubicacionCorta } from './lib.js'
import { cargarGrafo, montarRed } from './red.js'

const RESUMEN = `{ stats { articles citations chunks criteria } laws { code name kind regulates { code } source articleCount } }`
const DETALLE = `query Explorar($law: LawCode) {
  mostCited(first: 20, law: $law) { count article { key number title law { code } location } }
  amendments(law: $law) { date articles { key } }
}`

const cache = new Map()
const pedir = (q, v, signal) => {
  const k = q + JSON.stringify(v ?? {})
  if (!cache.has(k)) cache.set(k, gql(q, v, signal).catch(e => (cache.delete(k), Promise.reject(e))))
  return cache.get(k)
}

let red = null
let el = null
let todas = false

const leyDe = params => (esDoc(params.get('ley')) ? params.get('ley') : '')

export default {
  nombre: 'explorar',
  async mount(main, ctx) {
    el = main
    todas = false
    document.title = 'Explorar · fundamento'
    const ley = leyDe(ctx.params)
    main.innerHTML = html`<header class="page-head">
        <p class="kicker">Explorar</p>
        <h1 tabindex="-1">Quién cita a quién</h1>
        <p class="deck" data-slot="deck">&nbsp;</p>
      </header>
      <section class="volumes" aria-label="Documentos" data-slot="laws"><div class="sk sk-block"></div></section>
      <div class="filterbar">
        <label class="field field--inline"><span>Documento</span><select name="ley" data-slot="filtro"><option value="">Todos</option>${opcionesDocs(ley)}</select></label>
      </div>
      <div class="explore-grid">
        <section class="panel" aria-labelledby="mc-h">
          <h2 class="section-h" id="mc-h">Los más citados</h2>
          <p class="muted small">Cuántos artículos o reglas distintos remiten a cada uno.</p>
          <div data-slot="cited"></div>
        </section>
        <section class="panel" aria-labelledby="am-h">
          <h2 class="section-h" id="am-h">Reformas por fecha</h2>
          <p class="muted small">Artículos con una reforma anotada en cada edición del Diario Oficial.</p>
          <div data-slot="amend"></div>
        </section>
      </div>
      <section class="panel net" aria-labelledby="net-h">
        <div class="net-head">
          <h2 class="section-h" id="net-h">Red de citas</h2>
          <p class="muted small">Cada línea es una cita, del color del documento que cita: tinta para las leyes, azul para los reglamentos, guinda para la Miscelánea. Cada reglamento va junto a su ley.</p>
        </div>
        <div class="net-body" data-slot="net"></div>
      </section>
      <section class="panel" aria-labelledby="mx-h">
        <h2 class="section-h" id="mx-h">Citas entre documentos</h2>
        <p class="muted small">Cada fila es el documento que cita; cada columna, el citado. La diagonal son citas dentro del mismo documento.</p>
        <div data-slot="matriz"><div aria-hidden="true">${Array.from({ length: 5 }, () => html`<span class="sk"></span>`)}</div></div>
      </section>`
    main.querySelector('[data-slot=filtro]').addEventListener('change', e => {
      const v = e.target.value
      ctx.navigate(v ? `/explorar?ley=${v}` : '/explorar', { replace: true, scroll: false })
    })
    red = montarRed(main.querySelector('[data-slot=net]'), { navigate: ctx.navigate, ley })

    pedir(RESUMEN).then(
      ({ stats, laws }) => {
        if (ctx.signal.aborted) return
        main.querySelector('[data-slot=deck]').textContent = `${nf.format(stats.articles)} artículos y reglas en ${laws.length} documentos, ${nf.format(stats.citations)} citas entre ellos y ${nf.format(stats.criteria)} criterios del SAT que los interpretan.`
        main.querySelector('[data-slot=laws]').innerHTML = volumenesHtml(laws, stats)
      },
      e => {
        if (!esAborto(e)) main.querySelector('[data-slot=laws]').innerHTML = errorHtml(e, 'No se pudieron cargar los documentos')
      },
    )
    cargarGrafo().then(
      g => {
        if (!ctx.signal.aborted && main.isConnected) main.querySelector('[data-slot=matriz]').innerHTML = matrizHtml(g)
      },
      e => {
        if (!esAborto(e) && main.isConnected) main.querySelector('[data-slot=matriz]').innerHTML = errorHtml(e, 'No se pudieron cargar las citas')
      },
    )
    await this.update(ctx)
    return () => {
      red?.destroy()
      red = null
    }
  },

  async update(ctx) {
    const ley = leyDe(ctx.params)
    el.querySelector('[data-slot=filtro]').value = ley
    red?.setLey(ley)
    const cited = el.querySelector('[data-slot=cited]')
    const amend = el.querySelector('[data-slot=amend]')
    for (const s of [cited, amend]) s.setAttribute('aria-busy', 'true')
    cited.innerHTML = amend.innerHTML = html`<div aria-hidden="true">${Array.from({ length: 8 }, () => html`<span class="sk"></span>`)}</div>`
    let datos
    try {
      datos = await pedir(DETALLE, { law: ley || null })
    } catch (e) {
      if (esAborto(e) || ctx.signal.aborted) return
      cited.innerHTML = errorHtml(e, 'No se pudo cargar')
      amend.innerHTML = ''
      return
    }
    if (ctx.signal.aborted) return
    for (const s of [cited, amend]) s.removeAttribute('aria-busy')
    cited.innerHTML = citadosHtml(datos.mostCited)
    pintarReformas(amend, datos.amendments, ley)
  },
}

const EDITOR = url => (/sat\.gob\.mx/.test(url) ? 'SAT' : /diputados\.gob\.mx/.test(url) ? 'Cámara de Diputados' : 'fuente oficial')

/** The ten documents grouped by family: a proportional bar, then name, size and official PDF for each. */
function volumenesHtml(laws, stats) {
  const total = laws.reduce((s, l) => s + l.articleCount, 0)
  const grupos = FAMILIAS.map(f => ({ ...f, docs: laws.filter(l => familia(l.code) === f.id) })).filter(f => f.docs.length)
  const enOrden = grupos.flatMap(f => f.docs)
  return html`<ol class="volume-bar" aria-hidden="true">${enOrden.map(l => html`<li data-fam="${familia(l.code)}" style="flex-grow:${l.articleCount}"></li>`)}</ol>
    <div class="volume-groups">${grupos.map(
      f => html`<section class="volume-group" aria-labelledby="vg-${f.id}">
        <h2 class="volume-fam" id="vg-${f.id}"><i data-fam="${f.id}"></i>${f.nombre} <span class="count">${f.docs.length}</span></h2>
        <ul class="volume-list">${f.docs.map(
          l => html`<li>
            <a class="volume-link" href="/explorar?ley=${l.code}"><span class="volume-code">${l.code}</span><span class="volume-name">${l.name}</span></a>
            <span class="volume-n">${cuenta(l.articleCount, f.id === 'miscelanea' ? 'regla' : 'artículo')} <span class="muted">· ${((l.articleCount / total) * 100).toFixed(l.articleCount / total < 0.01 ? 1 : 0)}%</span>${l.regulates ? html` <span class="muted">· ${deLa(DOCS[l.regulates.code]?.corto ?? '')} ${DOCS[l.regulates.code]?.corto ?? l.regulates.code}</span>` : ''}</span>
            <a class="volume-pdf" href="${l.source}" target="_blank" rel="noopener" title="${`PDF oficial, ${EDITOR(l.source)}`}">PDF<span class="sr-only"> oficial de ${l.name}, ${EDITOR(l.source)} (abre en otra pestaña)</span></a>
          </li>`,
        )}</ul>
      </section>`,
    )}</div>
    <p class="muted small volume-foot">${nf.format(stats.chunks)} fragmentos indexados para la búsqueda.</p>`
}

/** Document-by-document citation counts as an accessible table, tinted on a log scale. */
function matrizHtml({ docs, aristas }) {
  const codigos = docs.map(d => d.code)
  const pos = new Map(codigos.map((c, i) => [c, i]))
  const m = codigos.map(() => codigos.map(() => 0))
  for (const [a, b] of aristas) m[pos.get(a.ley)][pos.get(b.ley)]++
  const max = Math.max(1, ...m.flat())
  const tono = v => (v ? Math.round(8 + (Math.log(v) / Math.log(max)) * 52) : 0)
  return html`<div class="table-wrap matrix-wrap"><table class="matrix">
    <caption class="sr-only">Citas entre documentos: filas, documento que cita; columnas, documento citado.</caption>
    <thead><tr><th scope="col"><span class="sr-only">Cita ↓, citado →</span></th>${codigos.map(c => html`<th scope="col"><abbr title="${DOCS[c]?.nombre ?? c}">${c}</abbr></th>`)}</tr></thead>
    <tbody>${codigos.map(
      (c, i) => html`<tr><th scope="row"><abbr title="${DOCS[c]?.nombre ?? c}">${c}</abbr></th>${m[i].map(
        (v, j) => html`<td class="${i === j ? 'diag' : ''}" style="${v ? `--t:${tono(v)}%` : ''}" title="${`${c} cita a ${codigos[j]}: ${nf.format(v)}`}">${v ? nf.format(v) : html`<span class="muted" aria-label="0">·</span>`}</td>`,
      )}</tr>`,
    )}</tbody>
  </table></div>`
}

function citadosHtml(lista) {
  if (!lista.length) return html`<p class="muted">Sin citas.</p>`
  const max = lista[0].count
  return html`<ol class="bars">${lista.map(
    ({ count, article: a }, i) => html`<li>
      <a href="${ruta(a.law.code, a.number)}">
        <span class="bar-rank">${i + 1}</span>
        <span class="bar-label"><span class="bar-key">${etiqueta(a.key)}</span><span class="bar-loc">${a.title ?? ubicacionCorta(a.location)}</span></span>
        <span class="bar-n">${count}</span>
        <span class="bar-track" aria-hidden="true"><span style="width:${((count / max) * 100).toFixed(1)}%"></span></span>
      </a>
    </li>`,
  )}</ol>`
}

function pintarReformas(slot, fechas, ley) {
  if (!fechas.length) {
    slot.innerHTML = html`<p class="muted">Sin reformas anotadas.</p>`
    return
  }
  const porAnio = new Map()
  for (const f of fechas) porAnio.set(f.date.slice(0, 4), (porAnio.get(f.date.slice(0, 4)) ?? 0) + f.articles.length)
  const anios = [...porAnio.keys()].map(Number)
  const desde = Math.min(...anios)
  const hasta = Math.max(...anios)
  const maxAnio = Math.max(...porAnio.values())
  const pico = [...porAnio].find(([, v]) => v === maxAnio)[0]
  const max = Math.max(...fechas.map(f => f.articles.length))
  const ver = todas ? fechas : fechas.slice(0, 18)
  const fila = f => {
    const leyes = {}
    for (const { key } of f.articles) leyes[key.split(':')[0]] = (leyes[key.split(':')[0]] ?? 0) + 1
    return html`<li>
      <time datetime="${f.date}" title="${fechaLargaDe(f.date)}">${fecha(f.date)}</time>
      <span class="bar-track" aria-hidden="true"><span style="width:${((f.articles.length / max) * 100).toFixed(1)}%"></span></span>
      <span class="bar-n">${f.articles.length}</span>
      ${ley ? '' : html`<span class="amend-laws">${Object.entries(leyes).map(([k, v]) => html`<span>${k} ${v}</span>`)}</span>`}
    </li>`
  }
  slot.innerHTML = html`<figure class="years">
      <div class="years-bars" role="img" aria-label="${`Artículos reformados por año, de ${desde} a ${hasta}; un artículo reformado dos veces en el año cuenta dos veces`}">${Array.from({ length: hasta - desde + 1 }, (_, i) => {
        const y = desde + i
        const v = porAnio.get(String(y)) ?? 0
        return html`<span title="${`${y}: ${cuenta(v, 'artículo')}`}" style="height:${v ? Math.max(4, (v / maxAnio) * 100).toFixed(1) : 0}%"></span>`
      })}</div>
      <figcaption class="years-axis"><span>${desde}</span><span>Máximo: ${cuenta(maxAnio, 'artículo reformado', 'artículos reformados')} en ${pico}</span><span>${hasta}</span></figcaption>
    </figure>
    <ol class="amend">${ver.map(fila)}</ol>
    ${fechas.length > 18 ? html`<button class="button button--quiet more-btn" type="button" aria-expanded="${todas}">${todas ? 'Mostrar menos' : `Mostrar las ${fechas.length} fechas`}</button>` : ''}`
  slot.querySelector('.more-btn')?.addEventListener('click', () => {
    todas = !todas
    pintarReformas(slot, fechas, ley)
    if (!todas) slot.closest('section').scrollIntoView({ block: 'start' })
  })
}
