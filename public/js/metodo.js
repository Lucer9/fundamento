import { badge, cargarEval, cargarRespuestas, corto, DOCS, elLa, esAborto, errorHtml, etiqueta, familiasPresentes, html, modeloBonito, nf, pct, request, rutaClave, SITIO, tieneCriterios, titular } from './lib.js'

const BASE = 'keyword'
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const EJEMPLO = `{
  mostCited(first: 3) {
    count
    article { key title }
  }
}`

let el = null
let vista = { conjunto: '', materia: '', texto: '', mostrar: 'todas', limite: 25 }
let orden = []
let enUso = ''

const nombre = m =>
  m
    .replace(/^keyword\b/, 'Palabras clave')
    .replace(/^vector\b/, 'Vector')
    .replace(/^hybrid\b/, 'Híbrida')
    .replace(/\+ rerank$/, '+ reordenamiento')

const letra = m => LETRAS[orden.indexOf(m)] ?? '?'
const NUMEROS = ['ningún', 'un', 'dos', 'tres', 'cuatro']

/**
 * The question sets eval.json carries, in the order they are shown: the plain-language set first (closest to real
 * use), then SAT's Anexo 7 and the held-out Anexo 3 where the site has SAT criteria. Absent sets are skipped.
 */
const conjuntos = ev => {
  const sat = tieneCriterios()
  return [
    ev.naturales && {
      ...ev.naturales,
      clave: 'comun',
      corto: sat ? 'Lenguaje común' : 'Preguntas',
      sub: 'uso real',
      frase: sat ? 'En las preguntas en lenguaje común' : 'En estas preguntas',
      rol: `${sat ? 'Un modelo (gpt-oss-120b) escribió una pregunta a partir de cada criterio, sin revelar la respuesta, y se califica con los mismos artículos. ' : ''}Es lo más parecido al uso real.${autores(ev.naturales)}`,
    },
    ev.metodos && { ...ev, clave: 'anexo7', corto: 'Anexo 7', sub: 'ajuste', frase: 'En el Anexo 7', rol: 'El título de cada criterio es la pregunta. Con estas preguntas se ajustaron los métodos.' },
    ev.holdout && {
      ...ev.holdout,
      clave: 'anexo3',
      corto: 'Anexo 3',
      sub: 'reservado',
      frase: 'En el Anexo 3',
      rol: 'El título de cada criterio es la pregunta. Reservadas: no se usaron para ajustar nada, solo se reportan.',
    },
  ].filter(c => c?.metodos?.length)
}

/** Who wrote the questions, from `preguntas[].modelo`: one sentence, or nothing when the file does not say. */
function autores(s) {
  const porModelo = new Map()
  for (const p of s.preguntas.filter(p => p.modelo)) {
    const m = modeloBonito(p.modelo)
    porModelo.set(m, [...(porModelo.get(m) ?? []), p])
  }
  if (!porModelo.size) return ''
  const [[unico, todas]] = porModelo
  if (porModelo.size === 1 && todas.length === s.preguntas.length) return ` Las escribió ${unico}.`
  return ` ${[...porModelo]
    .map(([m, ps]) => {
      const docs = [...new Set(ps.map(p => p.materia))].filter(c => DOCS[c])
      const sobre = docs.length && docs.length <= 3 ? `, sobre ${docs.map(c => `${elLa(DOCS[c].corto)} ${DOCS[c].corto}`).join(docs.length === 2 ? ' y ' : ', ').replace(/, ([^,]+)$/, ' y $1')},` : ''
      return `${ps.length} de las ${s.n}${sobre} las escribió ${m}`
    })
    .join('; ')}.`
}

