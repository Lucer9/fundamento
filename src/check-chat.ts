import assert from 'node:assert/strict'
import { leerRespuesta, sse } from './claude.ts'
import { LEYES } from './parse.ts'
import type { Ctx, Db } from './indice.ts'
import { POR_IP, cobrar, limpiador } from './responder.ts'

/**
 * Self-check for the streaming pieces behind /chat: the server-sent-event reader, the Messages API stream reader, and
 * the citation cleaner, which must give the same answer however the model's text is cut into pieces; and the quotas
 * that spend an answer: one visitor's daily quota, then the site's daily cap, with no IP stored.
 * Usage: [CORPUS=transito] node src/check-chat.ts
 */
const cortes = (s: string) => [[s], [...s], ...Array.from({ length: s.length - 1 }, (_, i) => [s.slice(0, i + 1), s.slice(i + 1)])]

const flujo = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Sí, "}}\n\n',
  'event: ping\ndata: {"type": "ping"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"señor [X 1]."}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('')

for (const texto of [flujo, flujo.replaceAll('\n', '\r\n')])
  for (const piezas of cortes(texto)) {
    const eventos: string[] = []
    const leer = sse((e, d) => eventos.push(`${e} ${JSON.parse(d).type}`))
    for (const p of piezas) leer(p)
    leer('\n\n')
    assert.deepEqual(eventos, ['message_start message_start', 'content_block_delta content_block_delta', 'ping ping', 'content_block_delta content_block_delta', 'message_stop message_stop'])
  }

const respuesta = (cuerpo: string, tipo: string, tam = 7) => {
  const b = new TextEncoder().encode(cuerpo)
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < b.length; i += tam) c.enqueue(b.slice(i, i + tam))
        c.close()
      },
    }),
    { headers: { 'content-type': tipo } },
  )
}
for (const tam of [1, 3, 7, 64]) {
  const piezas: string[] = []
  assert.equal(await leerRespuesta(respuesta(flujo, 'text/event-stream; charset=utf-8', tam), t => piezas.push(t)), 'Sí, señor [X 1].')
  assert.deepEqual(piezas, ['Sí, ', 'señor [X 1].'])
}
const conError = flujo.replace('event: message_stop', 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\nevent: message_stop')
await assert.rejects(leerRespuesta(respuesta(conError, 'text/event-stream'), () => {}), /overloaded_error/)
const piezas: string[] = []
assert.equal(await leerRespuesta(respuesta('{"content":[{"type":"text","text":"Todo junto."}]}', 'application/json'), t => piezas.push(t)), 'Todo junto.')
assert.deepEqual(piezas, ['Todo junto.'])

const L = Object.keys(LEYES)[0]
const permitidas = new Set([`${L} 27`, `${L} 28`, 'SAT 12'])
const crudo = `  **Sí**, se puede [${L} 27] y [${L} 99; ${L} 28] , salvo [XYZ 1] . Ver【${L} 27】—fin [SAT 12].  `
const esperado = `**Sí**, se puede [${L} 27] y [${L} 28], salvo. Ver [${L} 27]-fin [SAT 12].`
const secciones = `**Qué hacer:**\n- Pide la boleta [${L} 27] [XYZ 3].\n- Paga en línea.\n\n**Lo que no debe pasar:** que te pidan dinero.`
const seccionesLimpias = `**Qué hacer:**\n- Pide la boleta [${L} 27].\n- Paga en línea.\n\n**Lo que no debe pasar:** que te pidan dinero.`
const abierto = `Dice [${L} 27 y luego ${'x'.repeat(250)} sin cerrar`
for (const [entrada, salida] of [
  [crudo, esperado],
  [abierto, abierto],
  [`Nada citable [XYZ 9]`, 'Nada citable'],
  [secciones, seccionesLimpias],
]) {
  for (const piezas of cortes(entrada)) {
    const l = limpiador(permitidas)
    const salidas = [...piezas.map(p => l.empujar(p)), l.cerrar()]
    assert.equal(salidas.join(''), salida, JSON.stringify(piezas))
    const llenas = salidas.filter(Boolean)
    for (let i = 1; i < llenas.length; i++) assert.ok(!(llenas[i - 1].endsWith('*') && llenas[i].startsWith('*')), `'**' llegó partido: ${JSON.stringify(piezas)}`)
    assert.equal(l.texto, salida)
    if (entrada === crudo) assert.deepEqual(l.usadas, [`${L} 27`, `${L} 28`, 'SAT 12'])
  }
}
const cuentas = new Map<string, number>()
const falsa = { all: async (_: string, clave: string) => [{ n: cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1).get(clave) }] } as unknown as Db
const visita = (ip: string, diario: number) =>
  ({ env: { ANSWER_LIMITER: { limit: async () => ({ success: true }) }, DAILY_ANSWERS: String(diario) }, db: falsa, ip }) as unknown as Ctx
for (let i = 0; i < POR_IP; i++) assert.equal(await cobrar(visita('203.0.113.7', 1000)), null)
assert.match((await cobrar(visita('203.0.113.7', 1000)))!, /muchas preguntas hoy/)
assert.equal(await cobrar(visita('198.51.100.9', POR_IP + 2)), null)
assert.equal(await cobrar(visita('198.51.100.9', POR_IP + 2)), null)
assert.match((await cobrar(visita('198.51.100.9', POR_IP + 2)))!, /Se acabaron las respuestas de hoy/)
assert.ok([...cuentas.keys()].every(k => /^\d{4}-\d{2}-\d{2}(\|ip:[0-9a-f]{16})?$/.test(k)), [...cuentas.keys()].join(' '))
console.log('chat: SSE, flujo de la API, limpieza de citas y cuotas ✓')
