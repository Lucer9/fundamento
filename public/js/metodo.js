import { esAborto, errorHtml, etiqueta, html, LEYES, nf, pct, request, rutaClave } from './lib.js'

const EN_USO = 'hybrid bge-m3'
const BASE = 'keyword'
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const EJEMPLO = `{
  article(law: LISR, number: "151") {
    citedBy { key }
    criteria { kind title }
  }
}`

let evalP = null
let el = null
let vista = { conjunto: 'ajuste', materia: '', texto: '', mostrar: 'todas', limite: 25 }

const nombre = m =>
  m
    .replace(/^keyword\b/, 'Palabras clave')
    .replace(/^vector\b/, 'Vector')
    .replace(/^hybrid\b/, 'Híbrida')
    .replace(/\+ rerank$/, '+ reordenamiento')

const conjuntos = ev => ({
  ajuste: { ...ev, clave: 'ajuste', corto: 'Anexo 7', rol: 'Con estas preguntas se ajustaron los métodos.' },
  reservado: ev.holdout ? { ...ev.holdout, clave: 'reservado', corto: 'Anexo 3', rol: 'Reservadas: no se usaron para ajustar nada, solo se reportan.' } : null,
})

const puntos = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`

export default {
  nombre: 'metodo',
  async mount(main, ctx) {
    el = main
    document.title = 'Cómo funciona · fundamento'
    main.innerHTML = html`<header class="page-head">
        <p class="kicker">Cómo funciona</p>
        <h1 tabindex="-1">Cómo se mide la búsqueda</h1>
        <p class="deck">Las preguntas de prueba no las escribimos nosotros: salen de los criterios que publica el SAT en la Resolución Miscelánea Fiscal 2026.</p>
      </header>
      <div class="prose" data-slot="prose"></div>
      <div data-slot="eval"><div aria-hidden="true">${Array.from({ length: 6 }, () => html`<span class="sk"></span>`)}</div></div>
      <section class="panel api" aria-labelledby="api-h">
        <h2 class="section-h" id="api-h">La API</h2>
        <p>Todo lo que ves en este sitio sale de una API GraphQL pública. Puedes probarla en <a href="/graphql">el explorador de GraphQL</a>.</p>
        <pre class="code"><code>${EJEMPLO}</code></pre>
        <p class="muted small" data-slot="live" aria-live="polite">Ejecutando esta consulta…</p>
      </section>`
    const t0 = performance.now()
    request(EJEMPLO, {}, ctx.signal).then(
      b => {
        const ms = Math.round(performance.now() - t0)
        const n = b.extensions?.d1Queries
        main.querySelector('[data-slot=live]').textContent = `Ejecutada al abrir esta página: ${b.data.article.citedBy.length} artículos la citan, ${b.data.article.criteria.length} criterios. Respondió en ${nf.format(ms)} ms${n != null ? ` con ${n} ${n === 1 ? 'consulta' : 'consultas'} a la base de datos` : ''}.`
      },
      e => {
        if (!esAborto(e)) main.querySelector('[data-slot=live]').textContent = `No se pudo ejecutar: ${e.message}`
      },
    )
    evalP ??= fetch('/eval.json').then(r => {
      if (!r.ok) throw new Error(`No se encontró eval.json (${r.status}).`)
      return r.json()
    })
    let ev
    try {
      ev = await evalP
    } catch (e) {
      evalP = null
      main.querySelector('[data-slot=eval]').innerHTML = errorHtml(e, 'No se pudieron cargar los resultados')
      return
    }
    if (ctx.signal.aborted) return
    const cs = conjuntos(ev)
    main.querySelector('[data-slot=prose]').innerHTML = html`<p>Cada criterio tiene un título y cita los artículos en los que se apoya. Hacemos la búsqueda con el título como pregunta, y cuenta como acierto si alguno de esos artículos aparece entre los primeros resultados.</p>
      <ul class="sets">
        <li><strong>${cs.ajuste.nombre}</strong>, ${nf.format(cs.ajuste.n)} preguntas. ${cs.ajuste.rol}</li>
        ${cs.reservado ? html`<li><strong>${cs.reservado.nombre}</strong>, ${nf.format(cs.reservado.n)} preguntas. ${cs.reservado.rol}</li>` : ''}
      </ul>
      <dl class="defs">
        <div><dt>hit@k</dt><dd>Proporción de preguntas con un acierto entre los primeros k resultados.</dd></div>
        <div><dt>MRR</dt><dd>Promedio de 1 / posición del primer acierto.</dd></div>
        <div><dt>Rangos</dt><dd>Intervalos de confianza de 95% por bootstrap.</dd></div>
      </dl>
      <p class="muted small">Resultados del ${ev.fecha}. Este sitio usa la búsqueda <strong>${nombre(EN_USO)}</strong>.</p>`
    vista = { ...vista, limite: 25, conjunto: ctx.params.get('conjunto') === 'reservado' && cs.reservado ? 'reservado' : 'ajuste' }
    pintar(cs)
  },
}

function pintar(cs) {
  const c = cs[vista.conjunto]
  const slot = el.querySelector('[data-slot=eval]')
  const ms = c.metodos
  const best = k => Math.max(...ms.map(m => m[k]))
  const B = Object.fromEntries(['hit1', 'hit5', 'hit10', 'mrr'].map(k => [k, best(k)]))
  const celda = (m, k, txt, ic) =>
    html`<td class="${m[k] === B[k] ? 'best' : ''}"><span class="v">${txt}</span>${m[k] === B[k] ? html`<span class="sr-only"> (mejor)</span>` : ''}${ic ? html`<span class="ic">${ic}</span>` : ''}</td>`
  const rango = (iv, f) => (iv ? `${f(iv[0])}–${f(iv[1])}` : '')
  const p100 = x => (x * 100).toFixed(0)
  const p3 = x => x.toFixed(2)

  const base = ms.find(m => m.nombre === BASE)
  const comparables = ms.filter(m => m !== base && m.delta5)
  const tope = Math.max(0.1, ...Object.values(cs).filter(Boolean).flatMap(s => s.metodos.flatMap(m => (m.delta5 ? m.delta5.map(Math.abs) : []))))
  const dom = Math.ceil((tope * 100) / 5) * 5
  const x = v => ((v * 100 + dom) / (2 * dom)) * 100
  const sig = comparables.filter(m => m.delta5[0] > 0 || m.delta5[1] < 0)
  const mejor = [...sig].sort((a, b) => b.hit5 - a.hit5)[0]
  const resumen = !base
    ? ''
    : sig.length
      ? `En el ${c.corto}, ${sig.length === 1 ? 'un método supera' : `${sig.length} métodos superan`} a palabras clave en hit@5 con un intervalo que no cruza el cero. El mayor es ${nombre(mejor.nombre)}: ${puntos(mejor.hit5 - base.hit5)} puntos (de ${puntos(mejor.delta5[0])} a ${puntos(mejor.delta5[1])}).`
      : `En el ${c.corto}, ningún método se distingue de palabras clave: todos los intervalos de la diferencia en hit@5 cruzan el cero.`

  slot.innerHTML = html`<div class="filterbar">
      <fieldset class="seg seg--sets">
        <legend class="filter-legend">Preguntas</legend>
        ${Object.values(cs).filter(Boolean).map(s => html`<label><input type="radio" name="conjunto" value="${s.clave}" ${s.clave === vista.conjunto ? 'checked' : ''}><span><span>${s.corto}</span><span class="seg-sub">${s.clave === 'ajuste' ? 'ajuste' : 'reservado'} · ${s.n} preguntas</span></span></label>`)}
      </fieldset>
    </div>
    <section class="panel" aria-labelledby="tabla-h">
      <h2 class="section-h" id="tabla-h">${c.nombre}</h2>
      <div class="table-wrap">
        <table class="scores">
          <caption class="sr-only">Aciertos por método, ${c.nombre}, ${c.n} preguntas. La mejor cifra de cada columna está marcada.</caption>
          <thead><tr><th scope="col">Método</th><th scope="col">hit@1</th><th scope="col">hit@5</th><th scope="col">hit@10</th><th scope="col">MRR</th></tr></thead>
          <tbody>${ms.map(
            (m, i) => html`<tr class="${m.nombre === EN_USO ? 'is-prod' : ''}">
              <th scope="row"><span class="mcell"><span class="key">${LETRAS[i]}</span><span class="mname">${nombre(m.nombre)}</span>${m.nombre === EN_USO ? html`<span class="tag">en uso</span>` : ''}</span></th>
              ${celda(m, 'hit1', pct(m.hit1), '')}
              ${celda(m, 'hit5', pct(m.hit5), rango(m.ic5, p100))}
              ${celda(m, 'hit10', pct(m.hit10), '')}
              ${celda(m, 'mrr', m.mrr.toFixed(3), rango(m.icMrr, p3))}
            </tr>`,
          )}</tbody>
        </table>
      </div>
      <p class="muted small">Debajo de hit@5 y MRR, el intervalo de 95%. En color, la mejor cifra de cada columna.</p>
    </section>
    ${base && comparables.length
      ? html`<section class="panel" aria-labelledby="forest-h">
      <h2 class="section-h" id="forest-h">Diferencia frente a palabras clave</h2>
      <p class="lede">${resumen}</p>
      <figure class="forest">
        <div class="forest-axis" aria-hidden="true"><span class="forest-name">puntos</span><span class="forest-ticks">${[-dom, -dom / 2, 0, dom / 2, dom].map(t => html`<span style="left:${x(t / 100)}%">${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}</span>`)}</span></div>
        <ul>${comparables.map(m => {
          const d = m.hit5 - base.hit5
          const s = m.delta5[0] > 0 || m.delta5[1] < 0
          return html`<li class="${s ? 'is-sig' : ''}">
            <span class="forest-name"><span class="key">${LETRAS[ms.indexOf(m)]}</span>${nombre(m.nombre)}</span>
            <span class="forest-track" aria-hidden="true"><i class="zero" style="left:${x(0)}%"></i><i class="iv" style="left:${x(m.delta5[0])}%;width:${x(m.delta5[1]) - x(m.delta5[0])}%"></i><i class="pt" style="left:${x(d)}%"></i></span>
            <span class="forest-v">${puntos(d)} <span class="ic">${puntos(m.delta5[0])} a ${puntos(m.delta5[1])}</span></span>
          </li>`
        })}</ul>
        <figcaption class="muted small">Puntos porcentuales de hit@5 sobre palabras clave, con su intervalo pareado de 95%. En color, los intervalos que no cruzan el cero.</figcaption>
      </figure>
    </section>`
      : ''}
    <section class="panel" aria-labelledby="exp-h">
      <h2 class="section-h" id="exp-h">Pregunta por pregunta</h2>
      <form class="exp-filters" role="search" aria-label="Filtrar preguntas">
        <label class="field"><span>Buscar en las preguntas</span><input type="search" name="texto" value="${vista.texto}" autocomplete="off"></label>
        <label class="field"><span>Ley</span><select name="materia"><option value="">Todas</option>${Object.keys(LEYES).map(k => html`<option value="${k}" ${vista.materia === k ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="field"><span>Mostrar</span><select name="mostrar">
          ${[
            ['todas', 'Todas'],
            ['falla-uso', `Sin acierto de ${nombre(EN_USO)}`],
            ['falla-todos', 'Sin acierto de ningún método'],
            ['acierta-todos', 'Acierto de todos los métodos'],
          ].map(([v, t]) => html`<option value="${v}" ${vista.mostrar === v ? 'selected' : ''}>${t}</option>`)}
        </select></label>
      </form>
      <p class="exp-legend muted small">${ms.map((m, i) => html`<span><span class="key">${LETRAS[i]}</span>${nombre(m.nombre)}</span>`)}</p>
      <p class="exp-scale small" aria-hidden="true"><span class="rk" data-r="1">1</span><span class="rk" data-r="2">2–3</span><span class="rk" data-r="3">4–5</span><span class="rk" data-r="4">6–10</span><span class="rk" data-r="0">—</span><span class="muted">posición del primer acierto; — fuera de los 10 primeros</span></p>
      <p class="exp-count small" data-slot="count" aria-live="polite"></p>
      <div class="exp" data-slot="rows"></div>
    </section>`

  slot.querySelector('.seg--sets').addEventListener('change', e => {
    vista.conjunto = e.target.value
    vista.limite = 25
    history.replaceState(history.state, '', e.target.value === 'reservado' ? '/como-funciona?conjunto=reservado' : '/como-funciona')
    pintar(cs)
    el.querySelector('.seg--sets input:checked')?.focus()
  })
  const form = slot.querySelector('.exp-filters')
  form.addEventListener('submit', e => e.preventDefault())
  form.addEventListener('input', () => {
    vista = { ...vista, texto: form.texto.value, materia: form.materia.value, mostrar: form.mostrar.value, limite: 25 }
    filas(c)
  })
  filas(c)
}

const plano = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function filas(c) {
  const ms = c.metodos.map(m => m.nombre)
  const t = plano(vista.texto.trim())
  const lista = c.preguntas.filter(p => {
    if (vista.materia && p.materia !== vista.materia) return false
    if (t && !plano(`${p.tema} ${p.id ?? ''} ${p.esperados.join(' ')}`).includes(t)) return false
    const r = ms.map(m => p.rangos[m])
    if (vista.mostrar === 'falla-uso') return p.rangos[EN_USO] == null
    if (vista.mostrar === 'falla-todos') return r.every(v => v == null)
    if (vista.mostrar === 'acierta-todos') return r.every(v => v != null)
    return true
  })
  el.querySelector('[data-slot=count]').textContent = `${nf.format(lista.length)} de ${nf.format(c.preguntas.length)} preguntas`
  const visibles = lista.slice(0, vista.limite)
  const nivel = r => (r == null ? 0 : r === 1 ? 1 : r <= 3 ? 2 : r <= 5 ? 3 : 4)
  el.querySelector('[data-slot=rows]').innerHTML = lista.length
    ? html`<div class="exp-head" aria-hidden="true" style="--n:${ms.length}"><span>Pregunta</span><span>Artículos</span><span class="exp-ranks">${ms.map((_, i) => html`<span>${LETRAS[i]}</span>`)}</span></div>
      <ol class="exp-list" style="--n:${ms.length}">${visibles.map(
        p => html`<li class="exp-row">
          <div class="exp-q"><span class="badge">${p.materia}</span>${p.id ? html`<span class="crit-id">${p.id}</span>` : ''}<p>${p.tema}</p></div>
          <p class="exp-arts">${p.esperados.map(k => html`<a href="${rutaClave(k)}">${etiqueta(k)}</a>`)}</p>
          <ul class="exp-ranks" aria-label="Posición por método">${ms.map(
            (m, i) => html`<li class="rk" data-r="${nivel(p.rangos[m])}" title="${`${nombre(m)}: ${p.rangos[m] == null ? 'sin acierto en los 10 primeros' : `posición ${p.rangos[m]}`}`}"><span class="rk-l" aria-hidden="true">${LETRAS[i]}</span><span class="sr-only">${nombre(m)}: </span><span class="rk-n">${p.rangos[m] ?? '—'}</span></li>`,
          )}</ul>
        </li>`,
      )}</ol>
      ${lista.length > visibles.length ? html`<button class="button button--quiet more-btn" type="button" data-mas>Mostrar ${Math.min(25, lista.length - visibles.length)} más <span class="muted">· quedan ${lista.length - visibles.length}</span></button>` : ''}`
    : html`<p class="muted">Ninguna pregunta coincide con esos filtros.</p>`
  el.querySelector('[data-mas]')?.addEventListener('click', () => {
    const n = vista.limite
    vista.limite += 25
    filas(c)
    el.querySelectorAll('.exp-row')[n]?.querySelector('a, p')?.focus?.()
  })
}
