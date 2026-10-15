import { esc, gql, numero, rutaClave, ubicacionCorta } from './lib.js'

const PAGE = `query Red($c: LawCode!, $a: String) {
  law(code: $c) { articles(first: 100, after: $a) { nodes { key location cites { key } } pageInfo { endCursor hasNextPage } } }
}`
const ORDEN = ['LISR', 'LIVA', 'CFF']
const TAU = Math.PI * 2
const HUECO = 0.045 * TAU

let datos = null

async function cargar() {
  const porLey = await Promise.all(
    ORDEN.map(async c => {
      const nodes = []
      let after = null
      do {
        const { law } = await gql(PAGE, { c, a: after })
        nodes.push(...law.articles.nodes)
        after = law.articles.pageInfo.hasNextPage ? law.articles.pageInfo.endCursor : null
      } while (after)
      return nodes
    }),
  )
  const nodos = porLey.flat().map(n => ({ key: n.key, ley: n.key.split(':')[0], loc: ubicacionCorta(n.location), cites: n.cites.map(c => c.key), entra: [], sale: [] }))
  const idx = new Map(nodos.map(n => [n.key, n]))
  const aristas = []
  for (const n of nodos) {
    for (const k of new Set(n.cites)) {
      const t = idx.get(k)
      if (!t || t === n) continue
      aristas.push([n, t])
      n.sale.push(t)
      t.entra.push(n)
    }
  }
  const paso = (TAU - HUECO * ORDEN.length) / nodos.length
  let ang = -Math.PI / 2 + HUECO / 2
  const arcos = ORDEN.map((c, j) => {
    const desde = ang
    for (const n of nodos.filter(n => n.ley === c)) {
      n.a = ang + paso / 2
      ang += paso
    }
    const arco = { c, n: porLey[j].length, desde, hasta: ang }
    ang += HUECO
    return arco
  })
  return { nodos, aristas, arcos, maximo: nodos.reduce((m, n) => (n.entra.length > m.entra.length ? n : m)) }
}

/**
 * Circular citation graph on a canvas: articles sit on the rim in law order, citations are chords.
 * Hover or arrow keys pick an article, click or Enter opens it. Returns `{ setLey, destroy }`.
 */