const puntos = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`

const iv = ([lo, hi]) => `${puntos(lo)} a ${puntos(hi)}`
const cruzaCero = ([lo, hi]) => lo <= 0 && hi >= 0

const sinAlcance = n => n.replace(/ · .+$/, '')
const modelo = n => sinAlcance(n).replace(/^(vector|hybrid|keyword)\s*/, '').replace(/ \d+d$/, '')
const efecto = ([lo, hi], mejor, peor, igual) => (lo > 0 ? mejor : hi < 0 ? peor : igual)

/**
 * Findings stated only from what eval.json carries: each one renders when its methods (and, for paired
 * claims, its entry in `naturales.comparaciones`) exist, so a smaller rerun drops the claim instead of
 * keeping a stale number. The in-production method comes from `enUso`; its " · <list>" suffix names the
 * search list it ranks on its own.
 */
function hallazgos(cs) {
  const set = k => cs.find(c => c.clave === k)
  const m = (s, n) => s?.metodos.find(x => x.nombre === n)
  const com = set('comun')
  const a7 = set('anexo7')
  const comparaciones = com?.comparaciones ?? []
  const par = (a, b) => comparaciones.find(c => c.a === a && c.b === b)
  const out = []
  if (!enUso) return out
  const prod = m(com, enUso)
  const alcance = enUso.includes(' · ') ? enUso.slice(enUso.indexOf(' · ')) : ''
  const lista = SITIO.site.lists.find(l => alcance === ` · ${l.title.toLowerCase()}`)
  const solo = lista ? `«${lista.title}»` : ''
  const base = nombre(sinAlcance(enUso)).toLowerCase()

  const familiaEnUso = /^hybrid /.test(enUso) ? 'hibrida' : /^vector /.test(enUso) ? 'vector' : ''
  const quien = familiaEnUso === 'hibrida' ? 'combinar palabras clave y vectores supera a las palabras clave solas' : 'los vectores superan a las palabras clave'
  const contraPalabras = par(enUso, `keyword${alcance}`)
  const kw = contraPalabras ? m(com, contraPalabras.b) : !alcance && m(com, BASE)
  const iv5 = contraPalabras?.hit5 ?? (!alcance && prod?.delta5)
  if (prod && kw && iv5 && familiaEnUso) {
    const dif = `${((prod.hit5 - kw.hit5) * 100).toFixed(1)} puntos`
    out.push(
      efecto(
        iv5,
        `${com.frase}, ${quien}: ${solo ? `buscando solo en ${solo}, ` : ''}${base} trae un artículo esperado entre los 5 primeros resultados ${dif} más seguido que la búsqueda por palabras (intervalo pareado de 95%: ${iv(iv5)}).`,
        `${com.frase}, la búsqueda por palabras supera a ${base} en hit@5 (intervalo pareado de 95%: ${iv(iv5)}).`,
        `${com.frase}, la ventaja de ${base} sobre la búsqueda por palabras (${dif} en hit@5) no se distingue del ruido: el intervalo pareado de 95% va de ${iv(iv5)}.`,
      ),
    )
  }

  const separar = alcance && par(enUso, sinAlcance(enUso))
  const mezcla = separar && m(com, separar.b)
  if (prod && mezcla && separar.hit1 && solo)
    out.push(`Buscar en ${solo} por separado ${efecto(separar.hit1, 'mejoró', 'empeoró', 'no cambió de forma medible')} el primer resultado: con ${base}, el artículo esperado quedó en primer lugar en ${pct(prod.hit1)} de las preguntas buscando solo ahí, contra ${pct(mezcla.hit1)} con todos los documentos en una sola lista (diferencia pareada de 95%: ${iv(separar.hit1)} puntos).${separar.hit1[0] > 0 && SITIO.site.lists.length > 1 ? ` Por eso los resultados se muestran en ${NUMEROS[SITIO.site.lists.length] ?? SITIO.site.lists.length} listas.` : ''}`)

  const fusion = comparaciones.find(c => /^vector /.test(c.a) && c.b === c.a.replace(/^vector /, 'hybrid ') && c.hit1 && c.hit5)
  const va = fusion && m(com, fusion.a)
  const hb = fusion && m(com, fusion.b)
  if (va && hb && familiaEnUso === 'hibrida' && sinAlcance(enUso) === fusion.b) {
    const top5 = r => r != null && r <= 5
    const gana = com.preguntas.filter(p => top5(p.rangos[fusion.b]) && !top5(p.rangos[fusion.a])).length
    const pierde = com.preguntas.filter(p => top5(p.rangos[fusion.a]) && !top5(p.rangos[fusion.b])).length
    const de = x => `${Math.round(x.hit5 * com.n)} de ${com.n}`
    out.push(
      `Sumar palabras clave a los vectores (búsqueda híbrida) puso un artículo esperado entre los 5 primeros resultados en ${de(hb)} preguntas, contra ${de(va)} solo con vectores: ${gana === 1 ? 'ganó una pregunta' : `ganó ${gana}`} y ${pierde === 0 ? 'no perdió ninguna' : pierde === 1 ? 'perdió una' : `perdió ${pierde}`}. ${efecto(
        fusion.hit5,
        `La diferencia pareada favorece a los vectores (de ${iv(fusion.hit5)} puntos, vectores menos híbrida).`,
        `La diferencia pareada favorece a la híbrida (de ${iv(fusion.hit5)} puntos, vectores menos híbrida).`,
        `Con ${com.n} preguntas, la diferencia pareada (de ${iv(fusion.hit5)} puntos, vectores menos híbrida) todavía toca el cero.`,
      )} El sitio usa la búsqueda híbrida.`,
    )
  } else if (va && hb) {
    const cifras = `con ${modelo(fusion.a)}, ${pct(va.hit1)} solo con vectores contra ${pct(hb.hit1)} en híbrida (diferencia pareada de 95%: ${iv(fusion.hit1)} puntos)`
    out.push(
      efecto(
        fusion.hit1,
        `Sumar palabras clave a los vectores (búsqueda híbrida) bajó hit@1: ${cifras}.${familiaEnUso === 'vector' ? ' Por eso el sitio usa solo vectores.' : ''}`,
        `Sumar palabras clave a los vectores (búsqueda híbrida) subió hit@1: ${cifras}.`,
        `Sumar palabras clave a los vectores (búsqueda híbrida) no cambió hit@1 de forma medible: ${cifras}.`,
      ),
    )
  }

  const rivales = comparaciones.filter(c => /^vector /.test(c.a) && /^vector /.test(c.b) && modelo(c.a) === modelo(enUso) && modelo(c.b) !== modelo(c.a) && c.hit5 && cruzaCero(c.hit5))
  if (rivales.length) out.push(`Con este número de preguntas no se puede separar ${modelo(enUso)} de ${rivales.map(c => modelo(c.b)).join(' ni de ')}: los intervalos pareados de hit@5 cruzan el cero.`)

  const recorte = comparaciones.find(c => c.b === `${c.a} 768d` && c.hit5)
  if (recorte) {
    const d = `diferencia pareada en hit@5, 512 menos 768: ${iv(recorte.hit5)} puntos`
    const igual = recorte.hit5[0] === 0 && recorte.hit5[1] === 0
    out.push(
      igual
        ? 'Recortar los vectores de 768 a 512 dimensiones no cambió ningún acierto entre los 5 primeros resultados.'
        : efecto(
            recorte.hit5,
            `Recortar los vectores de 768 a 512 dimensiones no costó precisión: con 512, ${modelo(recorte.a)} acertó entre los 5 primeros al menos igual de seguido (${d}).`,
            `Recortar los vectores de 768 a 512 dimensiones costó precisión (${d}).`,
            `Recortar los vectores de 768 a 512 dimensiones no cambió el resultado de forma medible (${d}).`,
          ),
    )
  }

  const v7 = m(a7, 'vector bge-m3')
  const r7 = m(a7, 'vector bge-m3 + rerank')
  if (v7 && r7 && r7.hit1 < v7.hit1) out.push(`Reordenar los resultados con un modelo reranker empeoró la búsqueda: en el Anexo 7, hit@1 bajó de ${pct(v7.hit1)} a ${pct(r7.hit1)}.`)
  return out
}

/** How production searches, from `enUso`: vectors alone or hybrid, and whether gemma's vectors are cut to 512 dimensions. */
function produccion() {
  const gemma = / gemma\b/.test(enUso)
  const recortados = gemma && orden.some(n => / 768d$/.test(n))
  if (/^vector /.test(enUso)) return `Este sitio usa búsqueda vectorial${gemma ? ` con embeddinggemma-300m${recortados ? ', recortada a 512 dimensiones' : ''}` : ''}`
  if (/^hybrid /.test(enUso)) return `Este sitio usa búsqueda híbrida: palabras clave más vectores${gemma ? ` de embeddinggemma-300m${recortados ? ' recortados a 512 dimensiones' : ''}` : ''}`
  if (/^keyword/.test(enUso)) return 'Este sitio usa búsqueda por palabras clave'
  return `Este sitio usa la búsqueda «${nombre(enUso).toLowerCase()}»`
}

/** "El índice cubre 10 documentos: 5 leyes, 4 reglamentos y la Resolución…", from the site's documents. */
function alcanceIndice() {
  const docs = Object.values(DOCS)
  const partes = familiasPresentes().map(f => {
    const ds = docs.filter(d => d.familia === f.id)
    if (f.id === 'reglas') return ds.length === 1 ? `${elLa(ds[0].nombre)} ${ds[0].nombre}` : `${ds.length} conjuntos de reglas`
    return `${ds.length} ${ds.length === 1 ? f.uno : f.nombre.toLowerCase()}`
  })
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]
  const unidades = docs.some(d => d.familia === 'reglas') ? 'artículos y reglas' : 'artículos'
  return `El índice cubre ${docs.length} documentos: ${lista}, con ${nf.format(SITIO.stats.articles)} ${unidades}.`
}

export default {
  nombre: 'metodo',
  async mount(main, ctx) {
    el = main
    titular('Cómo funciona')
    const sat = tieneCriterios()
    main.innerHTML = html`<header class="page-head">
        <p class="kicker">Cómo funciona</p>
        <h1 tabindex="-1">Cómo se mide la búsqueda</h1>
        <p class="deck">${sat ? 'Cada pregunta de prueba sale de un criterio que publica el SAT en la Resolución Miscelánea Fiscal 2026, y se califica con los artículos que ese criterio cita.' : 'Cada pregunta de prueba trae anotados los artículos que la responden, y cuenta como acierto si alguno aparece entre los primeros resultados.'}</p>
      </header>
      <p class="scope muted">${alcanceIndice()}</p>
      <div class="prose" data-slot="prose"></div>
      <div data-slot="eval"><div aria-hidden="true">${Array.from({ length: 6 }, () => html`<span class="sk"></span>`)}</div></div>
      <section class="panel" aria-labelledby="resp-h" data-slot="respuestas" hidden></section>
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
        const top = b.data.mostCited[0]
        main.querySelector('[data-slot=live]').textContent = `Ejecutada al abrir esta página${top ? `: lo más citado es ${etiqueta(top.article.key)}${top.article.title ? ` («${top.article.title}»)` : ''}, con ${nf.format(top.count)} citas` : ''}. Respondió en ${nf.format(ms)} ms${n != null ? ` con ${n} ${n === 1 ? 'consulta' : 'consultas'} a la base de datos` : ''}.`
      },
      e => {
        if (!esAborto(e)) main.querySelector('[data-slot=live]').textContent = `No se pudo ejecutar: ${e.message}`
      },
    )
    respuestas(main.querySelector('[data-slot=respuestas]'))
    let ev
    try {
      ev = await cargarEval()
    } catch (e) {
      main.querySelector('[data-slot=eval]').innerHTML = /^No se encontró/.test(e.message) ? html`<p class="muted">Todavía no hay resultados publicados para este sitio.</p>` : errorHtml(e, 'No se pudieron cargar los resultados')
      return
    }
    if (ctx.signal.aborted) return
    enUso = ev.enUso ?? ''
    const cs = conjuntos(ev)
    if (!cs.length) {
      main.querySelector('[data-slot=eval]').innerHTML = html`<p class="muted">Todavía no hay resultados publicados para este sitio.</p>`
      return
    }
    orden = [...new Set([...(ev.metodos ?? []), ...cs.flatMap(c => c.metodos)].map(m => m.nombre))]
    const puntosClave = hallazgos(cs)
    const listas = SITIO.site.lists
    main.querySelector('[data-slot=prose]').innerHTML = html`<div class="prose-main"><p>${sat ? 'Cada criterio del SAT cita los artículos en los que se apoya. ' : ''}Una pregunta cuenta como acierto si alguno de ${sat ? 'esos artículos' : 'los artículos que la responden'} aparece entre los primeros resultados. Hay ${NUMEROS[cs.length] ?? cs.length} ${cs.length === 1 ? 'conjunto' : 'conjuntos'} de preguntas:</p>
      <ul class="sets">${cs.map(c => html`<li><strong>${c.nombre}</strong>, ${nf.format(c.n)} preguntas. ${c.rol}</li>`)}</ul></div>
      <aside class="prose-side"><dl class="defs">
        <div><dt>hit@k</dt><dd>Proporción de preguntas con un acierto entre los primeros k resultados.</dd></div>
        <div><dt>MRR</dt><dd>Promedio de 1 / posición del primer acierto.</dd></div>
        <div><dt>Rangos</dt><dd>Intervalos de confianza de 95% por bootstrap.</dd></div>
      </dl>
      <p class="muted small">Resultados del ${ev.fecha}.${enUso ? html` ${produccion()}${listas.length > 1 ? `, con ${listas.map(l => `«${l.title}»`).join(' y ')} en listas separadas` : ''} (<strong>${nombre(enUso).toLowerCase()}</strong> en las tablas); los artículos que la pregunta nombra van primero.` : ''}</p></aside>
      ${puntosClave.length ? html`<section class="findings" aria-labelledby="hall-h"><h2 class="section-h" id="hall-h">Lo que muestran los números</h2><ol>${puntosClave.map(t => html`<li>${t}</li>`)}</ol></section>` : ''}`
    const pedido = ctx.params.get('conjunto')
    const alias = { reservado: 'anexo3', ajuste: 'anexo7' }
    vista = { ...vista, limite: 25, conjunto: cs.find(c => c.clave === (alias[pedido] ?? pedido))?.clave ?? cs[0].clave }
    pintar(cs)
  },
}

