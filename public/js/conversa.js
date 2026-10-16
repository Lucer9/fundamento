import { anunciar, asistente, citasHtml, DOCS, esAborto, etiqueta, html, modeloBonito, raw, ruta, SITIO, tieneCriterios, TIPO_CRITERIO } from './lib.js'

/** Questions per conversation; the Worker accepts 12 messages. */
const MAX_PREGUNTAS = 6
/** Milliseconds between words while an answer is revealed. */
const RITMO = 34

const ico = nombre => raw(`<span class="ico ico--${nombre}" aria-hidden="true"></span>`)

/** Conversations by their first question, so going back to a search brings its conversation back. */
const hilos = new Map()
let actual = ''
let panel = null
let control = null
let escribiendo = false
let detenido = false

const leer = k => {
  try {
    return JSON.parse(sessionStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}
const escribir = (k, v) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(v))
  } catch {}
}

const hiloDe = q => {
  if (!hilos.has(q)) hilos.set(q, leer(`hilo:${q}`) ?? [{ role: 'user', content: q }])
  return hilos.get(q)
}
const guardarHilo = q => escribir(`hilo:${q}`, hiloDe(q).filter(m => m.role === 'user' || m.listo))
const guardarEstado = () => escribir('ia', { actual, abierto: abierto() })

/** Server-sent events from a fetch response, as `{ event, data }` with `data` parsed from JSON. */
export async function* eventos(res) {
  const lector = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await lector.read()
    if (done) return
    buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    let corte
    while ((corte = buf.indexOf('\n\n')) >= 0) {
      const bloque = buf.slice(0, corte)
      buf = buf.slice(corte + 2)
      let event = 'message'
      const datos = []
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event:')) event = linea.slice(6).trim()
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''))
      }
      if (datos.length) yield { event, data: JSON.parse(datos.join('\n')) }
    }
  }
}

/** One turn from /chat: streams the text through `alTexto` and resolves to the finished answer's sources. */
async function preguntarApi(mensajes, signal, alTexto) {
  let res
  try {
    res = await fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: mensajes.map(({ role, content }) => ({ role, content })) }),
      signal,
    })
  } catch (e) {
    if (esAborto(e)) throw e
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.')
  }
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null)
    throw new Error(cuerpo?.message || `El servidor respondió con un error (${res.status}).`)
  }
  let texto = ''
  for await (const { event, data } of eventos(res)) {
    if (event === 'delta') alTexto((texto += data.text))
    else if (event === 'error') throw new Error(data.message)
    else if (event === 'fin') return { sources: data.sources ?? [], criteria: data.criteria ?? [], model: data.model, cached: !!data.cached }
  }
  throw new Error('La respuesta se cortó antes de terminar. Inténtalo de nuevo.')
}

/** "LISR:27" for a source as GraphQL (`{ key, number, law: { code } }`) or /chat (`{ law: "LISR", number }`) sends it. */
export const claveDe = s => `${s.law?.code ?? s.law}:${s.number}`

const clavesCitadas = texto =>
  [...texto.matchAll(/[\[【]([^\]】]+)[\]】]/g)].flatMap(m =>
    m[1].split(/[,;]\s*/).flatMap(r => {
      const x = r.trim().match(/^([A-Z]{2,8})\s+(\d[\w.-]*)$/)
      return x && DOCS[x[1]] ? [`${x[1]}:${x[2]}`] : []
    }),
  )

const citadasEn = hilo => [...new Set(hilo.filter(m => m.role === 'assistant' && m.listo).flatMap(m => [...clavesCitadas(m.content), ...(m.sources ?? []).map(claveDe)]))]

/** The articles the conversation that began with `q` has cited so far. */
export const citasDe = q => (q && (hilos.has(q) || leer(`hilo:${q}`)) ? citadasEn(hiloDe(q)) : [])

/** Tells the page which articles a conversation cites, so a results page for the same question can mark them. */
const avisarCitas = q => document.dispatchEvent(new CustomEvent('citas', { detail: { q, claves: citasDe(q) } }))

