/**
 * Maneja Sin Broncas: what a driver should know before and during a traffic stop in Mexico City, in plain Spanish.
 * Every legal claim was checked against the article it cites (keys are LEY:id in the transito corpus, as read from
 * data/transito/fundamento.db on 2026-10-16); the few claims no article makes carry the official page they come from
 * in `fuente`. Describes what the law says agents and drivers must do; it is not legal advice.
 */

/** What the site covers: Mexico City only. */
export const ALCANCE =
  'Maneja Sin Broncas cubre solo la Ciudad de México: el Reglamento de Tránsito, la Ley de Movilidad y su reglamento, la Ley de Cultura Cívica y las cuotas de licencias, grúa y depósito del Código Fiscal local, leídos de su texto oficial. En el Estado de México y en los demás estados rigen otros reglamentos.'

/** Why a driver should know the reglamento. */
export const CONOCE_EL_REGLAMENTO =
  'En una parada de tránsito el agente debe identificarse con su nombre y número de placa, decirte qué infracción cometiste y mostrarte el artículo del Reglamento que la fundamenta (artículo 59). El monto no lo decide él: lo calcula un sistema según tus multas pendientes (artículo 64). Saber eso, qué documentos debes traer y cuándo procede la grúa (artículos 45 y 67) te ayuda a saber qué esperar y a notar cuando algo no sigue las reglas.'

