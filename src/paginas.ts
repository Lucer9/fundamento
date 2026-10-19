import { CORPUS, slug } from './corpus.ts'
import type { Env } from './indice.ts'
import { LEYES } from './parse.ts'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESC[c])

/** Plain text for a meta description: no citation markers, one line, at most `n` characters at a word boundary. */
const resumen = (t: string, n = 155) => {
  const s = t.replace(/\s*\[[^\]]*\]/g, '').replace(/[⟨⟩]/g, '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s
}

type Pagina = { titulo: string; descripcion: string; cuerpo?: string; datos?: unknown; estado?: number; noindex?: boolean }

const GUIA = '/si-te-para-un-agente'
const AUTOR = { '@type': 'Person', name: 'Carlos Aguirre', url: 'https://www.carlosaguirre.workers.dev' }

/** Who publishes the official text of this corpus's documents, for the footer: "la Cámara de Diputados y el SAT". */
function editores() {
  const nombres = [
    [/diputados\.gob\.mx/, 'la Cámara de Diputados'],
    [/sat\.gob\.mx/, 'el SAT'],
    [/cdmx\.gob\.mx/, 'la Consejería Jurídica de la Ciudad de México'],
  ] as const
  const quien = [...new Set(Object.values(CORPUS.docs).flatMap(d => nombres.filter(([re]) => re.test(d.pdf)).map(([, n]) => n)))]
  const lista = quien.length > 1 ? `${quien.slice(0, -1).join(', ')} y ${quien[quien.length - 1]}` : quien[0]
  return `Texto vigente publicado por ${lista}${CORPUS.anexos ? '; criterios del SAT, Anexos 3 y 7 de la RMF 2026' : ''}.`
}

/** The traffic guide as server-rendered HTML: every tip with the articles it rests on and any official page behind it. */
function guiaHtml(guia: NonNullable<typeof CORPUS.guia>) {
  const cita = (k: string) => {
    const [ley, id] = k.split(':')
    return `<a href="/${ley}/${encodeURIComponent(id)}">${esc(`${ley} ${id}`)}</a>`
  }
  return `<article class="ssr"><h1>Si te para un agente de tránsito en la CDMX</h1><p>${esc(guia.conoce)}</p><p>${esc(guia.alcance)}</p><ol>${guia.consejos
    .map(
      c =>
        `<li id="${slug(c.titulo)}"><h2>${esc(c.titulo)}</h2><p>${esc(c.texto)}</p><p>Artículos: ${c.citas.map(cita).join(', ')}</p>${
          c.fuente ? `<p>Fuente: <a href="${esc(c.fuente.url)}">${esc(c.fuente.nombre)}</a></p>` : ''
        }</li>`,
    )
    .join('')}</ol></article>`
}

/**
 * What a crawler should find at a path, without running the app: the page's own title and description, its text in
 * the HTML, and schema.org data (Legislation for an article or rule, QAPage for a published question). The app
 * replaces the server-rendered text when it mounts.
 */