const fuentesHtml = m =>
  m.sources?.length
    ? html`<p class="answer-sources"><span class="label">Fuentes</span> ${m.sources.map(s => {
        const [ley, n] = claveDe(s).split(':')
        return html`<a href="${ruta(ley, n)}" title="${DOCS[ley]?.nombre ?? ley}">${etiqueta(`${ley}:${n}`)}</a>`
      })}</p>`
    : ''

const criteriosHtml = m =>
  m.criteria?.length
    ? html`<div class="answer-crit"><p class="label">Criterios del SAT citados</p><ul>${m.criteria.map(
        c => html`<li id="sat-${c.number}" tabindex="-1"><span class="answer-crit-meta">${TIPO_CRITERIO[c.kind] ?? 'Criterio'}${c.id ? html` · <span class="crit-id">${c.id}</span>` : ''}</span><span class="answer-crit-title">${c.title}</span></li>`,
      )}</ul></div>`
    : ''

/** While an answer is still arriving, an unmatched "**" would show as asterisks: hold it back. */
const aMedias = t => ((t.match(/\*\*/g) ?? []).length % 2 ? t.slice(0, t.lastIndexOf('**')) : t)

function turnoHtml(m) {
  if (m.role === 'user') return html`<div class="turno turno--tu"><p>${m.content}</p></div>`
  if (m.error)
    return html`<div class="turno turno--ia"><p class="answer-error" role="status">${m.error}</p><button class="button button--quiet conversa-retry" type="button">Volver a intentar</button></div>`
  if (!m.content)
    return html`<div class="turno turno--ia"><p class="answer-wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Leyendo los artículos…</p></div>`
  return html`<article class="turno turno--ia${m.listo ? '' : ' is-escribiendo'}"><div class="answer-text">${citasHtml(m.listo ? m.content : aMedias(m.content), m.criteria ?? [])}</div>${
    m.listo ? html`${m.detenida ? html`<p class="turno-detenida">Detuviste esta respuesta.</p>` : ''}${fuentesHtml(m)}${criteriosHtml(m)}` : ''
  }</article>`
}

const inicioHtml = () =>
  html`<div class="panel-inicio">
    <p>Pregúntame lo que quieras ${SITIO.site.guide ? 'del reglamento' : 'de impuestos'}. Te respondo con los artículos, y la ley se abre a un lado.</p>
    <ul>${SITIO.site.examples.slice(0, 3).map(q => html`<li><button type="button" class="panel-ejemplo" data-pregunta="${q}">${q}</button></li>`)}</ul>
  </div>`

const $ = sel => panel.querySelector(sel)
const abierto = () => !!panel && !$('.panel-ia').hidden

function pintar() {
  const hilo = actual ? hiloDe(actual) : []
  $('[data-slot=hilo]').innerHTML = hilo.length ? hilo.map(turnoHtml).join('') : String(inicioHtml())
  const ultima = [...hilo].reverse().find(m => m.role === 'assistant' && m.listo && m.model)
  $('[data-slot=nota]').textContent = ultima
    ? `Respuestas escritas con IA (${modeloBonito(ultima.model).split(' ')[0]}) a partir de los artículos${tieneCriterios() ? ' y criterios' : ''} citados. Pueden equivocarse: revisa las fuentes.`
    : ''
  const lleno = hilo.filter(m => m.role === 'user').length >= MAX_PREGUNTAS
  const campo = $('textarea')
  campo.disabled = lleno
  campo.placeholder = lleno ? 'Para seguir, empieza una conversación nueva.' : hilo.length ? 'Sigue preguntando…' : 'Escribe tu pregunta…'
  const boton = $('.conversa-form .ask-go')
  boton.innerHTML = String(escribiendo ? ico('alto') : ico('flecha'))
  boton.setAttribute('aria-label', escribiendo ? 'Detener la respuesta' : 'Enviar')
  boton.classList.toggle('is-alto', escribiendo)
  boton.disabled = lleno && !escribiendo
  $('[data-accion=nueva]').hidden = !hilo.length
  panel.querySelector('.panel-ia-abrir-texto').innerHTML = String(hilo.length ? html`Volver con ${raw(asistente().html)}` : html`Pregúntale a ${raw(asistente().html)}`)
}