function pintar(cs) {
  const c = cs.find(x => x.clave === vista.conjunto)
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
  const tope = Math.max(0.1, ...cs.flatMap(s => s.metodos.flatMap(m => (m.delta5 ? m.delta5.map(Math.abs) : []))))
  const dom = Math.ceil((tope * 100) / 10) * 10
  const x = v => ((v * 100 + dom) / (2 * dom)) * 100
  const sig = comparables.filter(m => m.delta5[0] > 0 || m.delta5[1] < 0)
  const mejor = [...sig].sort((a, b) => b.hit5 - a.hit5)[0]
  const resumen = !base
    ? ''
    : sig.length
      ? `${c.frase}, ${sig.length === 1 ? 'un método supera' : `${sig.length} métodos superan`} a palabras clave en hit@5 con un intervalo que no cruza el cero. El mayor es ${nombre(mejor.nombre).toLowerCase()}: ${puntos(mejor.hit5 - base.hit5)} puntos (de ${puntos(mejor.delta5[0])} a ${puntos(mejor.delta5[1])}).`
      : `${c.frase}, ningún método se distingue de palabras clave: todos los intervalos de la diferencia en hit@5 cruzan el cero.`

  slot.innerHTML = html`<div class="filterbar"${cs.length < 2 ? ' hidden' : ''}>
      <fieldset class="seg seg--sets">
        <legend class="filter-legend">Preguntas</legend>
        ${cs.map(s => html`<label><input type="radio" name="conjunto" value="${s.clave}" ${s.clave === vista.conjunto ? 'checked' : ''}><span><span>${s.corto}</span><span class="seg-sub">${s.sub} · ${s.n}</span></span></label>`)}
      </fieldset>
    </div>
    <section class="panel" aria-labelledby="tabla-h">
      <h2 class="section-h" id="tabla-h">${c.nombre}</h2>
      <p class="muted small set-note">${nf.format(c.n)} preguntas. ${c.rol}</p>
      <div class="table-wrap">
        <table class="scores">
          <caption class="sr-only">Aciertos por método, ${c.nombre}, ${c.n} preguntas. La mejor cifra de cada columna está marcada.</caption>
          <thead><tr><th scope="col">Método</th><th scope="col">hit@1</th><th scope="col">hit@5</th><th scope="col">hit@10</th><th scope="col">MRR</th></tr></thead>
          <tbody>${ms.map(
            m => html`<tr class="${m.nombre === enUso ? 'is-prod' : ''}">
              <th scope="row"><span class="mcell"><span class="key">${letra(m.nombre)}</span><span class="mname">${nombre(m.nombre)}</span>${m.nombre === enUso ? html`<span class="tag">en uso</span>` : ''}</span></th>
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
            <span class="forest-name"><span class="key">${letra(m.nombre)}</span>${nombre(m.nombre)}</span>
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
        <label class="field"><span>Documento</span><select name="materia"><option value="">Todos</option>${[...new Set(c.preguntas.map(p => p.materia))].sort().map(k => html`<option value="${k}" ${vista.materia === k ? 'selected' : ''}>${corto(k)}</option>`)}</select></label>
        <label class="field"><span>Mostrar</span><select name="mostrar">
          ${[
            ['todas', 'Todas'],
            ...(enUso ? [['falla-uso', `Sin acierto de la búsqueda en uso`]] : []),
            ['falla-todos', 'Sin acierto de ningún método'],
            ['acierta-todos', 'Acierto de todos los métodos'],
          ].map(([v, t]) => html`<option value="${v}" ${vista.mostrar === v ? 'selected' : ''}>${t}</option>`)}
        </select></label>
      </form>
      <p class="exp-legend muted small">${ms.map(m => html`<span><span class="key">${letra(m.nombre)}</span>${nombre(m.nombre)}</span>`)}</p>
      <p class="exp-scale small" aria-hidden="true"><span class="rk" data-r="1">1</span><span class="rk" data-r="2">2–3</span><span class="rk" data-r="3">4–5</span><span class="rk" data-r="4">6–10</span><span class="rk" data-r="0">—</span><span class="muted">posición del primer acierto; — fuera de los 10 primeros</span></p>
      <p class="exp-count small" data-slot="count" aria-live="polite"></p>
      <div class="exp" data-slot="rows"></div>
    </section>`

  slot.querySelector('.seg--sets').addEventListener('change', e => {
    vista.conjunto = e.target.value
    vista.limite = 25
    history.replaceState(history.state, '', e.target.value === cs[0].clave ? '/como-funciona' : `/como-funciona?conjunto=${e.target.value}`)
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
    if (vista.mostrar === 'falla-uso') return p.rangos[enUso] == null
    if (vista.mostrar === 'falla-todos') return r.every(v => v == null)
    if (vista.mostrar === 'acierta-todos') return r.every(v => v != null)
    return true
  })
  el.querySelector('[data-slot=count]').textContent = `${nf.format(lista.length)} de ${nf.format(c.preguntas.length)} preguntas`
  const visibles = lista.slice(0, vista.limite)
  const nivel = r => (r == null ? 0 : r === 1 ? 1 : r <= 3 ? 2 : r <= 5 ? 3 : 4)
  el.querySelector('[data-slot=rows]').innerHTML = lista.length
    ? html`<div class="exp-head" aria-hidden="true" style="--n:${ms.length}"><span>Pregunta</span><span>Artículos</span><span class="exp-ranks">${ms.map(m => html`<span>${letra(m)}</span>`)}</span></div>
      <ol class="exp-list" style="--n:${ms.length}">${visibles.map(
        p => html`<li class="exp-row">
          <div class="exp-q">${badge(p.materia)}${p.id ? html`<span class="crit-id">${p.id}</span>` : ''}<p>${p.tema}</p></div>
          <p class="exp-arts">${p.esperados.map(k => html`<a href="${rutaClave(k)}">${etiqueta(k)}</a>`)}</p>
          <ul class="exp-ranks" aria-label="Posición por método">${ms.map(
            m => html`<li class="rk" data-r="${nivel(p.rangos[m])}" title="${`${nombre(m)}: ${p.rangos[m] == null ? 'sin acierto en los 10 primeros' : `posición ${p.rangos[m]}`}`}"><span class="rk-l" aria-hidden="true">${letra(m)}</span><span class="sr-only">${nombre(m)}: </span><span class="rk-n">${p.rangos[m] ?? '—'}</span></li>`,
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

const segundos = x => `${Number(x).toFixed(1)} s`

const RESUMENES = [
  ['todas', 'Todas'],
  ['anexo7', 'Anexo 7'],
  ['anexo3', 'Anexo 3'],
]

/** Answer-accuracy runs from `site.answersEvalPath`; the section stays hidden when the file is missing or malformed. */
async function respuestas(slot) {
  let datos
  try {
    datos = await cargarRespuestas()
  } catch {
    return
  }
  const corridas = datos?.corridas
  if (!Array.isArray(corridas) || !corridas.length || !slot.isConnected) return
  const juez = modeloBonito(corridas.map(c => c.juez).find(Boolean) ?? '')
  const comoPct = (r, k) => {
    const v = Number(r[k] ?? 0)
    return ['correcta', 'incorrecta', 'incompleta'].every(c => Number(r[c] ?? 0) <= 1) ? v * 100 : v
  }
  const fila = (titulo, r) => {
    if (!r) return ''
    const ok = comoPct(r, 'correcta')
    const parte = comoPct(r, 'incompleta')
    const mal = comoPct(r, 'incorrecta')
    const cita = r.citaEsperado == null ? null : comoPct(r, 'citaEsperado')
    return html`<div class="run-row">
      <p class="run-set">${titulo}${r.n != null ? html` <span class="muted">· ${nf.format(r.n)}</span>` : ''}</p>
      <div class="stack" role="img" aria-label="${`Correctas ${ok.toFixed(0)}%, incompletas ${parte.toFixed(0)}%, incorrectas ${mal.toFixed(0)}%`}"><i class="s-ok" style="width:${ok}%"></i><i class="s-part" style="width:${parte}%"></i><i class="s-bad" style="width:${mal}%"></i></div>
      <p class="run-nums"><span class="s-ok-t">${ok.toFixed(0)}% correctas</span><span>${parte.toFixed(0)}% incompletas</span><span>${mal.toFixed(0)}% incorrectas</span></p>
      <p class="run-extra muted">${cita != null ? html`Cita el artículo esperado: ${cita.toFixed(0)}%` : ''}${r.p50 != null ? html`<span>p50 ${segundos(r.p50)} · p90 ${segundos(r.p90)}</span>` : ''}</p>
    </div>`
  }
  const sat = tieneCriterios()
  slot.innerHTML = html`<h2 class="section-h" id="resp-h">¿Qué tan bien responde?</h2>
    <dl class="defs defs--wide">
      <div><dt>Calificación</dt><dd>${
        sat
          ? `Un modelo distinto (${juez}) compara cada respuesta con el criterio del SAT del que salió la pregunta y la marca como correcta, incompleta o incorrecta; ese criterio nunca se le da al sistema que responde.`
          : `Un modelo distinto (${juez}) compara cada respuesta con una respuesta de referencia revisada a mano y la marca como correcta, incompleta o incorrecta.`
      }</dd></div>
      <div><dt>Cita</dt><dd>Proporción de respuestas que citan al menos uno de los artículos esperados para la pregunta.</dd></div>
      <div><dt>p50 · p90</dt><dd>Segundos hasta tener la respuesta: la mitad tardó menos que p50, y 9 de cada 10, menos que p90.</dd></div>
    </dl>
    <div class="runs">${corridas.map(
      c => html`<article class="run">
        <header class="run-head">
          <h3 class="run-title">${c.corrida}</h3>
          ${c.descripcion ? html`<p class="run-desc">${c.descripcion}</p>` : ''}
          <p class="run-meta muted">${[c.modelo && `Modelo ${modeloBonito(c.modelo)}`, c.fecha].filter(Boolean).join(' · ')}</p>
        </header>
        ${RESUMENES.filter(([k]) => c[k]).map(([k, t]) => fila(t, c[k]))}
      </article>`,
    )}</div>`
  slot.hidden = false
}
