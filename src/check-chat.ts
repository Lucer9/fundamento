import assert from 'node:assert/strict'
import { leerRespuesta, sse } from './claude.ts'
import { LEYES } from './parse.ts'
import { limpiador } from './responder.ts'

/**
 * Self-check for the streaming pieces behind /chat: the server-sent-event reader, the Messages API stream reader, and
 * the citation cleaner, which must give the same answer however the model's text is cut into pieces.
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
const esperado = `Sí, se puede [${L} 27] y [${L} 28], salvo. Ver [${L} 27]-fin [SAT 12].`
const abierto = `Dice [${L} 27 y luego ${'x'.repeat(250)} sin cerrar`
for (const [entrada, salida] of [
  [crudo, esperado],
  [abierto, abierto],
  [`Nada citable [XYZ 9]`, 'Nada citable'],
]) {
  for (const piezas of cortes(entrada)) {
    const l = limpiador(permitidas)
    const salidas = [...piezas.map(p => l.empujar(p)), l.cerrar()]
    assert.equal(salidas.join(''), salida, JSON.stringify(piezas))
    assert.equal(l.texto, salida)
    if (entrada === crudo) assert.deepEqual(l.usadas, [`${L} 27`, `${L} 28`, 'SAT 12'])
  }
}
console.log('chat: SSE, flujo de la API y limpieza de citas ✓')
