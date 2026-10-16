import { corto, DOCS, esc, etiqueta, familia, familiasPresentes, gql, rutaClave, ubicacionCorta } from './lib.js'

const GRAFO = `{ laws { code name articleKeys } citations { from to } }`
const UBICACION = `query Ubicacion($l: LawCode!, $n: String!) { article(law: $l, number: $n) { title location } }`
const TAU = Math.PI * 2
const HUECO = 0.011 * TAU
const ALFA = { ley: 0.16, reglamento: 0.2, reglas: 0.065 }

let datos = null

/**
 * The whole citation graph in one request: documents in reading order (each reglamento right after
 * the law it carries out, the Miscelánea last), one node per article or rule, one edge per citation.
 */
async function cargar() {
  const { laws, citations } = await gql(GRAFO)
  const porCodigo = new Map(laws.map(l => [l.code, l]))
  const orden = []
  for (const l of laws.filter(l => familia(l.code) === 'ley')) {
    orden.push(l)
    for (const r of laws) if (DOCS[r.code]?.de === l.code) orden.push(r)
  }
  for (const l of laws) if (!orden.includes(l)) orden.push(l)
  const docs = orden.map(l => {
    const fam = familia(l.code)
    return { code: l.code, nombre: l.name, fam, nodos: porCodigo.get(l.code).articleKeys.map(key => ({ key, ley: l.code, fam, loc: null, entra: [], sale: [], a: null })) }
  })
  const nodos = docs.flatMap(x => x.nodos)
  const idx = new Map(nodos.map(n => [n.key, n]))
  const aristas = []
  for (const { from, to } of citations) {
    const a = idx.get(from)
    const b = idx.get(to)
    if (!a || !b || a === b) continue
    aristas.push([a, b])
    a.sale.push(b)
    b.entra.push(a)
  }
  return { docs, nodos, aristas }
}

/** Shared, cached load of the graph (the explorer and the document matrix both read it). */
export const cargarGrafo = () =>
  (datos ??= cargar().catch(e => {
    datos = null
    throw e
  }))

/**
 * Circular citation graph on a canvas. Edges are drawn once into an offscreen layer; hovering, tapping
 * or arrow keys only paint the chosen article's edges on top, so it stays fast with thousands of edges.
 * Returns `{ setLey, destroy }`.
 */
