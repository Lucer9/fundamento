import type { Corpus } from '../corpus.ts'

const CEJUR = 'https://data.consejeria.cdmx.gob.mx/images/leyes/2025'

/**
 * semáforo: Mexico City traffic law. Texts are the Consejería Jurídica's compiled texto vigente; the reglamento
 * leads, since it holds the infractions, fines and points. Only the Código Fiscal articles on license, tow-truck and
 * corralón fees are kept: the rest of its 1,142 pages would drown the search. One result list: on the 28 hand-checked
 * questions, one ranking over all five documents scored at least as well as the reglamento ranked alone (hit@5 89.3% vs
 * 82.1%), unlike the tax corpus, whose rules paraphrase the law they apply.
 */
export const TRANSITO: Corpus = {
  clave: 'transito',
  prefijo: 'semaforo',
  sitio: {
    nombre: 'semáforo',
    lema: 'el Reglamento de Tránsito de la CDMX, en tus palabras',
    descripcion:
      'Buscador del Reglamento de Tránsito de la Ciudad de México y las leyes que lo rodean. Pregunta en español y llega al artículo vigente, con la multa en pesos de 2026 y los puntos a la licencia.',
    aviso: 'No es asesoría legal.',
    ejemplos: [
      '¿Cuánto es la multa por usar el celular manejando?',
      '¿Qué pasa si el alcoholímetro sale positivo?',
      '¿Cuándo se llevan mi auto al corralón?',
      '¿Cuántos puntos tiene mi licencia y cuándo me la quitan?',
      '¿Cómo funcionan las fotocívicas?',
      '¿Las motos pueden ir entre carriles?',
    ],
  },
  docs: {
    RT: {
      titulo: 'REGLAMENTO DE TRÁNSITO DE LA CIUDAD DE MÉXICO',
      nombre: 'Reglamento de Tránsito de la Ciudad de México',
      corto: 'Reglamento de Tránsito',
      tipo: 'reglamento',
      formato: 'cdmx',
      pdf: `${CEJUR}/181225/REGLAMENTO_DE_TRNSITO_DE_LA_CIUDAD_DE_MXICO_6.4.pdf`,
      reglamenta: 'LM',
      nombra: { palabra: 'Reglamento', resto: /^\s*de tránsito/ },
    },
    LM: {
      titulo: 'LEY DE MOVILIDAD DE LA CIUDAD DE MÉXICO',
      nombre: 'Ley de Movilidad de la Ciudad de México',
      corto: 'Ley de Movilidad',
      tipo: 'ley',
      formato: 'cdmx',
      pdf: `${CEJUR}/LEY_DE_MOVILIDAD_DE_LA_CDMX_3.2.pdf`,
      laLey: 'LM',
      nombra: { palabra: 'Ley', resto: /^\s*de movilidad/ },
    },
    RLM: {
      titulo: 'REGLAMENTO DE LA LEY DE MOVILIDAD DE LA CIUDAD DE MÉXICO',
      nombre: 'Reglamento de la Ley de Movilidad de la Ciudad de México',
      corto: 'Reglamento de Movilidad',
      tipo: 'reglamento',
      formato: 'cdmx',
      pdf: `${CEJUR}/181225/REG_DE_LEY_DE_MOVILIDAD_DE_LA_CDMX_4.8.pdf`,
      reglamenta: 'LM',
    },
    LCC: {
      titulo: 'LEY DE CULTURA CÍVICA DE LA CIUDAD DE MÉXICO',
      nombre: 'Ley de Cultura Cívica de la Ciudad de México',
      corto: 'Cultura Cívica',
      tipo: 'ley',
      formato: 'cdmx',
      pdf: `${CEJUR}/2026/190126/LEY_DE_CULTURA_CIVICA_DE_LA_CIUDAD_DE_MEXICO_3.1.pdf`,
      laLey: 'LCC',
      nombra: { palabra: 'Ley', resto: /^\s*de cultura cívica/ },
    },
    CFCDMX: {
      titulo: 'CÓDIGO FISCAL DE LA CIUDAD DE MÉXICO',
      nombre: 'Código Fiscal de la Ciudad de México',
      corto: 'Código Fiscal CDMX',
      tipo: 'ley',
      formato: 'cdmx',
      pdf: `${CEJUR}/2026/210126/CODIGO_FISCAL_DE_LA_CDMX_26.1.pdf`,
      nombra: { palabra: 'Código', resto: /^\s*fiscal(?! de la federación)/ },
      articulos: ['229', '230', '231'],
    },
  },
  alias: {},
  modo: 'HYBRID',
  listas: [{ titulo: 'Artículos', nota: '', leyes: ['RT', 'LM', 'RLM', 'LCC', 'CFCDMX'] }],
  prompt: `Eres "semáforo", un buscador del Reglamento de Tránsito de la Ciudad de México (RT) y de las leyes que lo rodean: la Ley de Movilidad (LM), su reglamento (RLM), la Ley de Cultura Cívica (LCC) y el Código Fiscal de la Ciudad de México (CFCDMX).
Responde en español, en dos a cinco frases, usando solo los artículos que se te dan.
Después de cada afirmación cita su fuente entre corchetes con su clave exacta, por ejemplo [RT 38], [LM 68] o [CFCDMX 231].
Las multas van en veces la Unidad de Medida y Actualización (UMA); junto a cada multa el texto trae entre ⟨ ⟩ su equivalente en pesos de 2026. Da la multa en pesos y en UMA; si hay tres montos (mínimo, medio y máximo), dalos los tres. Menciona los puntos a la licencia, el arresto o la remisión al depósito cuando el artículo los diga.
Si los artículos solo responden una parte, responde esa parte y di qué falta; si no responden nada, dilo en una frase.
No inventes multas, plazos ni cifras que no aparezcan en los artículos, y no des asesoría personalizada.
Si los artículos no mencionan algo (una multa, puntos, la remisión al depósito), di que los artículos que tienes no lo mencionan; no afirmes que no aplica.
Cada párrafo de sanción dice a qué incisos o fracciones aplica ("los incisos a), b), d) y e)…", "el inciso c)…"): usa solo la sanción del inciso que corresponde a la pregunta.
Escribe texto plano, sin markdown.`,
  sinonimos: [
    [/hoy no circula/, 'programas ambientales vehículos con restricciones días y horas'],
    [/corral[oó]n/, 'remisión al depósito vehicular grúa'],
    [/fotoc[ií]vica|fotomulta|c[aá]mara/, 'infracciones captadas a través de sistemas tecnológicos puntos a la matrícula'],
    [/alcohol[ií]metro/, 'alcohol en aire espirado'],
    [/banqueta/, 'acera'],
    [/metrob[uú]s/, 'carril confinado carriles exclusivos para el transporte público'],
    [/\bmotos?\b/, 'motocicleta'],
  ],
  siguiente: true,
  entero: 10000,
  citantes: true,
  uma: { valor: 117.31, desde: '2026-02-01', fuente: 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf' },
}
