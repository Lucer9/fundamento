import assert from 'node:assert/strict'
import { buildSchema } from 'graphql'
import { citas, normId, parseLey, referencias } from './parse.ts'
import { fundamentos, parseRmf } from './rmf.ts'
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
assert.deepEqual(ids('el artículo 14 del Reglamento de la Ley del ISR', null), ['RLISR:14'])
assert.deepEqual(ids('el artículo 27 de la Ley y el artículo 5 de este Reglamento', 'RLISR'), ['LISR:27', 'RLISR:5'])
assert.deepEqual(ids('el artículo 1 de la Ley Federal de Derechos', 'RLISR'), [])
assert.deepEqual(ids('el artículo 39 del Reglamento del CFF', null), ['RCFF:39'])
assert.deepEqual(ids('conforme al artículo 2o.-A del Reglamento de esta Ley', 'LIVA'), ['RLIVA:2-A'])
assert.deepEqual(ids('el artículo 2o. de la Ley del IEPS', null), ['LIEPS:2'])
assert.deepEqual(ids('el artículo 21 de la Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2026', null), ['LIF:21'])
assert.deepEqual(ids('en la regla 2.7.1.21., así como en las reglas 3.3.1.7. y 3.3.1.8., fracción II', null), ['RMF:2.7.1.21', 'RMF:3.3.1.7', 'RMF:3.3.1.8'])

const fund = 'Texto.\nCFF 4o., 17-D, 29 Bis, LCF 13, 14, LISR 2021 112, RCFF 39, RMF 2.1.39., 2.9.3.'
assert.deepEqual(
  fundamentos(fund).map(m => `${m.ley}:${m.id}=${fund.slice(m.inicio, m.fin)}`),
  ['CFF:4=4o', 'CFF:17-D=17-D', 'CFF:29-Bis=29 Bis', 'RCFF:39=39', 'RMF:2.1.39=2.1.39', 'RMF:2.9.3=2.9.3'],
)
const rmf = parseRmf(
  [
    [15, 128, 654, 'CFF 18, 29-A'],
    [15, 245, 638, 'Título 2. Código Fiscal de la Federación'],
    [15, 249, 621, 'Capítulo 2.1. Disposiciones generales'],
    [15, 128, 605, 'Cobro de créditos fiscales determinados'],
    [15, 128, 591, 'por autoridades federales'],
    [15, 71, 574, '2.1.1. Para los efectos del artículo 4o. del CFF, las autoridades'],
    [15, 127, 560, 'federales remitirán los créditos.'],
    [15, 128, 543, 'CFF 4o., RMF 2.9.3.'],
    [15, 57, 527, 'Regla 2.1.2.'],
    [15, 57, 514, '- Reformada en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.'],
    [15, 128, 497, 'Acuerdo amplio de intercambio de información'],
    [15, 71, 480, '2.1.2. Se deroga.'],
    [849, 276, 400, 'Transitorios'],
  ]
    .map(l => l.join('\t'))
    .join('\n'),
)
assert.deepEqual(rmf.map(r => [r.id, r.titulo]), [['2.1.1', 'Cobro de créditos fiscales determinados por autoridades federales'], ['2.1.2', 'Acuerdo amplio de intercambio de información']])
assert.equal(rmf[0].texto, 'Para los efectos del artículo 4o. del CFF, las autoridades federales remitirán los créditos.\nCFF 4o., RMF 2.9.3.')
assert.deepEqual(rmf[0].ubicacion, ['Título 2. Código Fiscal de la Federación', 'Capítulo 2.1. Disposiciones generales'])
assert.deepEqual(rmf[1].reformas, ['2026-07-09'])

const refs = (q: string) => referencias(q).map(r => `${r.ley}:${r.id}`)
assert.deepEqual(refs('LISR 151'), ['LISR:151'])
assert.deepEqual(refs('art. 29-A del CFF'), ['CFF:29-A'])
assert.deepEqual(refs('artículo 27 de la Ley del ISR'), ['LISR:27'])
assert.deepEqual(refs('151 LISR'), ['LISR:151'])
assert.deepEqual(refs('¿la tasa de IVA 16% aplica a servicios?'), [])
assert.deepEqual(refs('gastos médicos deducibles'), [])
assert.deepEqual(refs('RMF 2.7.1.21'), ['RMF:2.7.1.21'])
assert.deepEqual(refs('¿qué dice la regla 3.17.1?'), ['RMF:3.17.1'])
assert.deepEqual(refs('RLISR 27'), ['RLISR:27'])
assert.deepEqual(refs('IEPS 2-A'), ['LIEPS:2-A'])

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
    '29-12-2023. Actualizada DOF 28-12-2025',
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
assert.deepEqual(ley[0].actualizaciones, ['2022-01-05', '2022-12-27', '2023-12-29', '2025-12-28'])
assert.deepEqual(ley[1].ubicacion, ['TÍTULO I DISPOSICIONES GENERALES', 'CAPITULO I Del objeto'])
assert.match(ley[1].texto, /Constitucional/)

buildSchema(typeDefs)

console.log('checks ok')