export function montarRed(root, { navigate, ley = '' }) {
  const familias = familiasPresentes()
  const visibles = new Set(familias.map(f => f.id).filter(id => id !== 'reglas' || familias.length === 1))
  if (ley) visibles.add(familia(ley))
  root.innerHTML = `<fieldset class="net-toggles"${familias.length < 2 ? ' hidden' : ''}><legend class="filter-legend">Mostrar</legend>${familias.map(
    f => `<label class="chk"><input type="checkbox" value="${f.id}"${visibles.has(f.id) ? ' checked' : ''}><span><i data-fam="${f.id}"></i>${f.nombre}</span></label>`,
  ).join('')}</fieldset>
    <div class="net-stage"><canvas class="net-canvas" tabindex="0" role="img" aria-describedby="net-info"></canvas><p class="net-loading">Cargando artículos y citas…</p></div>
    <p class="net-info" id="net-info" aria-live="polite"></p>`
  const stage = root.querySelector('.net-stage')
  const canvas = root.querySelector('canvas')
  const info = root.querySelector('.net-info')
  const g = canvas.getContext('2d')
  const base = document.createElement('canvas')
  const gb = base.getContext('2d')
  let d = null
  let w = 0
  let foco = null
  let fijo = false
  let filtro = ley
  let pedido = 0
  let sucio = true
  let vivo = true
  let orden = []
  let arcos = []

  const geo = () => ({ cx: w / 2, cy: w / 2, r: w / 2 - (w < 480 ? 44 : 64) })
  const punto = (n, rr, { cx, cy } = geo()) => [cx + Math.cos(n.a) * rr, cy + Math.sin(n.a) * rr]
  const tintas = () => {
    const css = getComputedStyle(root)
    const v = k => css.getPropertyValue(k).trim()
    return { ink: v('--ink'), paper: v('--paper'), muted: v('--muted'), accent: v('--accent'), fam: { ley: v('--fam-ley'), reglamento: v('--fam-reglamento'), reglas: v('--fam-reglas') } }
  }
  const escala = () => (w < 480 ? 0.32 : 0.5)
  const radio = n => 0.7 + Math.sqrt(n.entra.length) * escala()

  const disponer = () => {
    for (const n of d.nodos) n.a = null
    const docs = d.docs.filter(x => visibles.has(x.fam))
    const total = docs.reduce((s, x) => s + x.nodos.length, 0)
    const paso = (TAU - HUECO * docs.length) / Math.max(1, total)
    let ang = -Math.PI / 2 + HUECO / 2
    orden = []
    arcos = docs.map(x => {
      const desde = ang
      for (const n of x.nodos) {
        n.a = ang + paso / 2
        orden.push(n)
        ang += paso
      }
      const arco = { ...x, desde, hasta: ang }
      ang += HUECO
      return arco
    })
    canvas.setAttribute('aria-label', `Red circular de ${orden.length} artículos y reglas, agrupados por documento: ${arcos.map(a => `${corto(a.code)} ${a.nodos.length}`).join(', ')}.`)
  }

  const curva = (ctx, a, b, G) => {
    const [x1, y1] = punto(a, G.r, G)
    const [x2, y2] = punto(b, G.r, G)
    let da = Math.abs(a.a - b.a)
    if (da > Math.PI) da = TAU - da
    const k = (1 - da / Math.PI) * 0.85
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo(G.cx + ((x1 + x2) / 2 - G.cx) * k, G.cy + ((y1 + y2) / 2 - G.cy) * k, x2, y2)
  }

  const rotulos = (ctx, T, G, atenuar) => {
    const borde = G.r + 2 * radio(d.maximo) + 5
    const cajas = []
    ctx.font = `600 ${w < 480 ? 10.5 : 12}px "Schibsted Grotesk", sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (const arco of arcos) {
      const fuera = atenuar && filtro && filtro !== arco.code
      ctx.strokeStyle = T.fam[arco.fam]
      ctx.globalAlpha = fuera ? 0.3 : 0.95
      ctx.lineWidth = arco.code === filtro ? 3 : 1.25
      ctx.beginPath()
      ctx.arc(G.cx, G.cy, borde, arco.desde + 0.003, Math.max(arco.desde + 0.006, arco.hasta - 0.003))
      ctx.stroke()
      const medio = (arco.desde + arco.hasta) / 2
      const c = Math.cos(medio)
      const tw = ctx.measureText(arco.code).width
      for (const extra of [10, 24, 38, 52]) {
        const lx = G.cx + c * (borde + extra)
        const ly = G.cy + Math.sin(medio) * (borde + extra)
        const x0 = Math.max(2, Math.min(w - 2 - tw, Math.abs(c) < 0.2 ? lx - tw / 2 : c > 0 ? lx : lx - tw))
        const caja = { x: x0 - 3, y: ly - 8, w: tw + 6, h: 16 }
        if (extra < 52 && cajas.some(o => caja.x < o.x + o.w && o.x < caja.x + caja.w && caja.y < o.y + o.h && o.y < caja.y + caja.h)) continue
        cajas.push(caja)
        ctx.globalAlpha = fuera ? 0.4 : 1
        ctx.fillStyle = arco.code === filtro ? T.accent : T.ink
        ctx.fillText(arco.code, x0, ly)
        break
      }
    }
    ctx.globalAlpha = 1
  }

  const pintarBase = T => {
    const dpr = window.devicePixelRatio || 1
    base.width = w * dpr
    base.height = w * dpr
    gb.setTransform(dpr, 0, 0, dpr, 0, 0)
    gb.clearRect(0, 0, w, w)
    const G = geo()
    const fuera = []
    const dentro = []
    for (const e of d.aristas) {
      const [a, b] = e
      if (a.a == null || b.a == null) continue
      if (!filtro || a.ley === filtro || b.ley === filtro) dentro.push(e)
      else fuera.push(e)
    }
    gb.lineWidth = w < 480 ? 0.5 : 0.7
    const escasez = Math.min(4, Math.max(1, Math.sqrt(1800 / Math.max(1, dentro.length))))
    for (const [lista, alfa] of [
      [fuera, () => 0.025],
      [dentro, fam => Math.min(0.7, (filtro ? ALFA[fam] * 2.5 : ALFA[fam]) * escasez)],
    ]) {
      lista.sort((x, y) => (x[0].fam < y[0].fam ? -1 : x[0].fam > y[0].fam ? 1 : 0))
      let fam = null
      for (const [a, b] of lista) {
        if (a.fam !== fam) {
          fam = a.fam
          gb.strokeStyle = T.fam[fam]
          gb.globalAlpha = alfa(fam)
        }
        gb.beginPath()
        curva(gb, a, b, G)
        gb.stroke()
      }
    }
    for (const n of orden) {
      const rad = radio(n)
      const [x, y] = punto(n, G.r + rad + 1.5, G)
      gb.globalAlpha = filtro && n.ley !== filtro ? 0.18 : 0.6
      gb.fillStyle = T.fam[n.fam]
      gb.beginPath()
      gb.arc(x, y, rad, 0, TAU)
      gb.fill()
    }
    gb.globalAlpha = 1
    rotulos(gb, T, G, true)
    sucio = false
  }

  const dibujar = () => {
    pedido = 0
    if (!d || !w) return
    const T = tintas()
    if (sucio) pintarBase(T)
    const dpr = window.devicePixelRatio || 1
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(base, 0, 0)
    if (!foco || foco.a == null) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const G = geo()
    g.globalAlpha = 0.78
    g.fillStyle = T.paper
    g.fillRect(0, 0, w, w)
    const entra = foco.entra.filter(n => n.a != null)
    const sale = foco.sale.filter(n => n.a != null)
    g.lineWidth = 1
    g.globalAlpha = 0.55
    g.strokeStyle = T.ink
    for (const n of entra) {
      g.beginPath()
      curva(g, n, foco, G)
      g.stroke()
    }
    g.lineWidth = 1.4
    g.globalAlpha = 0.85
    g.strokeStyle = T.accent
    for (const n of sale) {
      g.beginPath()
      curva(g, foco, n, G)
      g.stroke()
    }
    for (const n of [...entra, ...sale, foco]) {
      const rad = radio(n) + (n === foco ? 1.5 : 0)
      const [x, y] = punto(n, G.r + radio(n) + 1.5, G)
      g.globalAlpha = 1
      g.fillStyle = n === foco || sale.includes(n) ? T.accent : T.fam[n.fam]
      g.beginPath()
      g.arc(x, y, rad, 0, TAU)
      g.fill()
    }
    rotulos(g, T, G, false)
    const texto = etiqueta(foco.key)
    g.font = `600 ${w < 480 ? 11 : 12}px "Schibsted Grotesk", sans-serif`
    const tw = g.measureText(texto).width
    const c = Math.cos(foco.a)
    const [fx, fy] = punto(foco, G.r - 14, G)
    const x0 = Math.max(2, Math.min(w - 2 - tw, c > 0.2 ? fx - tw : c < -0.2 ? fx : fx - tw / 2))
    g.globalAlpha = 1
    g.fillStyle = T.paper
    g.fillRect(x0 - 4, fy - 9, tw + 8, 18)
    g.fillStyle = T.accent
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    g.fillText(texto, x0, fy)
  }
  const pintar = () => {
    if (!pedido) pedido = requestAnimationFrame(dibujar)
  }
  const rehacer = () => {
    sucio = true
    pintar()
  }

  let espera = 0
  const ubicar = n => {
    if (n.loc != null || n.pidiendo) return
    clearTimeout(espera)
    espera = setTimeout(() => {
      const i = n.key.indexOf(':')
      n.pidiendo = true
      gql(UBICACION, { l: n.key.slice(0, i), n: n.key.slice(i + 1) })
        .then(r => (n.loc = r.article?.title ?? ubicacionCorta(r.article?.location ?? [])))
        .catch(() => (n.loc = ''))
        .finally(() => {
          n.pidiendo = false
          if (vivo && foco === n) describir()
        })
    }, 120)
  }

  const describir = () => {
    if (!d) return
    if (!foco) {
      const regla = Object.values(DOCS).some(x => x.familia === 'reglas')
      info.innerHTML = `<span class="muted">Cada punto es ${regla ? 'un artículo o una regla' : 'un artículo'}; crece con las citas que recibe. Pasa el cursor o toca un punto. Con el teclado, usa las flechas y Enter.</span>`
      return
    }
    ubicar(foco)
    const vis = n => n.a != null
    info.innerHTML = `<strong class="net-key">${esc(etiqueta(foco.key))}</strong><span class="muted">${esc(corto(foco.ley))}</span><span class="net-loc">${foco.loc == null ? '…' : esc(foco.loc)}</span><span class="net-counts"><span class="net-out">Cita ${foco.sale.length}</span><span class="net-in">Lo citan ${foco.entra.length}</span>${foco.sale.some(n => !vis(n)) || foco.entra.some(n => !vis(n)) ? '<span class="muted">(algunas, en documentos ocultos)</span>' : ''}</span><a class="net-open" href="${rutaClave(foco.key)}">Abrir</a>`
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
    for (const n of orden) {
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
    if (!d || !orden.length) return
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
    if (!foco && d) elegir(orden.reduce((m, n) => (n.entra.length > m.entra.length ? n : m), orden[0]), true)
  })
  root.querySelector('.net-toggles').addEventListener('change', e => {
    if (e.target.checked) visibles.add(e.target.value)
    else visibles.delete(e.target.value)
    if (!visibles.size) {
      visibles.add(e.target.value)
      e.target.checked = true
    }
    if (!d) return
    disponer()
    if (foco?.a == null) elegir(null, false)
    rehacer()
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
    rehacer()
  }
  const ro = new ResizeObserver(medir)
  ro.observe(stage)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', rehacer)
  medir()

  cargarGrafo().then(
    x => {
      if (!vivo) return
      d = { ...x, maximo: x.nodos.reduce((m, n) => (n.entra.length > m.entra.length ? n : m)) }
      root.querySelector('.net-loading')?.remove()
      disponer()
      describir()
      rehacer()
    },
    e => {
      if (!vivo) return
      root.querySelector('.net-loading').textContent = `No se pudo cargar la red: ${e.message}`
    },
  )

  return {
    setLey(l) {
      filtro = l
      if (l && !visibles.has(familia(l))) {
        visibles.add(familia(l))
        root.querySelector(`.net-toggles input[value="${familia(l)}"]`).checked = true
        if (d) disponer()
      }
      rehacer()
    },
    destroy() {
      vivo = false
      clearTimeout(espera)
      ro.disconnect()
      mq.removeEventListener('change', rehacer)
      if (pedido) cancelAnimationFrame(pedido)
    },
  }
}
