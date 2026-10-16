import { CORPUS } from './corpus.ts'
import type { Env } from './indice.ts'
import { LEYES } from './parse.ts'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESC[c])

/** Plain text for a meta description: no citation markers, one line, at most `n` characters at a word boundary. */
const resumen = (t: string, n = 155) => {
  const s = t.replace(/\s*\[[^\]]*\]/g, '').replace(/[⟨⟩]/g, '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s
}

type Pagina = { titulo: string; descripcion: string; cuerpo?: string; datos?: unknown }

/**
 * What a crawler should find at a path, without running the app: the page's own title and description, its text in
 * the HTML, and schema.org data (Legislation for an article or rule, QAPage for a published question). The app
 * replaces the server-rendered text when it mounts.
 */
async function contenido(env: Env, url: URL): Promise<Pagina> {
  const { nombre, lema, descripcion } = CORPUS.sitio
  const sitio = { titulo: `${nombre} · ${lema}`, descripcion }
  const art = url.pathname.match(/^\/([A-Z]+)\/([^/]+)\/?$/)
  if (art && LEYES[art[1]]) {
    const [ley, id] = [art[1], decodeURIComponent(art[2])]
    const doc = LEYES[ley]
    const fila = await env.DB.prepare(`select texto, titulo from articulo where ley = ?1 and id = ?2`).bind(ley, id).first<{ texto: string; titulo: string | null }>()
    if (!fila) return sitio
    const etiqueta = `${doc.tipo === 'reglas' ? 'Regla' : 'Artículo'} ${id}${fila.titulo ? `: ${fila.titulo}` : ''}`
    return {
      titulo: `${etiqueta} · ${doc.nombre} | ${nombre}`,
      descripcion: resumen(fila.texto),
      cuerpo: `<article class="ssr"><p>${esc(doc.nombre)}</p><h1>${esc(etiqueta)}</h1>${fila.texto
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
      },
    }
  }
  const pregunta = url.pathname.match(/^\/preguntas\/([^/]+)\/?$/)
  if (pregunta) {
    const f = await env.DB.prepare(`select pregunta, respuesta from faq where slug = ?1`).bind(pregunta[1]).first<{ pregunta: string; respuesta: string }>().catch(() => null)
    if (!f) return sitio
    return {
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
    const fs = (await env.DB.prepare(`select slug, pregunta from faq order by pregunta`).all<{ slug: string; pregunta: string }>().catch(() => ({ results: [] }))).results
    return {
      titulo: `Preguntas frecuentes | ${nombre}`,
      descripcion: `${fs.length} preguntas respondidas con los artículos que las sustentan. ${descripcion}`.slice(0, 155),
      cuerpo: `<nav class="ssr"><h1>Preguntas frecuentes</h1><ul>${fs.map(f => `<li><a href="/preguntas/${esc(f.slug)}">${esc(f.pregunta)}</a></li>`).join('')}</ul></nav>`,
    }
  }
  return sitio
}

/**
 * The shared index.html, dressed for this site and this path: name, theme and wordmark (so the first paint is on
 * brand), title, description, canonical URL, schema.org data and the server-rendered text.
 */
export async function pagina(res: Response, env: Env, url: URL) {
  const p = await contenido(env, url).catch(() => ({ titulo: `${CORPUS.sitio.nombre} · ${CORPUS.sitio.lema}`, descripcion: CORPUS.sitio.descripcion }) as Pagina)
  const { nombre } = CORPUS.sitio
  const canonica = `${url.origin}${url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '')}`
  const atributo = (valor: string) => ({ element: (e: Element) => void e.setAttribute('content', valor) })
  const cabeza = [
    `<link rel="canonical" href="${esc(canonica)}">`,
    `<meta property="og:url" content="${esc(canonica)}">`,
    ...(env.GOOGLE_SITE_VERIFICATION ? [`<meta name="google-site-verification" content="${esc(env.GOOGLE_SITE_VERIFICATION)}">`] : []),
    ...(p.datos ? [`<script type="application/ld+json">${JSON.stringify(p.datos).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('')
  return new HTMLRewriter()
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
    .transform(res)
}

/** Every article, rule and published question, for search engines. */
export async function sitemap(env: Env, origen: string) {
  const [arts, fs] = await Promise.all([
    env.DB.prepare(`select ley, id from articulo where length(texto) > 40 order by rowid`).all<{ ley: string; id: string }>(),
    env.DB.prepare(`select slug from faq`).all<{ slug: string }>().catch(() => ({ results: [] as { slug: string }[] })),
  ])
  const rutas = ['/', '/preguntas', '/explorar', '/como-funciona', ...fs.results.map(f => `/preguntas/${f.slug}`), ...arts.results.map(a => `/${a.ley}/${encodeURIComponent(a.id)}`)]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rutas
    .map(r => `<url><loc>${esc(origen + r)}</loc></url>`)
    .join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } })
}

/** Crawl everything but the API, and say where the sitemap is. */
export const robots = (origen: string) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /graphql\nDisallow: /dev/\n\nSitemap: ${origen}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  })
