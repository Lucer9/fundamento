import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { multas, parseCdmx } from './cdmx.ts'
import { normId } from './parse.ts'

const tsv = (ls: (string | number)[][]) => ls.map(l => l.join('\t')).join('\n')
const doc = tsv([
  [1, 377, 760, 'REGLAMENTO DE TRÁNSITO'],
  [1, 382, 741, 'DE LA CIUDAD DE MÉXICO'],
  [1, 204, 631, 'Última reforma publicada en la G.O. CDMX'],
  [1, 268, 466, 'TÍTULO PRIMERO'],
  [1, 244, 453, 'DISPOSICIONES GENERALES'],
  [1, 281, 428, 'CAPÍTULO I'],
  [1, 220, 416, 'DEL OBJETO'],
  [1, 130, 391, '- El presente reglamento regula la circulación en la vía Artículo 1.'],
  [1, 85, 378, 'pública.'],
  [1, 85, 353, 'Artículo 2.-Los conductores deben:'],
  [1, 103, 328, 'I. Respetar los carriles;'],
  [1, 389, 318, 'Fracción reformada G.O. CDMX 06/05/2026'],
  [1, 103, 105, 'II. Ceder el paso en las intersecciones canalizadas por'],
  [1, 121, 92, 'islas;CONSEJERÍA JURÍDICA Y DE SERVICIOS LEGALES'],
  [1, 183, 72, 'CONSEJERÍA JURÍDICA Y DE SERVICIOS LEGALES'],
  [2, 377, 760, 'REGLAMENTO DE TRÁNSITO'],
  [2, 85, 701, 'Quien infrinja este artículo pagará una multa equivalente a 10, 15 o 20 veces la Unidad de Medida y'],
  [2, 85, 689, 'Actualización vigente.'],
  [2, 400, 679, 'Párrafo reformado G.O. CDMX 10/08/23'],
  [2, 85, 654, 'Artículo 9. - Los conductores respetarán los límites de velocidad.'],
  [2, 85, 629, 'Artículo 12 Bis.- Los conductores de motocicletas usarán casco.'],
  [2, 85, 130, 'Artículo 14.'],
  [2, 137, 117, '- Los ciclistas deben respetar las reglas descritas en el'],
  [2, 85, 105, 'artículo 6, cuando circulen por la'],
  [3, 382, 741, 'DE LA CIUDAD DE MÉXICO'],
  [3, 85, 701, 'Ciudad de México.'],
  [3, 210, 676, 'No se puede mostrar la imagen en este momento.'],
  [3, 85, 651, 'Artículo 61.- DEROGADO'],
  [3, 273, 626, 'TRANSITORIOS'],
  [3, 85, 601, 'Artículo 1.- Este decreto entra en vigor al día siguiente.'],
])

const arts = parseCdmx(doc, 'RT')
assert.deepEqual(arts.map(a => a.id), ['1', '2', '9', '12-Bis', '14', '61'])
assert.equal(arts[3].id, normId('12', ' Bis'))
assert.deepEqual(arts.map(a => a.orden), [0, 1, 2, 3, 4, 5])
assert.equal(arts[0].texto, 'El presente reglamento regula la circulación en la vía pública.')
assert.deepEqual(arts[0].ubicacion, ['TÍTULO PRIMERO DISPOSICIONES GENERALES', 'CAPÍTULO I DEL OBJETO'])
assert.equal(
  arts[1].texto,
  [
    'Los conductores deben:',
    'I. Respetar los carriles;',
    'II. Ceder el paso en las intersecciones canalizadas por islas;',
    'Quien infrinja este artículo pagará una multa equivalente a 10, 15 o 20 veces la Unidad de Medida y Actualización vigente.',
  ].join('\n'),
)
assert.deepEqual(arts[1].reformas, ['2023-08-10', '2026-05-06'])
assert.equal(arts[2].texto, 'Los conductores respetarán los límites de velocidad.')
assert.equal(arts[4].texto, 'Los ciclistas deben respetar las reglas descritas en el artículo 6, cuando circulen por la Ciudad de México.')
assert.equal(arts[5].texto, 'DEROGADO')
assert.ok(arts.every(a => a.ley === 'RT' && a.actualizaciones.length === 0 && !/CONSEJERÍA|G\.O\.|imagen|TRÁNSITO/.test(a.texto)))

const solo = parseCdmx(doc, 'RT', { articulos: ['9', '14'] })
assert.deepEqual(solo.map(a => [a.id, a.orden]), [['9', 0], ['14', 1]])