/** Si te para un agente de tránsito en la CDMX, in the order a stop happens. */
export const CONSEJOS: { titulo: string; texto: string; citas: string[]; fuente?: { nombre: string; url: string } }[] = [
  {
    titulo: 'Antes de salir, revisa tus papeles',
    texto:
      'Si eres mayor de edad, lleva tu licencia vigente, en físico o digital. El auto necesita placas delantera y trasera, calcomanía de circulación permanente, holograma y constancia de verificación vigentes (las motos no), tarjeta de circulación vigente en físico o digital y póliza de seguro de responsabilidad civil vigente. Las multas se fijan en UMA (Unidad de Medida y Actualización): sin licencia, 10, 15 o 20 UMA; sin placas, calcomanía, holograma o tarjeta, 20, 25 o 30 UMA; sin póliza, 20, 30 o 40 UMA.',
    citas: ['RT:44', 'RT:45', 'RT:46'],
  },
  {
    titulo: 'Solo un agente autorizado te puede multar',
    texto:
      'Las multas las impone un agente autorizado para infraccionar. Si quien te detiene no lo es, debe pedir por radio el apoyo de uno que sí. La SSC informa que los agentes autorizados llevan en el uniforme un brazalete con un código QR que puedes escanear para ver sus datos y confirmar que pueden infraccionar.',
    citas: ['RT:4', 'RT:59', 'RT:60'],
    fuente: {
      nombre: 'Secretaría de Seguridad Ciudadana de la CDMX, comunicado 1100 (28 de abril de 2022)',
      url: 'https://www.ssc.cdmx.gob.mx/comunicacion/nota/1100-en-el-marco-del-programa-de-renovacion-de-transito-de-la-ssc-se-realizan-acciones-de-recuperacion-de-vialidades-en-beneficio-de-peatones-ciclistas-y-automovilistas',
    },
  },
  {
    titulo: 'Cómo debe ser la parada',
    texto:
      'El agente te indica que te detengas en un lugar adecuado, de preferencia cerca de cámaras de videovigilancia, y reporta por radio el motivo y tus placas. Debe identificarse con su nombre y número de placa, decirte qué infracción cometiste, mostrarte el artículo del Reglamento que la fundamenta y explicarte la sanción mínima, media y máxima. Si no procede multa, solo te amonesta, es decir, te advierte.',
    citas: ['RT:59'],
  },
  {
    titulo: 'El monto lo calcula el sistema, no el agente',
    texto:
      'El Sistema Integral de Administración de Infracciones fija la multa: la mínima si tienes cero o una sanción pendiente, la media si tienes dos o tres, y la máxima si tienes cuatro o más o si tu auto tiene placas de otro estado o país. El agente no puede hacer ese cálculo por su cuenta.',
    citas: ['RT:64'],
  },
  {
    titulo: 'Tus documentos se revisan y se devuelven',
    texto:
      'El agente te pide licencia, tarjeta de circulación y póliza para revisarlas; si están vigentes y corresponden al auto y a ti, te las devuelve, y si falta alguna, te multa por ella. Las excepciones: con placas de otro estado o país retira la placa delantera o retiene la licencia o la tarjeta, que te devuelven en oficinas de Seguridad Ciudadana después de pagar; si las placas no coinciden con la tarjeta y los registros, retiene ambas y el auto va al depósito; y en una infracción por alcohol retiene la licencia.',
    citas: ['RT:59', 'RT:62', 'RT:45'],
  },
  {
    titulo: 'Qué debe decir la boleta',
    texto:
      'La boleta debe traer los artículos que prevén la infracción y la sanción; fecha, hora, lugar y qué pasó; tus placas; tu nombre, domicilio y número y tipo de licencia si estabas presente; y el nombre, número de placa, adscripción (la unidad a la que pertenece) y firma del agente. Si la hace con un equipo electrónico, te llega al celular o correo que des; también puedes consultarla en medios electrónicos o en los Módulos de Atención Ciudadana de Seguridad Ciudadana.',
    citas: ['RT:60', 'RT:64', 'RT:59'],
  },
  {
    titulo: 'Dónde pagar y el descuento de 50%',
    texto:
      'La multa se paga en oficinas de la Tesorería de la Ciudad de México o en centros autorizados, incluidos medios electrónicos de pago; el Reglamento no prevé pagarle al agente. Si pagas dentro de los 30 días naturales desde que te notifican la boleta, te descuentan 50%, salvo en las multas de parquímetro de los artículos 30, fracción XXI, y 33, fracción II. Después de ese plazo se suman los cargos que fija el Código Fiscal de la Ciudad de México.',
    citas: ['RT:62'],
  },
  {
    titulo: 'Si te multaron por no traer la póliza',
    texto:
      'Si el auto es particular, el dueño tiene 45 días naturales, desde que la boleta aparece en estrados.cdmx.gob.mx, para pedir que se cancele. Se presenta ante Seguridad Ciudadana la solicitud por escrito en el formato autorizado, identificación oficial, tarjeta de circulación y póliza de seguro vigente; si el auto no está a tu nombre, además carta poder o factura endosada e identificación del titular.',
    citas: ['RT:46'],
  },
  {
    titulo: 'Alcoholímetro',
    texto:
      'Está prohibido manejar con más de 0.8 gramos de alcohol por litro de sangre o 0.4 miligramos por litro de aire espirado; en transporte público, escolar, de personal, de carga, de emergencia o de sustancias peligrosas el límite es cero. Si cometes una infracción o muestras síntomas de haber tomado, estás obligado a hacer la prueba cuando la autoridad te la pida. Si rebasas el límite: arresto administrativo inconmutable (no se cambia por multa) de 20 a 36 horas, seis puntos de penalización a tu licencia, retención de la licencia y el auto al depósito; en los puntos de revisión te deben dar copia de la tirilla con el resultado.',
    citas: ['RT:50', 'RT:51', 'RT:62'],
  },
  {
    titulo: 'Grúa y depósito (corralón)',
    texto:
      'La grúa solo procede en los casos del artículo 67; por ejemplo, si te detienen por una infracción y el auto tiene multas sin pagar de más de 30 días, si manejas sin licencia, si le faltan placas, tarjeta de circulación u holograma, o si te estacionaste en varios de los lugares prohibidos y no estás en el auto o te niegas a moverlo. Antes de arrastrarlo deben sellarlo. Para recuperarlo acreditas la propiedad o legal posesión, traes las llaves y pagas multas y derechos: $1,101 de grúa ($1,995 si se necesita una de más de 3.5 toneladas) y $104 por cada día de almacenaje. Si no lo recoges en un mes desde que quedó a tu disposición, se considera abandonado.',
    citas: ['RT:67', 'CFCDMX:230', 'CFCDMX:231'],
  },
  {
    titulo: 'Fotocívicas: cámaras y puntos',
    texto:
      'Si una cámara capta una infracción de un auto particular con placas de la Ciudad de México, la sanción no es dinero sino puntos: cada placa empieza con 10 y cada infracción resta uno (cinco si rebasas en más de 40% el límite de velocidad). Según los puntos que te queden va de amonestación a cursos en línea, taller presencial y trabajo comunitario. Con placas de otro estado o país, de empresa, taxi, transporte público o carga, o por invadir carriles confinados, la sanción por cámara es multa. Se notifica en tramites.cdmx.gob.mx/infracciones.',
    citas: ['RT:64'],
  },
  {
    titulo: 'Si algo sale mal',
    texto:
      'Insultar o denigrar al agente se multa con 20, 25 o 30 UMA y, si sigue, te presentan ante el Juez Cívico. Si es el agente quien incumple el Reglamento, puedes denunciarlo ante el Ministerio Público, la Secretaría de la Contraloría General, el Órgano Interno de Control o la Dirección General de Asuntos Internos de la SSC. El video de las cámaras del C5 solo se entrega a autoridades, pero puedes pedir que se resguarde para que no se borre.',
    citas: ['RT:7', 'RT:59', 'RT:70'],
    fuente: { nombre: 'C5 de la Ciudad de México, ¿Cómo solicitar un video?', url: 'https://www.c5.cdmx.gob.mx/preguntas-frecuentes/donde-puedo-solicitar-un-video' },
  },
]