/** Brings an element to the top of the conversation. */
const mostrar = el => {
  const caja = $('[data-slot=hilo]')
  if (el) caja.scrollTop += el.getBoundingClientRect().top - caja.getBoundingClientRect().top - 12
}

/** Answers the conversation's last question: streams it from /chat and reveals it word by word. */
async function responder() {
  const q = actual
  const hilo = hiloDe(q)
  const turno = { role: 'assistant', content: '' }
  hilo.push(turno)
  control?.abort()
  control = new AbortController()
  const { signal } = control
  detenido = false
  escribiendo = true
  pintar()
  mostrar($('[data-slot=hilo]').lastElementChild?.previousElementSibling)
  const ultimo = () => (actual === q ? $('[data-slot=hilo]').lastElementChild : null)

  let llegado = ''
  let reloj = 0
  let completo = false
  let alTerminar = () => {}
  const termino = new Promise(r => (alTerminar = r))
  const paso = () => {
    const falta = llegado.length - turno.content.length
    if (falta > 0) {
      const resto = llegado.slice(turno.content.length)
      let corte = 0
      for (let k = 0, n = falta > 900 ? 6 : falta > 300 ? 3 : 1; k < n; k++) {
        const m = resto.slice(corte).match(/^\s*(\[[^\]]*\]|\*\*|\S+)\s*/)
        if (!m) break
        corte += m[0].length
      }
      turno.content = llegado.slice(0, turno.content.length + (corte || falta))
      const el = ultimo()
      if (el) el.outerHTML = String(turnoHtml(turno))
    }
    if (completo && turno.content.length >= llegado.length) return alTerminar()
    reloj = setTimeout(paso, RITMO)
  }
  reloj = setTimeout(paso, RITMO)

  try {
    const fin = await preguntarApi(hilo.slice(0, -1), signal, texto => (llegado = texto))
    completo = true
    await termino
    Object.assign(turno, fin, { content: llegado, listo: true })
    guardarHilo(q)
    avisarCitas(q)
    anunciar(`${asistente().nombre} respondió.`)
  } catch (e) {
    clearTimeout(reloj)
    if (!esAborto(e)) Object.assign(turno, { error: e.message })
    else if (detenido && turno.content) {
      Object.assign(turno, { listo: true, detenida: true, sources: [], criteria: [] })
      guardarHilo(q)
    } else hilo.splice(hilo.indexOf(turno), 1)
  } finally {
    if (actual === q) {
      escribiendo = false
      pintar()
    }
  }
}

function abrir({ enfocar = false } = {}) {
  $('.panel-ia').hidden = false
  $('.panel-ia-abrir').hidden = true
  document.body.classList.add('ia-abierta')
  guardarEstado()
  if (enfocar) $('textarea').focus({ preventScroll: true })
}

function cerrar() {
  $('.panel-ia').hidden = true
  $('.panel-ia-abrir').hidden = false
  document.body.classList.remove('ia-abierta')
  guardarEstado()
  $('.panel-ia-abrir').focus({ preventScroll: true })
}

/**
 * Asks `q` in the assistant's pane: a search's question becomes the first message of its own conversation, or brings
 * that conversation back if it already exists. Opens the pane; the law stays in the page beside it.
 */
export function preguntar(q) {
  if (!panel || !q) return
  if (actual !== q) {
    if (escribiendo) control?.abort()
    escribiendo = false
    actual = q
  }
  abrir()
  const hilo = hiloDe(q)
  pintar()
  if (hilo[hilo.length - 1].role === 'user' && !escribiendo) responder()
  else avisarCitas(q)
}