async function contenido(env: Env, url: URL): Promise<Pagina> {
  const { nombre, lema, descripcion } = CORPUS.sitio
  const sitio = { titulo: CORPUS.sitio.titulo, descripcion }
  const noEncontrada: Pagina = { titulo: `Página no encontrada | ${nombre}`, descripcion, estado: 404, noindex: true }
  if (url.pathname === '/' && url.searchParams.get('q')) return { ...sitio, noindex: true }
  if (url.pathname === '/' && !url.search)
    return {
      ...sitio,
      cuerpo: `<header class="ssr"><h1>${esc(lema[0].toUpperCase() + lema.slice(1))}.</h1><p>${esc(descripcion)}</p>${
        CORPUS.guia ? `<p><a href="${GUIA}">Si te para un agente de tránsito: ${CORPUS.guia.consejos.length} cosas que dice el reglamento</a></p>` : ''
      }</header>`,
    }
  if (CORPUS.guia && new RegExp(`^${GUIA}/?$`).test(url.pathname))
    return {
      titulo: `Si te para un agente de tránsito en la CDMX: lo que dice el reglamento | ${nombre}`,
      descripcion: resumen(CORPUS.guia.conoce),
      cuerpo: guiaHtml(CORPUS.guia),
      datos: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Si te para un agente de tránsito en la CDMX',
        description: resumen(CORPUS.guia.conoce),
        about: 'Reglamento de Tránsito de la Ciudad de México',
        inLanguage: 'es-MX',
        author: AUTOR,
        url: `${url.origin}${GUIA}`,
      },
    }
  const art = url.pathname.match(/^\/([A-Z]+)\/([^/]+)\/?$/)
  if (art && LEYES[art[1]]) {
    const [ley, id] = [art[1], decodeURIComponent(art[2])]
    const doc = LEYES[ley]
    const [fila, res] = await Promise.all([
      env.DB.prepare(`select texto, titulo from articulo where ley = ?1 and id = ?2`).bind(ley, id).first<{ texto: string; titulo: string | null }>(),
      env.DB.prepare(`select tema, resumen, preguntas from resumen where ley = ?1 and id = ?2`)
        .bind(ley, id)
        .first<{ tema: string; resumen: string; preguntas: string }>()
        .catch(() => null),
    ])
    if (!fila) return noEncontrada
    const tema = fila.titulo ?? res?.tema
    const etiqueta = `${doc.tipo === 'reglas' ? 'Regla' : 'Artículo'} ${id}${tema ? `: ${tema}` : ''}`
    const preguntas = res ? (JSON.parse(res.preguntas) as string[]) : []
    return {
      titulo: `${etiqueta} · ${doc.nombre} | ${nombre}`,
      descripcion: resumen(res?.resumen ?? fila.texto),
      cuerpo: `<article class="ssr"><p>${esc(doc.nombre)}</p><h1>${esc(etiqueta)}</h1>${
        res
          ? `<section><h2>En pocas palabras</h2><p>${esc(res.resumen)}</p>${
              preguntas.length ? `<h3>Preguntas relacionadas</h3><ul>${preguntas.map(q => `<li><a href="/?q=${encodeURIComponent(q)}">${esc(q)}</a></li>`).join('')}</ul>` : ''
            }<p>Resumen escrito con IA a partir del texto oficial; el texto oficial es el que vale.</p></section>`
          : ''
      }${fila.texto
        .split('\n')
        .map(p => `<p>${esc(p)}</p>`)
        .join('')}<p><a href="${esc(doc.pdf)}">Texto oficial en PDF</a></p></article>`,
      datos: {
        '@context': 'https://schema.org',
        '@type': 'Legislation',
        name: `${etiqueta}, ${doc.nombre}`,
        legislationIdentifier: `${ley} ${id}`,
        isPartOf: { '@type': 'Legislation', name: doc.nombre, url: doc.pdf },
        legislationJurisdiction: CORPUS.clave === 'transito' ? 'Ciudad de México' : 'México',
        inLanguage: 'es-MX',
        url: `${url.origin}/${ley}/${art[2]}`,
        text: fila.texto.slice(0, 5000),
        ...(res ? { abstract: res.resumen } : {}),
      },
    }
  }
  const pregunta = url.pathname.match(/^\/preguntas\/([^/]+)\/?$/)
  if (pregunta) {
    const f = await env.DB.prepare(`select pregunta, respuesta, verificada from faq where slug = ?1`)
      .bind(pregunta[1])
      .first<{ pregunta: string; respuesta: string; verificada: number }>()
      .catch(() => null)
    if (!f) return noEncontrada
    return {
      noindex: !f.verificada,
      titulo: `${f.pregunta} | ${nombre}`,
      descripcion: resumen(f.respuesta),
      cuerpo: `<article class="ssr"><h1>${esc(f.pregunta)}</h1>${f.respuesta
        .split('\n')
        .filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`)
        .join('')}</article>`,
      datos: {
        '@context': 'https://schema.org',
        '@type': 'QAPage',
        mainEntity: { '@type': 'Question', name: f.pregunta, answerCount: 1, acceptedAnswer: { '@type': 'Answer', text: f.respuesta, url: `${url.origin}${url.pathname}` } },
      },
    }
  }
  if (/^\/preguntas\/?$/.test(url.pathname)) {
    const fs = (await env.DB.prepare(`select slug, pregunta from faq where verificada = 1 order by pregunta`).all<{ slug: string; pregunta: string }>().catch(() => ({ results: [] }))).results
    return {
      titulo: `Preguntas frecuentes | ${nombre}`,
      descripcion: `${fs.length} preguntas respondidas con los artículos que las sustentan. ${descripcion}`.slice(0, 155),
      cuerpo: `<nav class="ssr"><h1>Preguntas frecuentes</h1><ul>${fs.map(f => `<li><a href="/preguntas/${esc(f.slug)}">${esc(f.pregunta)}</a></li>`).join('')}</ul></nav>`,
    }
  }
  if (/^\/explorar\/?$/.test(url.pathname))
    return { titulo: `Explorar: qué artículos se citan entre sí | ${nombre}`, descripcion: `Las citas entre los artículos de ${CORPUS.materia}: cuáles citan más, cuáles los citan y cómo se conectan.` }
  if (/^\/como-funciona\/?$/.test(url.pathname))
    return { titulo: `Cómo funciona | ${nombre}`, descripcion: `Cómo ${nombre} busca en ${CORPUS.materia} y responde con los artículos, y qué tan seguido acierta en preguntas de prueba.` }
  if (url.pathname === '/') return sitio
  return noEncontrada
}

/**
 * The shared index.html, dressed for this site and this path: name, theme and wordmark (so the first paint is on
 * brand), title, description, canonical URL, schema.org data and the server-rendered text.
 */
export async function pagina(res: Response, env: Env, url: URL) {
  const p = await contenido(env, url).catch(() => ({ titulo: CORPUS.sitio.titulo, descripcion: CORPUS.sitio.descripcion }) as Pagina)
  const { nombre } = CORPUS.sitio
  const canonica = `${url.origin}${url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '')}`
  const atributo = (valor: string) => ({ element: (e: Element) => void e.setAttribute('content', valor) })
  const cabeza = [
    ...(p.noindex ? ['<meta name="robots" content="noindex">'] : [`<link rel="canonical" href="${esc(canonica)}">`]),
    `<meta property="og:url" content="${esc(canonica)}">`,
    `<meta property="og:site_name" content="${esc(nombre)}">`,
    '<meta property="og:locale" content="es_MX">',
    `<meta property="og:image" content="${url.origin}/og/${CORPUS.prefijo}.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    ...(env.GOOGLE_SITE_VERIFICATION ? [`<meta name="google-site-verification" content="${esc(env.GOOGLE_SITE_VERIFICATION)}">`] : []),
    ...(p.datos ? [`<script type="application/ld+json">${JSON.stringify(p.datos).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('')
  const vestida = new HTMLRewriter()
    .on('html', { element: e => void e.setAttribute('data-site', CORPUS.prefijo) })
    .on('a.wordmark', {
      element: e => {
        e.setInnerContent(nombre)
        e.setAttribute('aria-label', `${nombre}, inicio`)
      },
    })
    .on('title', { element: e => void e.setInnerContent(p.titulo) })
    .on('meta[name="description"]', atributo(p.descripcion))
    .on('meta[property="og:title"]', atributo(p.titulo))
    .on('meta[property="og:description"]', atributo(p.descripcion))
    .on('head', { element: e => void e.append(cabeza, { html: true }) })
    .on('main#main', { element: e => void (p.cuerpo && e.prepend(p.cuerpo, { html: true })) })
    .on('.colophon-warn', { element: e => void e.setInnerContent(CORPUS.sitio.aviso) })
    .on('.colophon-fuente', { element: e => void e.setInnerContent(editores()) })
    .transform(res)
  return p.estado ? new Response(vestida.body, { status: p.estado, headers: vestida.headers }) : vestida
}

/** Every article, rule and published question, for search engines. */
export async function sitemap(env: Env, origen: string) {
  const [arts, fs] = await Promise.all([
    env.DB.prepare(`select ley, id from articulo where length(texto) > 40 order by rowid`).all<{ ley: string; id: string }>(),
    env.DB.prepare(`select slug from faq where verificada = 1`).all<{ slug: string }>().catch(() => ({ results: [] as { slug: string }[] })),
  ])
  const rutas = ['/', '/preguntas', ...(CORPUS.guia ? [GUIA] : []), '/explorar', '/como-funciona', ...fs.results.map(f => `/preguntas/${f.slug}`), ...arts.results.map(a => `/${a.ley}/${encodeURIComponent(a.id)}`)]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rutas
    .map(r => `<url><loc>${esc(origen + r)}</loc></url>`)
    .join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } })
}

/**
 * Crawl everything but the chat and the dev routes, and say where the sitemap is. Pages render from /graphql, so it
 * stays open: Google's renderer obeys robots.txt for the page's own fetches, and with /graphql blocked every page
 * showed the "No se pudo conectar" banner, which Google read as a soft 404. /chat stays closed because answers cost money.
 */
export const robots = (origen: string) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /chat\nDisallow: /dev/\n\nSitemap: ${origen}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  })