const escritas = parseCdmx(
  tsv([
    [1, 85, 701, 'Artículo28.- La Comisión sesionará.'],
    [1, 85, 676, 'Artículo. 29.- Son infracciones contra el entorno urbano.'],
    [1, 85, 651, 'Artículo 32. El Fondo tendrá por objeto captar recursos.'],
    [1, 85, 626, 'Artículo 83- La Secretaría reglamentará.'],
    [1, 85, 601, 'Artículo 127 TER .- Para la renovación de las licencias.'],
    [1, 85, 576, 'Artículo 163.– Se consideran causas justificadas.'],
    [1, 92, 551, 'ARTÍCULO 449-1.- El Procedimiento tiene por objeto.'],
    [1, 85, 538, 'Artículo 5. de la Ley no es un encabezado.'],
    [1, 92, 513, 'ARTÍCULO 155 BIS 1.- Se entiende por juegos con apuestas.'],
    [1, 92, 488, 'ARTÍCULO 449-QUINTUS.- Las autoridades fiscales.'],
  ]),
  'LM',
)
assert.deepEqual(escritas.map(a => a.id), ['28', '29', '32', '83', '127-Ter', '163', '449-1', '155-Bis-1', '449-Quintus'])
assert.equal(escritas[5].texto, 'Se consideran causas justificadas.')
assert.equal(escritas[6].texto, 'El Procedimiento tiene por objeto. Artículo 5. de la Ley no es un encabezado.')

const spans = (t: string) => multas(t).map(m => [m.veces, t.slice(m.inicio, m.fin)])
const celular = 'serán sancionados con una multa equivalente a 30, 32 o 35 veces la Unidad de Medida y Actualización vigente, tres puntos'
assert.deepEqual(spans(celular), [[[30, 32, 35], 'multa equivalente a 30, 32 o 35 veces la Unidad de Medida y Actualización vigente']])
assert.deepEqual(spans('la multa será equivalente a 20, 25 o 30 veces la Unidad de Medida y Actualización y seis puntos'), [
  [[20, 25, 30], 'multa será equivalente a 20, 25 o 30 veces la Unidad de Medida y Actualización'],
])
assert.deepEqual(spans('el propietario deberá cubrir una multa de 60 veces la Unidad de Medida y Actualización Vigente'), [
  [[60], 'multa de 60 veces la Unidad de Medida y Actualización Vigente'],
])
assert.deepEqual(multas('se cancelará y se aplicará una multa de ciento ochenta veces la Unidad de Medida y Actualización')[0].veces, [180])
assert.deepEqual(multas('se sancionarán con una multa por el equivalente de 1 a 10 veces la Unidad de Medida, o arresto')[0].veces, [1, 10])
assert.deepEqual(multas('se sancionarán con multa equivalente de 11 a 40 Unidades de Medida, o arresto de 13 a 24 horas')[0].veces, [11, 40])
assert.deepEqual(
  multas('con multa de ochenta a cien veces la Unidad de Medida y Actualización vigente, tratándose de unidades de pasajeros y de sesenta a ochenta veces la Unidad de Medida y Actualización vigente, en el caso de carga').map(m => m.veces),
  [[80, 100], [60, 80]],
)
assert.deepEqual(multas('se impondrá multa deciento sesenta a doscientos veces la Unidad de Medida y Actualización')[0].veces, [160, 200])
assert.deepEqual(multas('se sancionará con arresto administrativo inconmutable de 20 a 36 horas, y seis puntos de penalización'), [])
assert.deepEqual(multas('la cobertura mínima asegurada deberá ser de al menos cincuenta mil veces la Unidad de Medida y Actualización y de cinco mil veces la Unidad de Medida y Actualización'), [])
assert.deepEqual(multas('XLIV. Unidad de Medida y Actualización vigente (UMA), El valor expresado en pesos'), [])

const RT = resolve(import.meta.dirname, '../data/transito/raw/RT.pdf')
if (existsSync(RT)) {
  const lineas = execFileSync('osascript', ['-l', 'JavaScript', resolve(import.meta.dirname, '../scripts/pdf-lineas.js'), RT], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const rt = parseCdmx(lineas, 'RT')
  const art = (id: string) => rt.find(a => a.id === id)!.texto
  assert.deepEqual(rt.map(a => a.id), Array.from({ length: 70 }, (_, i) => String(i + 1)))
  assert.equal(art('61'), 'DEROGADO')
  assert.match(art('38'), /\ne\) Utilizar teléfono celular o cualquier dispositivo de comunicación mientras el vehículo esté en movimiento/)
  assert.ok(spans(art('38')).some(([v, s]) => String(v) === '30,32,35' && s === 'multa equivalente a 30, 32 o 35 veces la Unidad de Medida y Actualización vigente'))
  assert.ok(art('50').startsWith('Queda prohibido conducir vehículos motorizados cuando se tenga una cantidad de alcohol en la sangre superior a 0.8 gramos por litro o de alcohol en aire espirado superior a 0.4 miligramos por litro'))
  assert.match(art('50'), /arresto administrativo inconmutable de 20 a 36 horas, y seis puntos de penalización/)
  assert.deepEqual(multas(art('50')).map(m => m.veces), [[60]])
  assert.match(art('8'), /\nVII\. Los conductores de vehículos motorizados que infrinjan la presente disposición/)
  assert.deepEqual(rt[0].ubicacion, ['TÍTULO PRIMERO DISPOSICIONES GENERALES', 'CAPÍTULO I DEL OBJETO Y CONCEPTOS GENERALES'])
  assert.equal(rt.flatMap(a => multas(a.texto)).length, 214)
  assert.ok(rt.every(a => !/CONSEJERÍA JURÍDICA Y DE SERVICIOS LEGALES|G\.O\. ?CDMX|No se puede mostrar/.test(a.texto)))
} else console.log(`skipped the real-RT checks: ${RT} not found`)

console.log('cdmx checks ok')
