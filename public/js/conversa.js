import { anunciar, asistente, citasHtml, DOCS, esAborto, etiqueta, html, modeloBonito, raw, ruta, tieneCriterios, TIPO_CRITERIO } from './lib.js'

/** Questions per conversation, the search included; the Worker accepts 12 messages. */
const MAX_PREGUNTAS = 6

export const FLECHA = raw(
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
)
const ALTO = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>')

const hilos = new Map()
let control = null

const leerHilo = q => {
  try {
    return JSON.parse(sessionStorage.getItem(`hilo:${q}`) ?? 'null')
  } catch {
    return null
  }
}
const guardarHilo = (q, hilo) => {
  try {
    sessionStorage.setItem(`hilo:${q}`, JSON.stringify(hilo.filter(m => m.role === 'user' || m.listo)))
  } catch {}
}

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

/** One turn from /chat: streams the text through `alTexto` and resolves to the finished answer with its sources. */
async function preguntar(mensajes, signal, alTexto) {
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
    else if (event === 'fin') return { content: texto, sources: data.sources ?? [], criteria: data.criteria ?? [], model: data.model, cached: !!data.cached }
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

function turnoHtml(m, i) {
  if (m.role === 'user') return i === 0 ? '' : html`<div class="turno turno--tu"><p>${m.content}</p></div>`
  if (m.error)
    return html`<div class="turno turno--ia"><p class="answer-error" role="status">${m.error}</p><button class="button button--quiet conversa-retry" type="button">Volver a intentar</button></div>`
  if (!m.content)
    return html`<div class="turno turno--ia"><p class="answer-wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Leyendo los artículos…</p></div>`
  return html`<article class="turno turno--ia${m.listo ? '' : ' is-escribiendo'}"><div class="answer-text">${citasHtml(m.content, m.criteria ?? [])}</div>${
    m.listo ? html`${m.detenida ? html`<p class="turno-detenida">Detuviste esta respuesta.</p>` : ''}${fuentesHtml(m)}${criteriosHtml(m)}` : ''
  }</article>`
}

/**
 * The answer column of a search: the assistant's answer to the query, then follow-up questions about it,
 * streamed from /chat. `alCitar(claves)` hands the law column every article the conversation has cited.
 */
export function montarConversa(slot, q, { alCitar = () => {} } = {}) {
  control?.abort()
  control = new AbortController()
  const { signal } = control
  const yo = asistente()
  const hilo = hilos.get(q) ?? leerHilo(q) ?? [{ role: 'user', content: q }]
  hilos.set(q, hilo)

  slot.innerHTML = html`<header class="conversa-head">
      <h2 class="conversa-nombre">${raw(yo.html)}</h2>
      <p class="conversa-aviso">${yo.aviso}</p>
    </header>
    <div class="conversa-hilo" data-slot="hilo"></div>
    <p class="conversa-nota" data-slot="nota"></p>
    <form class="conversa-form" novalidate>
      <label class="sr-only" for="sigue">Otra pregunta para ${yo.nombre}</label>
      <textarea id="sigue" name="sigue" rows="1" maxlength="500" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
      <button class="ask-go" type="submit" aria-label="Enviar">${FLECHA}</button>
    </form>`
  const cajaHilo = slot.querySelector('[data-slot=hilo]')
  const nota = slot.querySelector('[data-slot=nota]')
  const form = slot.querySelector('form')
  const campo = form.sigue
  const boton = form.querySelector('.ask-go')
  let escribiendo = false
  let turnoCtl = null
  let detenido = false

  const preguntas = () => hilo.filter(m => m.role === 'user').length
  const pintar = () => {
    cajaHilo.innerHTML = hilo.map(turnoHtml).join('')
    const ultima = [...hilo].reverse().find(m => m.role === 'assistant' && m.listo && m.model)
    nota.textContent = ultima
      ? `Respuestas generadas con IA a partir de los artículos${tieneCriterios() ? ' y criterios' : ''} citados. Pueden equivocarse: revisa las fuentes. Modelo: ${modeloBonito(ultima.model)}${ultima.cached ? ', respuesta guardada' : ''}.`
      : ''
    const lleno = preguntas() >= MAX_PREGUNTAS
    campo.disabled = lleno
    campo.placeholder = lleno ? 'Para seguir, haz una búsqueda nueva.' : `Pregúntale algo más a ${yo.nombre}…`
    boton.innerHTML = String(escribiendo ? ALTO : FLECHA)
    boton.setAttribute('aria-label', escribiendo ? 'Detener la respuesta' : 'Enviar')
    boton.classList.toggle('is-alto', escribiendo)
    boton.disabled = lleno && !escribiendo
  }
  const alFondo = (siempre = false) => {
    if (siempre || cajaHilo.scrollHeight - cajaHilo.scrollTop - cajaHilo.clientHeight < 120) cajaHilo.scrollTop = cajaHilo.scrollHeight
  }

  let cuadro = 0
  async function responder() {
    const turno = { role: 'assistant', content: '' }
    hilo.push(turno)
    turnoCtl = new AbortController()
    const cortar = () => turnoCtl.abort()
    signal.addEventListener('abort', cortar, { once: true })
    detenido = false
    escribiendo = true
    pintar()
    alFondo(true)
    try {
      const listo = await preguntar(hilo.slice(0, -1), turnoCtl.signal, texto => {
        turno.content = texto
        cancelAnimationFrame(cuadro)
        cuadro = requestAnimationFrame(() => {
          const el = cajaHilo.lastElementChild
          if (el) el.outerHTML = String(turnoHtml(turno, hilo.length - 1))
          alFondo()
        })
      })
      Object.assign(turno, listo, { listo: true })
      guardarHilo(q, hilo)
      alCitar(citadasEn(hilo))
      anunciar(`${yo.nombre} respondió.`)
    } catch (e) {
      if (!esAborto(e)) Object.assign(turno, { error: e.message })
      else if (detenido && turno.content) {
        Object.assign(turno, { listo: true, detenida: true, sources: [], criteria: [] })
        guardarHilo(q, hilo)
      } else hilo.splice(hilo.indexOf(turno), 1)
    } finally {
      signal.removeEventListener('abort', cortar)
      cancelAnimationFrame(cuadro)
      escribiendo = false
      if (!signal.aborted) {
        pintar()
        alFondo()
      }
    }
  }

  const crecer = () => {
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, 160)}px`
  }
  campo.addEventListener('input', crecer)
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  form.addEventListener('submit', e => {
    e.preventDefault()
    if (escribiendo) {
      detenido = true
      turnoCtl.abort()
      return
    }
    const texto = campo.value.trim()
    if (!texto || preguntas() >= MAX_PREGUNTAS) return campo.focus()
    hilo.push({ role: 'user', content: texto })
    campo.value = ''
    crecer()
    responder()
  })
  slot.addEventListener('click', e => {
    if (!e.target.closest('.conversa-retry') || escribiendo) return
    hilo.splice(0, hilo.length, ...hilo.filter(m => !m.error))
    responder()
  })

  if (hilo[hilo.length - 1].role === 'user') responder()
  else {
    pintar()
    alCitar(citadasEn(hilo))
  }
}

/** Stops any answer still streaming, e.g. when the visitor turns the assistant off. */
export const detenerConversa = () => control?.abort()
