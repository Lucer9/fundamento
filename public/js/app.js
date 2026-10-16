import { cargarSitio, DOCS, editor, esAborto, esDoc, fechaLargaDe, html, pesos, SITIO, tema, tieneCriterios, titular } from './lib.js'

const main = document.getElementById('main')
const LEY = /^\/([A-Za-z][A-Za-z0-9]*)\/([^/]+)\/?$/
const esArticulo = p => {
  const m = p.match(LEY)
  return !!m && esDoc(m[1].toUpperCase())
}
const ARCHIVO = /\.(json|js|css|pdf|png|jpe?g|svg|webp|ico|txt|xml|html)$/i

const rutas = [
  { test: p => p === '/', page: () => import('./buscar.js') },
  { test: esArticulo, page: () => import('./articulo.js') },
  { test: p => p === '/explorar', page: () => import('./explorar.js') },
  { test: p => p === '/como-funciona', page: () => import('./metodo.js') },
  { test: p => /^\/preguntas(\/[^/]+)?\/?$/.test(p), page: () => import('./preguntas.js') },
  { test: p => /^\/si-te-para-un-agente\/?$/.test(p), page: () => import('./consejos.js') },
]

let actual = null
let control = null
let primera = true
let ultima = ''

const noEncontrada = {
  nombre: '404',
  mount(el) {
    titular('Página no encontrada')
    const primero = SITIO.site.lists[0]?.laws[0] ?? Object.keys(DOCS)[0]
    const reglas = Object.keys(DOCS).find(c => DOCS[c].familia === 'reglas')
    el.innerHTML = html`<section class="empty-page">
      <p class="kicker">Error 404</p>
      <h1 tabindex="-1">Esta página no existe</h1>
      <p class="deck">Puede que el enlace esté mal escrito. Los artículos viven en direcciones como <a href="/${primero}/1">/${primero}/1</a>${reglas ? html`, y las reglas en <a href="/${reglas}/1.1">/${reglas}/1.1</a>` : ''}.</p>
      <p><a class="button" href="/">Ir al buscador</a></p>
    </section>`
  },
}

async function render({ restaurar } = {}) {
  control?.abort()
  control = new AbortController()
  const signal = control.signal
  const url = new URL(location.href)
  const ruta = rutas.find(r => r.test(url.pathname))
  let page = noEncontrada
  if (ruta) {
    try {
      const mod = await ruta.page()
      page = mod.default
    } catch (e) {
      main.innerHTML = html`<div class="error" role="alert"><p class="error-title">No se pudo cargar la página</p><p>${e.message}</p></div>`
      return
    }
  }
  if (signal.aborted) return
  ultima = url.pathname + url.search
  marcarNav(url.pathname)
  const ssr = primera ? main.querySelector(':scope > .ssr') : null
  const ctx = { url, params: url.searchParams, match: url.pathname.match(LEY), state: history.state ?? {}, signal, navigate, ssr }
  try {
    if (actual?.page === page && page.update) await page.update(ctx)
    else {
      actual?.cleanup?.()
      main.dataset.page = page.nombre
      actual = { page, cleanup: null }
      actual.cleanup = (await page.mount(main, ctx)) ?? null
      if (!primera && !restaurar) main.querySelector('h1')?.focus({ preventScroll: true })
    }
  } catch (e) {
    if (!esAborto(e)) throw e
  }
  if (signal.aborted) return
  if (restaurar != null) window.scrollTo(0, restaurar)
  primera = false
  SITIO.conservarTitulo = false
}

function marcarNav(path) {
  for (const a of document.querySelectorAll('.nav a')) {
    const href = a.getAttribute('href')
    const activo = href === path || (href !== '/' && path.startsWith(`${href}/`))
    if (activo) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
}

/** Push (or replace) a same-origin URL and render it. `state` rides along in history.state. */
export function navigate(to, { replace = false, state = {}, scroll = true } = {}) {
  history.replaceState({ ...history.state, y: window.scrollY }, '')
  history[replace ? 'replaceState' : 'pushState'](state, '', to)
  render().then(() => {
    if (!scroll) return
    const hash = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
    if (hash) hash.scrollIntoView()
    else if (!history.state?.pasaje) window.scrollTo(0, 0)
  })
}

document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target.closest('a[href]')
  if (!a || a.target || a.hasAttribute('download')) return
  const url = new URL(a.href)
  if (url.origin !== location.origin || url.pathname.startsWith('/graphql') || ARCHIVO.test(url.pathname)) return
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return
  e.preventDefault()
  navigate(url.pathname + url.search + url.hash, { state: a.dataset.pasaje ? { pasaje: a.dataset.pasaje } : {} })
})

/** Puts the site's name, accent, icon and footer credits on the shared shell. */
function vestir() {
  const { site } = SITIO
  const t = tema()
  const raiz = document.documentElement
  if (raiz.dataset.site !== SITIO.slug) raiz.dataset.site = SITIO.slug
  const marca = document.querySelector('.wordmark')
  if (marca.textContent !== site.name) {
    marca.textContent = site.name
    marca.setAttribute('aria-label', `${site.name}, inicio`)
  }
  document.querySelector('link[rel=icon]')?.setAttribute('href', t.icono)
  const editores = [...new Set(Object.values(DOCS).map(d => editor(d.source).largo))]
  const lista = editores.length > 1 ? `${editores.slice(0, -1).join(', ')} y ${editores[editores.length - 1]}` : editores[0]
  const pie = document.querySelector('.colophon-row')
  pie.querySelector('.colophon-warn').textContent = site.disclaimer
  pie.querySelector('.colophon-fuente').textContent = `Texto vigente publicado por ${lista}${tieneCriterios() ? '; criterios del SAT, Anexos 3 y 7 de la RMF 2026' : ''}.`
  if (site.guide && !pie.querySelector('[href="/si-te-para-un-agente"]'))
    pie.querySelector('.colophon-links').insertAdjacentHTML('afterbegin', '<a href="/si-te-para-un-agente">Si te para un agente</a>')
  if (site.uma && !pie.querySelector('.colophon-uma'))
    pie.querySelector('.colophon-links').insertAdjacentHTML(
      'beforebegin',
      html`<p class="colophon-uma">Multas en pesos con la UMA de ${pesos(site.uma.value)} vigente desde el ${fechaLargaDe(site.uma.since)} (<a href="${site.uma.source}" target="_blank" rel="noopener">${editor(site.uma.source).corto}</a>).</p>`.s,
    )
}

history.scrollRestoration = 'manual'
addEventListener('popstate', () => {
  if (location.pathname + location.search !== ultima) render({ restaurar: history.state?.y ?? 0 })
})
SITIO.conservarTitulo = !!main.querySelector(':scope > .ssr')
cargarSitio().then(
  () => {
    vestir()
    render()
  },
  e => {
    main.innerHTML = html`<section class="empty-page"><p class="kicker">Sin conexión</p><h1 tabindex="-1">No se pudo cargar el buscador</h1><div class="error" role="alert"><p class="error-title">Detalle</p><p>${e.message}</p></div><p><a class="button" href="${location.pathname + location.search}" target="_self">Reintentar</a></p></section>`
  },
)
