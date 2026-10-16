import type { Corpus } from '../corpus.ts'

const BIBLIO = 'https://www.diputados.gob.mx/LeyesBiblio'
const RMF = 'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf'

/**
 * fundamento: Mexican federal tax law. Laws and regulations come from the Cámara de Diputados (texto vigente); the
 * Resolución Miscelánea Fiscal is SAT's compiled 2026 edition, whose numbered rules stand in for articles.
 */
export const FISCAL: Corpus = {
  clave: 'fiscal',
  prefijo: 'fundamento',
  sitio: {
    nombre: 'fundamento',
    lema: 'la ley fiscal, en tus palabras',
    descripcion:
      'Buscador de las leyes fiscales federales de México, sus reglamentos y la Resolución Miscelánea Fiscal 2026. Pregunta en español y llega al artículo o la regla vigente, con lo que cita y quién lo cita.',
    aviso: 'No es asesoría fiscal.',
    ejemplos: [
      '¿El deducible del seguro de gastos médicos es deducible?',
      '¿Cuándo debo expedir un CFDI?',
      '¿Qué tasa de IVA aplica a la exportación de servicios?',
      '¿Qué gastos médicos puedo deducir en mi declaración anual?',
      '¿Cuánto tiempo debo conservar mi contabilidad?',
      '¿Cuándo prescribe un crédito fiscal?',
    ],
  },
  docs: {
    LISR: {
      titulo: 'LEY DEL IMPUESTO SOBRE LA RENTA',
      nombre: 'Ley del Impuesto sobre la Renta',
      corto: 'Ley del ISR',
      tipo: 'ley',
      formato: 'diputados',
      pdf: `${BIBLIO}/pdf/LISR.pdf`,
      nombra: { palabra: 'Ley', resto: /^\s*(del )?impuesto sobre la renta|^\s*del isr\b/ },
    },
    LIVA: {
      titulo: 'LEY DEL IMPUESTO AL VALOR AGREGADO',
      nombre: 'Ley del Impuesto al Valor Agregado',
      corto: 'Ley del IVA',
      tipo: 'ley',
      formato: 'diputados',
      pdf: `${BIBLIO}/pdf/LIVA.pdf`,
      nombra: { palabra: 'Ley', resto: /^\s*(del )?impuesto al valor agregado|^\s*del iva\b/ },
    },
    LIEPS: {
      titulo: 'LEY DEL IMPUESTO ESPECIAL SOBRE PRODUCCIÓN Y SERVICIOS',
      nombre: 'Ley del Impuesto Especial sobre Producción y Servicios',
      corto: 'Ley del IEPS',
      tipo: 'ley',
      formato: 'diputados',
      pdf: `${BIBLIO}/pdf/LIEPS.pdf`,
      nombra: { palabra: 'Ley', resto: /^\s*(del )?impuesto especial sobre producción y servicios|^\s*del ieps\b/ },
    },
    CFF: {
      titulo: 'CÓDIGO FISCAL DE LA FEDERACIÓN',
      nombre: 'Código Fiscal de la Federación',
      corto: 'Código Fiscal',
      tipo: 'ley',
      formato: 'diputados',
      pdf: `${BIBLIO}/pdf/CFF.pdf`,
      nombra: { palabra: 'Código', resto: /^(?!\s*(civil|penal|de comercio|nacional|federal))/ },
    },
    LIF: {
      titulo: 'LEY DE INGRESOS DE LA FEDERACIÓN PARA EL EJERCICIO FISCAL DE 2026',
      nombre: 'Ley de Ingresos de la Federación para 2026',
      corto: 'Ley de Ingresos 2026',
      tipo: 'ley',
      formato: 'diputados',
      pdf: `${BIBLIO}/pdf/LIF_2026.pdf`,
      nombra: { palabra: 'Ley', resto: /^\s*de ingresos de la federación/ },
    },
    RLISR: {
      titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO SOBRE LA RENTA',
      nombre: 'Reglamento de la Ley del Impuesto sobre la Renta',
      corto: 'Reglamento LISR',
      tipo: 'reglamento',
      formato: 'diputados',
      pdf: `${BIBLIO}/regley/Reg_LISR_060516.pdf`,
      reglamenta: 'LISR',
    },
    RLIVA: {
      titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO AL VALOR AGREGADO',
      nombre: 'Reglamento de la Ley del Impuesto al Valor Agregado',
      corto: 'Reglamento LIVA',
      tipo: 'reglamento',
      formato: 'diputados',
      pdf: `${BIBLIO}/regley/Reg_LIVA_250914.pdf`,
      reglamenta: 'LIVA',
    },
    RLIEPS: {
      titulo: 'REGLAMENTO DE LA LEY DEL IMPUESTO ESPECIAL SOBRE PRODUCCIÓN Y SERVICIOS',
      nombre: 'Reglamento de la Ley del Impuesto Especial sobre Producción y Servicios',
      corto: 'Reglamento LIEPS',
      tipo: 'reglamento',
      formato: 'diputados',
      pdf: `${BIBLIO}/regley/Reg_LIEPS.pdf`,
      reglamenta: 'LIEPS',
    },
    RCFF: {
      titulo: 'REGLAMENTO DEL CÓDIGO FISCAL DE LA FEDERACIÓN',
      nombre: 'Reglamento del Código Fiscal de la Federación',
      corto: 'Reglamento CFF',
      tipo: 'reglamento',
      formato: 'diputados',
      pdf: `${BIBLIO}/regley/Reg_CFF.pdf`,
      reglamenta: 'CFF',
    },
    RMF: {
      titulo: 'RESOLUCIÓN MISCELÁNEA FISCAL PARA 2026',
      nombre: 'Resolución Miscelánea Fiscal para 2026',
      corto: 'Miscelánea 2026',
      tipo: 'reglas',
      formato: 'rmf',
      pdf: `${RMF}/compiladas/Compilado_Primera_Modificacion_a_la-Resolucion_Miscelanea_Fiscal_para_2026.pdf`,
      nombra: { palabra: 'Resolución', resto: /^\s*miscelánea fiscal/ },
    },
  },
  alias: { ISR: 'LISR', IVA: 'LIVA', IEPS: 'LIEPS' },
  modo: 'VECTOR',
  listas: [
    { titulo: 'Leyes', nota: '', leyes: ['LISR', 'LIVA', 'LIEPS', 'CFF', 'LIF'] },
    {
      titulo: 'Reglamentos y Miscelánea',
      nota: 'Cómo los reglamentos y las reglas del SAT aplican la ley. En el orden legal van después de ella: primero la ley, luego su reglamento y al final la Miscelánea.',
      leyes: ['RLISR', 'RLIVA', 'RLIEPS', 'RCFF', 'RMF'],
    },
  ],
  prompt: `Eres "fundamento", un buscador de la legislación fiscal federal mexicana: leyes (LISR, LIVA, LIEPS, CFF, LIF), sus reglamentos (RLISR, RLIVA, RLIEPS, RCFF) y la Resolución Miscelánea Fiscal 2026 (RMF).
Responde en español, en dos a cinco frases, usando solo los artículos y reglas que se te dan.
Después de cada afirmación cita su fuente entre corchetes con su clave exacta, por ejemplo [LISR 151], [CFF 29-A], [RLISR 264], [RMF 3.17.1] o [SAT 12].
Las leyes mandan sobre los reglamentos y los reglamentos sobre las reglas de la Miscelánea; cuando una regla da una facilidad u opción, dilo así.
Los criterios del SAT son la interpretación oficial de la autoridad: si uno responde la pregunta, apóyate en él y cítalo.
Si los artículos solo responden una parte, responde esa parte y di qué falta; si no responden nada, dilo en una frase.
No inventes reglas, plazos ni cifras que no aparezcan en los artículos, y no des asesoría personalizada.
Escribe texto plano, sin markdown.`,
  anexos: { 7: `${RMF}/anexos/Anexo_7_RMF2026-09012026.pdf`, 3: `${RMF}/anexos/Anexo_3_RMF2026-09012026.pdf` },
  materias: { 'del CFF': 'CFF', 'de la Ley del ISR': 'LISR', 'de la Ley del IVA': 'LIVA', 'de la Ley del IEPS': 'LIEPS', 'de la LIF': 'LIF' },
}
