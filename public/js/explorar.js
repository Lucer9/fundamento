import { cuenta, errorHtml, esAborto, fecha, fechaLargaDe, gql, html, LEYES, nf, numero, ruta, ubicacionCorta } from './lib.js'
import { montarRed } from './red.js'

const RESUMEN = `{ stats { articles citations chunks criteria } laws { code name articleCount } }`
const DETALLE = `query Explorar($law: LawCode) {
  mostCited(first: 20, law: $law) { count article { key number law { code } location } }
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

export default {
  nombre: 'explorar',
  async mount(main, ctx) {
    el = main
    todas = false
    document.title = 'Explorar · fundamento'
    const ley = LEYES[ctx.params.get('ley')] ? ctx.params.get('ley') : ''
    main.innerHTML = html`<header class="page-head">
        <p class="kicker">Explorar</p>
        <h1 tabindex="-1">Tres leyes, citadas entre sí</h1>
        <p class="deck" data-slot="deck">&nbsp;</p>
      </header>
      <section class="volumes" aria-label="Leyes" data-slot="laws"><div class="sk sk-block"></div></section>
      <div class="filterbar">
        <fieldset class="seg" data-slot="filtro">
          <legend class="filter-legend">Ley</legend>
          ${[['', 'Todas'], ...Object.keys(LEYES).map(k => [k, k])].map(([v, t]) => html`<label><input type="radio" name="ley" value="${v}" ${v === ley ? 'checked' : ''}><span>${t}</span></label>`)}
        </fieldset>
      </div>
      <div class="explore-grid">
        <section class="panel" aria-labelledby="mc-h">
          <h2 class="section-h" id="mc-h">Los más citados</h2>
          <p class="muted small">Cuántos artículos distintos remiten a cada uno.</p>
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
          <p class="muted small">Las líneas grises unen artículos de la misma ley; las de color cruzan de una ley a otra.</p>
        </div>
        <div data-slot="net"></div>
      </section>`
    main.querySelector('[data-slot=filtro]').addEventListener('change', e => {
      const v = e.target.value
      ctx.navigate(v ? `/explorar?ley=${v}` : '/explorar', { replace: true, scroll: false })
    })
    red = montarRed(main.querySelector('[data-slot=net]'), { navigate: ctx.navigate, ley })

    pedir(RESUMEN).then(
      ({ stats, laws }) => {
        if (ctx.signal.aborted) return
        const total = laws.reduce((s, l) => s + l.articleCount, 0)
        main.querySelector('[data-slot=deck]').textContent = `${nf.format(stats.articles)} artículos, ${nf.format(stats.citations)} citas entre ellos y ${nf.format(stats.criteria)} criterios del SAT que los interpretan.`
        main.querySelector('[data-slot=laws]').innerHTML = html`<ol class="volume-bar" aria-hidden="true">${laws.map(l => html`<li style="flex-grow:${l.articleCount}"></li>`)}</ol>
          <ul class="volume-list">${laws.map(
            l => html`<li><span class="volume-code">${l.code}</span><span class="volume-name">${l.name}</span><span class="volume-n">${cuenta(l.articleCount, 'artículo')} <span class="muted">· ${Math.round((l.articleCount / total) * 100)}%</span></span></li>`,
          )}</ul>
          <p class="muted small volume-foot">${nf.format(stats.chunks)} fragmentos indexados para la búsqueda.</p>`
      },
      e => {
        if (!esAborto(e)) main.querySelector('[data-slot=laws]').innerHTML = errorHtml(e, 'No se pudieron cargar las leyes')
      },
    )
    await this.update(ctx)
    return () => {
      red?.destroy()
      red = null
    }
  },

  async update(ctx) {
    const ley = LEYES[ctx.params.get('ley')] ? ctx.params.get('ley') : ''
    const filtro = el.querySelector('[data-slot=filtro]')
    filtro.querySelector(`input[value="${ley}"]`).checked = true
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

function citadosHtml(lista) {
  if (!lista.length) return html`<p class="muted">Sin citas.</p>`
  const max = lista[0].count
  return html`<ol class="bars">${lista.map(
    ({ count, article: a }, i) => html`<li>
      <a href="${ruta(a.law.code, a.number)}">
        <span class="bar-rank">${i + 1}</span>
        <span class="bar-label"><span class="bar-key">${a.law.code} ${numero(a.number)}</span><span class="bar-loc">${ubicacionCorta(a.location)}</span></span>
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
  const max = Math.max(...fechas.map(f => f.articles.length))
  const ver = todas ? fechas : fechas.slice(0, 12)
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
      <div class="years-bars" role="img" aria-label="${`Artículos reformados por año, de ${desde} a ${hasta}`}">${Array.from({ length: hasta - desde + 1 }, (_, i) => {
        const y = desde + i
        const v = porAnio.get(String(y)) ?? 0
        return html`<span title="${`${y}: ${cuenta(v, 'artículo')}`}" style="height:${v ? Math.max(4, (v / maxAnio) * 100).toFixed(1) : 0}%"></span>`
      })}</div>
      <figcaption class="years-axis"><span>${desde}</span><span>${hasta}</span></figcaption>
    </figure>
    <ol class="amend">${ver.map(fila)}</ol>
    ${fechas.length > 12 ? html`<button class="button button--quiet more-btn" type="button" aria-expanded="${todas}">${todas ? 'Mostrar menos' : `Mostrar las ${fechas.length} fechas`}</button>` : ''}`
  slot.querySelector('.more-btn')?.addEventListener('click', () => {
    todas = !todas
    pintarReformas(slot, fechas, ley)
    if (!todas) slot.closest('section').scrollIntoView({ block: 'start' })
  })
}