/** Mounts the assistant once, as a pane beside every page; it survives navigation, and its box is the site's one question box. */
export function iniciarConversa() {
  if (panel) return
  const yo = asistente()
  panel = document.createElement('div')
  panel.className = 'panel-ia-raiz'
  panel.innerHTML = String(html`<button class="panel-ia-abrir" type="button" aria-controls="panel-ia">
      ${ico('chat')}<span class="panel-ia-abrir-texto"></span>
    </button>
    <aside class="panel-ia conversa" id="panel-ia" aria-label="Conversación con ${yo.nombre}" hidden>
      <header class="conversa-head">
        <div class="conversa-titulo"><h2 class="conversa-nombre">${raw(yo.html)}</h2><p class="conversa-aviso">${yo.aviso}</p></div>
        <div class="panel-acciones">
          <button class="panel-boton" type="button" data-accion="nueva" title="Pregunta nueva">${ico('nueva')}<span>Nueva</span></button>
          <button class="panel-boton" type="button" data-accion="cerrar" aria-label="Ocultar la conversación" title="Ocultar">${ico('cerrar')}</button>
        </div>
      </header>
      <div class="conversa-hilo" data-slot="hilo"></div>
      <p class="conversa-nota" data-slot="nota"></p>
      <form class="conversa-form" novalidate>
        <label class="sr-only" for="sigue">Tu pregunta para ${yo.nombre}</label>
        <textarea id="sigue" name="sigue" rows="1" maxlength="500" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        <button class="ask-go" type="submit" aria-label="Enviar">${ico('flecha')}</button>
      </form>
    </aside>`)
  document.body.append(panel)

  const campo = $('textarea')
  const crecer = () => {
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, 160)}px`
  }
  campo.addEventListener('input', crecer)
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      $('form').requestSubmit()
    }
  })
  $('form').addEventListener('submit', e => {
    e.preventDefault()
    if (escribiendo) {
      detenido = true
      control?.abort()
      return
    }
    const texto = campo.value.replace(/\s+/g, ' ').trim()
    if (!texto) return campo.focus()
    campo.value = ''
    crecer()
    if (!actual) return document.dispatchEvent(new CustomEvent('navegar', { detail: `/?${new URLSearchParams({ q: texto })}` }))
    const hilo = hiloDe(actual)
    if (hilo.filter(m => m.role === 'user').length >= MAX_PREGUNTAS) return
    hilo.push({ role: 'user', content: texto })
    responder()
  })
  $('.panel-ia-abrir').addEventListener('click', () => {
    pintar()
    abrir({ enfocar: !actual })
  })
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-accion], .panel-ejemplo, .conversa-retry')
    if (!b) return
    if (b.dataset.accion === 'cerrar') return cerrar()
    if (b.dataset.accion === 'nueva') {
      if (escribiendo) control?.abort()
      escribiendo = false
      actual = ''
      guardarEstado()
      pintar()
      return campo.focus()
    }
    if (b.dataset.pregunta) return document.dispatchEvent(new CustomEvent('navegar', { detail: `/?${new URLSearchParams({ q: b.dataset.pregunta })}` }))
    if (b.classList.contains('conversa-retry') && !escribiendo) {
      const hilo = hiloDe(actual)
      hilo.splice(0, hilo.length, ...hilo.filter(m => !m.error))
      responder()
    }
  })
  panel.addEventListener('keydown', e => e.key === 'Escape' && abierto() && matchMedia('(max-width: 1099px)').matches && cerrar())
  const resaltar = (e, on) => {
    const a = e.target.closest('.cite[href], .answer-sources a[href]')
    if (!a) return
    const [, ley, n] = decodeURIComponent(new URL(a.href).pathname).split('/')
    document.dispatchEvent(new CustomEvent('resaltar', { detail: { clave: `${ley}:${n}`, on } }))
  }
  panel.addEventListener('mouseover', e => resaltar(e, true))
  panel.addEventListener('mouseout', e => resaltar(e, false))
  panel.addEventListener('focusin', e => resaltar(e, true))
  panel.addEventListener('focusout', e => resaltar(e, false))
  panel.addEventListener('click', e => {
    if (e.target.closest('a[href^="/"]') && matchMedia('(max-width: 1099px)').matches) cerrar()
  })

  const previo = leer('ia')
  actual = previo?.actual ?? ''
  pintar()
  if (previo?.abierto && actual) {
    abrir()
    const hilo = hiloDe(actual)
    if (hilo[hilo.length - 1].role === 'user') responder()
  }
}
