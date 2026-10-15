import assert from 'node:assert/strict'
import { buildSchema } from 'graphql'
import { citas, normId, parseLey, referencias } from './parse.ts'
import { typeDefs } from './schema.graphql.ts'

const ids = (t: string, self: Parameters<typeof citas>[1]) => citas(t, self).map(r => `${r.ley}:${r.id}`)

assert.equal(normId('2', '.-A'), '2-A')
assert.equal(normId('18', '-H BIS'), '18-H-Bis')
assert.equal(normId('32', '-B Quinquies'), '32-B-Quinquies')

assert.deepEqual(ids('El artículo 151, fracciones I y VI de la Ley del ISR establece', null), ['LISR:151'])
assert.deepEqual(ids('los artículos 79, fracción XIX y 82 de esta Ley.', 'LISR'), ['LISR:79', 'LISR:82'])
assert.deepEqual(ids('de conformidad con los artículos 1 y 86 de la Ley sobre el Contrato de Seguro.', 'LISR'), [])
assert.deepEqual(ids('en términos del artículo 29-A, fracción IV del CFF y', null), ['CFF:29-A'])
assert.deepEqual(ids('el artículo 5o., fracción II, segundo y tercer párrafos de la Ley del IVA', null), ['LIVA:5'])
assert.deepEqual(ids('el artículo 2o.-A, fracción I, inciso b) de esta Ley', 'LIVA'), ['LIVA:2-A'])
assert.deepEqual(ids('el artículo 27, fracción V. Cuando el pago exceda de 2,000 pesos', 'LISR'), ['LISR:27'])
assert.deepEqual(ids('el artículo 82 de la Ley del ISR y el artículo 9 de dicha Ley', null), ['LISR:82', 'LISR:9'])
assert.deepEqual(ids('el artículo 14 del Reglamento de la Ley del ISR', null), [])

const refs = (q: string) => referencias(q).map(r => `${r.ley}:${r.id}`)
assert.deepEqual(refs('LISR 151'), ['LISR:151'])
assert.deepEqual(refs('art. 29-A del CFF'), ['CFF:29-A'])
assert.deepEqual(refs('artículo 27 de la Ley del ISR'), ['LISR:27'])
assert.deepEqual(refs('151 LISR'), ['LISR:151'])
assert.deepEqual(refs('¿la tasa de IVA 16% aplica a servicios?'), [])
assert.deepEqual(refs('gastos médicos deducibles'), [])

const ley = parseLey(
  [
    'TÍTULO I',
    'DISPOSICIONES GENERALES',
    'CAPITULO I',
    'Del objeto',
    'Artículo 1o.- Están obligadas al pago del impuesto',
    'las personas que',
    'I. Enajenen bienes.',
    'Párrafo reformado DOF 30-11-2016, 08-12-2020,',
    '12-11-2021',
    'Multa de la fracción actualizada por resolución miscelánea fiscal DOF 05-01-2022. Compilada DOF 27-12-2022.',
    '29-12-2023',
    '1 de 3',
    'Artículo 2o.-A.- El impuesto se calculará conforme al artículo 1o. de esta Ley.',
    'Artículo 123 Constitucional; de la Ley Reglamentaria',
    'TRANSITORIOS',
    'Artículo 1. Esta Ley entrará en vigor',
  ].join('\n'),
  'LIVA',
)
assert.deepEqual(ley.map(a => a.id), ['1', '2-A'])
assert.equal(ley[0].texto, 'Están obligadas al pago del impuesto las personas que\nI. Enajenen bienes.')
assert.deepEqual(ley[0].reformas, ['2016-11-30', '2020-12-08', '2021-11-12'])
assert.deepEqual(ley[0].actualizaciones, ['2022-01-05', '2022-12-27', '2023-12-29'])
assert.deepEqual(ley[1].ubicacion, ['TÍTULO I DISPOSICIONES GENERALES', 'CAPITULO I Del objeto'])
assert.match(ley[1].texto, /Constitucional/)

buildSchema(typeDefs)

console.log('checks ok')