export function montarRed(root, { navigate, ley = '' }) {
  root.innerHTML = `<div class="net-stage"><canvas class="net-canvas" tabindex="0" role="img" aria-describedby="net-info"></canvas><p class="net-loading">Cargando artículos y citas…</p></div>
    <p class="net-info" id="net-info" aria-live="polite"></p>`
  const stage = root.querySelector('.net-stage')
  const canvas = root.querySelector('canvas')
  const info = root.querySelector('.net-info')
  const g = canvas.getContext('2d')
  let d = null
  let w = 0
  let foco = null
  let fijo = false
  let filtro = ley
  let pedido = 0
  let vivo = true

  const geo = () => {
    const r = w / 2 - (w < 480 ? 40 : 60)
    return { cx: w / 2, cy: w / 2, r }
  }
  const punto = (n, rr, { cx, cy } = geo()) => [cx + Math.cos(n.a) * rr, cy + Math.sin(n.a) * rr]

  const dibujar = () => {
    pedido = 0
    if (!d || !w) return
    const css = getComputedStyle(root)
    const tinta = css.getPropertyValue('--ink').trim()
    const acento = css.getPropertyValue('--accent').trim()
    const suave = css.getPropertyValue('--muted').trim()
    const dpr = window.devicePixelRatio || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, w)
    const G = geo()
    const { cx, cy, r } = G

    const grupos = new Map()
    const meter = (estilo, e) => (grupos.get(estilo) ?? grupos.set(estilo, []).get(estilo)).push(e)
    for (const e of d.aristas) {
      const [a, b] = e
      const cruza = a.ley !== b.ley
      if (foco) {
        if (a === foco) meter('sale', e)
        else if (b === foco) meter('entra', e)
        else meter('fondo', e)
      } else if (filtro && a.ley !== filtro && b.ley !== filtro) meter('fondo', e)
      else meter(cruza ? 'cruza' : 'misma', e)
    }
    const ESTILO = {
      fondo: [tinta, foco || filtro ? 0.035 : 0.08, 0.6],
      misma: [tinta, filtro ? 0.16 : 0.11, 0.7],
      cruza: [acento, filtro ? 0.55 : 0.4, 0.8],
      entra: [tinta, 0.75, 1.1],
      sale: [acento, 0.95, 1.4],
    }
    for (const k of ['fondo', 'misma', 'cruza', 'entra', 'sale']) {
      const lista = grupos.get(k)
      if (!lista) continue
      const [color, alfa, ancho] = ESTILO[k]
      g.strokeStyle = color
      g.globalAlpha = alfa
      g.lineWidth = ancho
      g.beginPath()
      for (const [a, b] of lista) {
        const [x1, y1] = punto(a, r, G)
        const [x2, y2] = punto(b, r, G)
        let da = Math.abs(a.a - b.a)
        if (da > Math.PI) da = TAU - da
        const k2 = 1 - da / Math.PI
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        g.moveTo(x1, y1)
        g.quadraticCurveTo(cx + (mx - cx) * k2 * 0.85, cy + (my - cy) * k2 * 0.85, x2, y2)
      }
      g.stroke()
    }

    const vecinos = foco ? new Set([...foco.entra, ...foco.sale]) : null
    const escala = w < 480 ? 0.45 : 0.7
    const radio = n => 0.9 + Math.sqrt(n.entra.length) * escala
    const borde = r + 2 * radio(d.maximo) + 6
    for (const n of d.nodos) {
      const atenuado = (vecinos && n !== foco && !vecinos.has(n)) || (!foco && filtro && n.ley !== filtro)
      const rad = radio(n)
      const [x, y] = punto(n, r + rad + 1.5, G)
      g.globalAlpha = atenuado ? 0.15 : n === foco ? 1 : 0.55
      g.fillStyle = n === foco || (vecinos && foco.sale.includes(n)) ? acento : tinta
      g.beginPath()
      g.arc(x, y, n === foco ? rad + 1.5 : rad, 0, TAU)
      g.fill()
    }

    g.globalAlpha = 1
    g.font = `600 ${w < 480 ? 11 : 12}px "Schibsted Grotesk", sans-serif`
    if (foco) {
      const [ley, num] = foco.key.split(':')
      const texto = `${ley} ${numero(num)}`
      const c = Math.cos(foco.a)
      const [fx, fy] = punto(foco, borde + 10, G)
      const tw = g.measureText(texto).width
      const x0 = Math.max(2, Math.min(w - 2 - tw, c > 0.2 ? fx : c < -0.2 ? fx - tw : fx - tw / 2))
      g.fillStyle = getComputedStyle(root).getPropertyValue('--paper').trim()
      g.fillRect(x0 - 4, fy - 9, tw + 8, 18)
      g.fillStyle = acento
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      g.fillText(texto, x0, fy)
    }
    g.textBaseline = 'middle'
    for (const arco of d.arcos) {
      const medio = (arco.desde + arco.hasta) / 2
      g.strokeStyle = filtro && filtro !== arco.c ? suave : tinta
      g.globalAlpha = filtro && filtro !== arco.c ? 0.35 : 0.9
      g.lineWidth = 1
      g.beginPath()
      g.arc(cx, cy, borde, arco.desde + 0.004, arco.hasta - 0.004)
      g.stroke()
      const lx = cx + Math.cos(medio) * (borde + 10)
      const ly = cy + Math.sin(medio) * (borde + 10)
      const tw = g.measureText(arco.c).width
      const c = Math.cos(medio)
      const x0 = Math.abs(c) < 0.2 ? lx - tw / 2 : c > 0 ? lx : lx - tw
      g.fillStyle = filtro && filtro !== arco.c ? suave : tinta
      g.textAlign = 'left'
      g.fillText(arco.c, Math.max(2, Math.min(w - 2 - tw, x0)), ly)
    }
    g.globalAlpha = 1
  }
  const pintar = () => {
    if (!pedido) pedido = requestAnimationFrame(dibujar)
  }

  const describir = () => {
    if (!d) return
    if (!foco) {
      info.innerHTML = `<span class="muted">Cada punto es un artículo; su tamaño crece con las citas que recibe. Pasa el cursor o toca un punto. Con el teclado, usa las flechas y Enter.</span>`
      return
    }
    const [ley, n] = foco.key.split(':')
    info.innerHTML = `<strong class="net-key">${esc(`${ley} ${numero(n)}`)}</strong>${foco.loc ? ` <span class="muted">${esc(foco.loc)}</span>` : ''}<span class="net-counts"><span class="net-out">Cita ${foco.sale.length}</span><span class="net-in">Lo citan ${foco.entra.length}</span></span><a class="net-open" href="${rutaClave(foco.key)}">Abrir artículo</a>`
  }

  const elegir = (n, pin = fijo) => {
    if (n === foco && pin === fijo) return
    foco = n
    fijo = pin && !!n
    describir()
    pintar()
  }

  const cercano = ev => {
    if (!d) return null
    const rect = canvas.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const { cx, cy, r } = geo()
    const dist = Math.hypot(x - cx, y - cy)
    if (dist < r * 0.55 || dist > r + 30) return null
    const ang = Math.atan2(y - cy, x - cx)
    let best = null
    let bd = Infinity
    for (const n of d.nodos) {
      let da = Math.abs(n.a - ang)
      if (da > Math.PI) da = TAU - da
      if (da < bd) {
        bd = da
        best = n
      }
    }
    return bd * dist < 14 ? best : null
  }

  canvas.addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse' || fijo) return
    const n = cercano(ev)
    canvas.style.cursor = n ? 'pointer' : 'default'
    elegir(n, false)
  })
  canvas.addEventListener('pointerleave', ev => {
    if (ev.pointerType === 'mouse' && !fijo) elegir(null, false)
  })
  canvas.addEventListener('click', ev => {
    const n = cercano(ev)
    if (ev.pointerType === 'mouse') {
      if (n) navigate(rutaClave(n.key))
      return
    }
    elegir(n, !!n)
  })
  canvas.addEventListener('keydown', ev => {
    if (!d) return
    const orden = d.nodos
    const i = foco ? orden.indexOf(foco) : -1
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') elegir(orden[(i + 1) % orden.length], true)
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') elegir(orden[(i - 1 + orden.length) % orden.length], true)
    else if (ev.key === 'Home') elegir(orden[0], true)
    else if (ev.key === 'End') elegir(orden[orden.length - 1], true)
    else if (ev.key === 'Enter' && foco) navigate(rutaClave(foco.key))
    else if (ev.key === 'Escape') elegir(null, false)
    else return
    ev.preventDefault()
  })
  canvas.addEventListener('focus', () => {
    if (!foco && d) elegir(d.maximo, true)
  })

  const medir = () => {
    const nw = Math.round(Math.min(stage.clientWidth, 760))
    if (!nw || nw === w) return
    w = nw
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = w * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${w}px`
    pintar()
  }
  const ro = new ResizeObserver(medir)
  ro.observe(stage)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', pintar)
  medir()

  datos ??= cargar().catch(e => {
    datos = null
    throw e
  })
  datos.then(
    x => {
      if (!vivo) return
      d = x
      root.querySelector('.net-loading')?.remove()
      canvas.setAttribute('aria-label', `Red circular de ${d.nodos.length} artículos y ${d.aristas.length} citas entre ellos, agrupados por ley: ${d.arcos.map(a => `${a.c} ${a.n}`).join(', ')}.`)
      describir()
      pintar()
    },
    e => {
      if (!vivo) return
      root.querySelector('.net-loading').textContent = `No se pudo cargar la red: ${e.message}`
    },
  )

  return {
    setLey(l) {
      filtro = l
      pintar()
    },
    destroy() {
      vivo = false
      ro.disconnect()
      mq.removeEventListener('change', pintar)
      if (pedido) cancelAnimationFrame(pedido)
    },
  }
}
