import { asistente, consejos, DOCS, etiqueta, html, raw, ruta, titular } from './lib.js'

/** "Si te para un agente de tránsito": every tip of the site's guide (`site.guide`) with the articles it rests on. */
export default {
  nombre: 'consejos',
  mount(main) {
    const g = consejos()
    titular('Si te para un agente de tránsito')
    if (!g) {
      main.innerHTML = html`<section class="empty-page"><h1 tabindex="-1">Esta guía no existe en este sitio</h1><p><a class="button" href="/">Ir al buscador</a></p></section>`
      return
    }
    main.innerHTML = html`<article class="guia">
      <header class="guia-head">
        <h1 tabindex="-1">Si te para un agente de tránsito en la CDMX</h1>
        <p class="deck">${g.knowTheRules}</p>
        <p class="guia-alcance">${g.scope}</p>
      </header>
      <ol class="guia-lista">${g.tips.map(
        t => html`<li class="guia-item" id="${t.slug}">
          <h2>${t.title}</h2>
          <p class="guia-texto">${t.text}</p>
          <p class="guia-citas"><span class="label">Lo dice</span> ${t.cites.map(k => {
            const [ley, n] = k.split(':')
            return html`<a class="cite" href="${ruta(ley, n)}" title="${DOCS[ley]?.nombre ?? ley}">${etiqueta(k)}</a>`
          })}</p>
          ${t.source ? html`<p class="guia-fuente">Fuente: <a href="${t.source.url}" target="_blank" rel="noopener">${t.source.name}</a></p>` : ''}
        </li>`,
      )}</ol>
      <p class="guia-pie">¿Tienes otra duda? <a href="/">Pregúntale a ${raw(asistente().html)}</a> y te responde con los artículos al lado.</p>
    </article>`
    const destino = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
    if (destino) requestAnimationFrame(() => destino.scrollIntoView())
  },
}
