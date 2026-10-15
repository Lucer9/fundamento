import { esAborto, html } from './lib.js'

const main = document.getElementById('main')
const LEY = /^\/(LISR|LIVA|CFF)\/([^/]+)\/?$/i

const rutas = [
  { test: p => p === '/', page: () => import('./buscar.js') },
  { test: p => LEY.test(p), page: () => import('./articulo.js') },
  { test: p => p === '/explorar', page: () => import('./explorar.js') },
  { test: p => p === '/como-funciona', page: () => import('./metodo.js') },
]

let actual = null
let control = null
let primera = true
let ultima = ''

const noEncontrada = {
  nombre: '404',
  mount(el) {
    document.title = 'Página no encontrada · fundamento'
    el.innerHTML = html`<section class="empty-page">
      <p class="kicker">Error 404</p>
      <h1 tabindex="-1">Esta página no existe</h1>
      <p class="deck">Puede que el enlace esté mal escrito. Los artículos viven en direcciones como <a href="/LISR/27">/LISR/27</a> o <a href="/CFF/29-A">/CFF/29-A</a>.</p>
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
  const ctx = { url, params: url.searchParams, match: url.pathname.match(LEY), state: history.state ?? {}, signal, navigate }
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
}

function marcarNav(path) {
  for (const a of document.querySelectorAll('.nav a')) {
    const activo = a.getAttribute('href') === path || (a.getAttribute('href') === '/' && path === '/')
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
  if (url.origin !== location.origin || url.pathname.startsWith('/graphql') || /\.\w+$/.test(url.pathname)) return
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return
  e.preventDefault()
  navigate(url.pathname + url.search + url.hash, { state: a.dataset.pasaje ? { pasaje: a.dataset.pasaje } : {} })
})

history.scrollRestoration = 'manual'
addEventListener('popstate', () => {
  if (location.pathname + location.search !== ultima) render({ restaurar: history.state?.y ?? 0 })
})
render()
