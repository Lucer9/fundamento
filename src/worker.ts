import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor'
import { GraphQLError } from 'graphql'
import { createSchema, createYoga, type Plugin } from 'graphql-yoga'
import { NOMBRES, type Hit } from './buscar.ts'
import { multas } from './cdmx.ts'
import { CORPUS, PUBLICO_EVAL, PUBLICO_RESPUESTAS } from './corpus.ts'
import { buscar, cargar, clave, db, loaders, type Criterio, type Ctx, type Env, type Fila, type Modo } from './indice.ts'
import { LEYES, derogado, type Ley } from './parse.ts'
import { responder } from './responder.ts'
import { typeDefs } from './schema.graphql.ts'

type Tipo = 'NORMATIVE' | 'IMPROPER_PRACTICE'
const ANEXO: Record<Tipo, number> = { NORMATIVE: 7, IMPROPER_PRACTICE: 3 }
const FAMILIA: Record<string, string> = { LAW: 'ley', REGULATION: 'reglamento', RULES: 'reglas' }

/** Documents a search keeps: those named in `laws` plus every document of the `kinds` asked for; null keeps all. */
const documentos = (laws: Ley[] = [], kinds: string[] = []) => {
  const leyes = [...laws, ...Object.keys(LEYES).filter(l => kinds.some(k => FAMILIA[k] === LEYES[l].tipo))]
  return leyes.length ? leyes : null
}

const resolvers = {
  Query: {
    site: () => ({
      name: CORPUS.sitio.nombre,
      tagline: CORPUS.sitio.lema,
      description: CORPUS.sitio.descripcion,
      examples: CORPUS.sitio.ejemplos,
      defaultMode: CORPUS.modo,
      disclaimer: CORPUS.sitio.aviso,
      lists: CORPUS.listas.map(l => ({ title: l.titulo, note: l.nota, laws: l.leyes })),
      uma: CORPUS.uma ? { value: CORPUS.uma.valor, since: CORPUS.uma.desde, source: CORPUS.uma.fuente } : null,
      evalPath: `/${PUBLICO_EVAL.replace('public/', '')}`,
      answersEvalPath: `/${PUBLICO_RESPUESTAS.replace('public/', '')}`,
    }),
    laws: () => (Object.keys(NOMBRES) as Ley[]).map(code => ({ code })),
    law: (_: unknown, { code }: { code: Ley }) => ({ code }),
    article: (_: unknown, a: { law: Ley; number: string }, ctx: Ctx) => ctx.load.articulo.load(clave(a.law, a.number)),
    search: async (_: unknown, a: { query: string; mode: Modo; law?: Ley; laws?: Ley[]; kinds?: string[]; first: number }, ctx: Ctx) => {
      if (!(await ctx.env.SEARCH_LIMITER.limit({ key: ctx.ip })).success) throw new GraphQLError('Demasiadas búsquedas, espera un minuto.')
      return buscar(ctx.env, ctx.db, a.query, a.mode, a.law ?? null, a.first, documentos(a.laws, a.kinds))
    },
    answer: (_: unknown, a: { question: string }, ctx: Ctx) => responder(ctx, a.question),
    mostCited: (_: unknown, a: { first: number; law?: Ley }, ctx: Ctx) =>
      ctx.db.all<{ k: string; count: number }>(
        `select a_ley || ':' || a_id as k, count(distinct de_ley || ':' || de_id) as count from enlace
         where ?2 is null or a_ley = ?2 group by a_ley, a_id order by count desc limit ?1`,
        Math.min(a.first, 100),
        a.law ?? null,
      ),
    amendments: async (_: unknown, a: { law?: Ley }, ctx: Ctx) =>
      (
        await ctx.db.all<{ date: string; keys: string }>(
          `select r.value as date, group_concat(a.ley || ':' || a.id) as keys from articulo a, json_each(a.reformas) r
           where ?1 is null or a.ley = ?1 group by r.value order by r.value desc`,
          a.law ?? null,
        )
      ).map(r => ({ date: r.date, keys: r.keys.split(',') })),
    criteria: (_: unknown, a: { law?: Ley; kind?: Tipo }, ctx: Ctx) =>
      ctx.db.all<Criterio>(
        `select * from criterio where (?1 is null or materia = ?1) and (?2 is null or anexo = ?2) order by n`,
        a.law ?? null,
        a.kind ? ANEXO[a.kind] : null,
      ),
    citations: (_: unknown, a: { law?: Ley }, ctx: Ctx) =>
      ctx.db.all<{ from: string; to: string }>(
        `select distinct de_ley || ':' || de_id as "from", a_ley || ':' || a_id as "to" from enlace
         where ?1 is null or de_ley = ?1 or a_ley = ?1`,
        a.law ?? null,
      ),
    stats: async (_: unknown, __: unknown, ctx: Ctx) =>
      (
        await ctx.db.all<Record<string, number>>(
          `select (select count(*) from articulo) as articles,
                  (select count(*) from (select distinct de_ley, de_id, a_ley, a_id from enlace)) as citations,
                  (select count(*) from fragmento) as chunks,
                  (select count(*) from criterio) as criteria`,
        )
      )[0],
  },
  Law: {
    name: (l: { code: Ley }) => NOMBRES[l.code],
    shortName: (l: { code: Ley }) => LEYES[l.code].corto,
    kind: (l: { code: Ley }) => ({ ley: 'LAW', reglamento: 'REGULATION', reglas: 'RULES' })[LEYES[l.code].tipo],
    regulates: (l: { code: Ley }) => (LEYES[l.code].reglamenta ? { code: LEYES[l.code].reglamenta } : null),
    source: (l: { code: Ley }) => LEYES[l.code].pdf,
    articleCount: async (l: { code: Ley }, _: unknown, ctx: Ctx) =>
      (await ctx.db.all<{ n: number }>(`select count(*) as n from articulo where ley = ?1`, l.code))[0].n,
    articleKeys: async (l: { code: Ley }, _: unknown, ctx: Ctx) =>
      (await ctx.db.all<{ k: string }>(`select ley || ':' || id as k from articulo where ley = ?1 order by orden`, l.code)).map(r => r.k),
    articles: async (l: { code: Ley }, a: { first: number; after?: string }, ctx: Ctx) => {
      const desde = a.after ? Number(atob(a.after)) : -1
      const rows = await ctx.db.all<Fila>(
        `select * from articulo where ley = ?1 and orden > ?2 order by orden limit ?3`,
        l.code,
        desde,
        Math.min(a.first, 100) + 1,
      )
      const nodes = rows.slice(0, Math.min(a.first, 100))
      for (const r of nodes) ctx.load.articulo.prime(clave(r.ley, r.id), r)
      return { nodes, pageInfo: { hasNextPage: rows.length > nodes.length, endCursor: nodes.length ? btoa(String(nodes[nodes.length - 1].orden)) : null } }
    },
  },
  Article: {
    key: (r: Fila) => clave(r.ley, r.id),
    law: (r: Fila) => ({ code: r.ley }),
    number: (r: Fila) => r.id,
    title: (r: Fila) => r.titulo ?? null,
    fines: (r: Fila) => (CORPUS.uma ? multas(r.texto).map(m => ({ start: m.inicio, end: m.fin, times: m.veces })) : []),
    location: (r: Fila) => JSON.parse(r.ubicacion),
    text: (r: Fila) => r.texto,
    repealed: (r: Fila) => derogado(r.texto),
    amendedOn: (r: Fila) => JSON.parse(r.reformas),
    amountsUpdatedOn: (r: Fila) => JSON.parse(r.actualizaciones),
    links: async (r: Fila, _: unknown, ctx: Ctx) =>
      (await ctx.load.enlaces.load(clave(r.ley, r.id))).map(e => ({ start: e.inicio, end: e.fin, key: e.a })),
    cites: async (r: Fila, _: unknown, ctx: Ctx) => cargar(ctx, (await ctx.load.cita.load(clave(r.ley, r.id))).map(c => c.a)),
    citedBy: async (r: Fila, _: unknown, ctx: Ctx) => cargar(ctx, (await ctx.load.citadoPor.load(clave(r.ley, r.id))).map(c => c.a)),
    criteria: async (r: Fila, a: { kind?: Tipo }, ctx: Ctx) =>
      (await ctx.load.criterios.load(clave(r.ley, r.id))).filter(c => !a.kind || c.anexo === ANEXO[a.kind]),
  },
  Link: { target: (l: { key: string }, _: unknown, ctx: Ctx) => ctx.load.articulo.load(l.key) },
  SearchHit: {
    article: (h: Hit, _: unknown, ctx: Ctx) => ctx.load.articulo.load(clave(h.ley, h.id)),
    passage: (h: Hit) => h.texto ?? '',
    fines: (h: Hit) => (CORPUS.uma ? multas(h.texto ?? '').map(m => ({ start: m.inicio, end: m.fin, times: m.veces })) : []),
  },
  Answer: {
    sources: (a: { keys: string[] }, _: unknown, ctx: Ctx) => cargar(ctx, a.keys),
    criteria: async (a: { criterios: number[] }, _: unknown, ctx: Ctx) => {
      const rows = await ctx.db.all<Criterio>(`select * from criterio where n in (select value from json_each(?1))`, JSON.stringify(a.criterios))
      return a.criterios.flatMap(n => rows.filter(r => r.n === n))
    },
  },
  CitationCount: { article: (c: { k: string }, _: unknown, ctx: Ctx) => ctx.load.articulo.load(c.k) },
  Amendment: { articles: (a: { keys: string[] }, _: unknown, ctx: Ctx) => cargar(ctx, a.keys) },
  Criterion: {
    number: (c: Criterio) => c.n,
    id: (c: Criterio) => c.id || null,
    kind: (c: Criterio) => (c.anexo === 3 ? 'IMPROPER_PRACTICE' : 'NORMATIVE'),
    law: (c: Criterio) => c.materia,
    title: (c: Criterio) => c.tema,
    text: (c: Criterio) => c.texto,
    articles: async (c: Criterio, _: unknown, ctx: Ctx) => cargar(ctx, await ctx.load.articulosDeCriterio.load(c.n)),
  },
}

const consultasD1: Plugin<Ctx> = {
  onExecute: () => ({
    onExecuteDone: ({ args, result, setResult }) => {
      if (Symbol.asyncIterator in result) return
      const { db } = args.contextValue as Ctx
      setResult({ ...result, extensions: { ...result.extensions, d1Queries: db.n, ...(db.degradado ? { degraded: 'keyword-only' } : {}) } })
    },
  }),
}

const defaultQuery = /* GraphQL */ `# ¿Puedo deducir el deducible del seguro de gastos médicos?
query {
  search(query: "deducible del seguro de gastos médicos", first: 3) {
    score
    article {
      key
      location
      citedBy { key }
      criteria { title }
    }
  }
}
`

const yoga = createYoga<{ env: Env }>({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  landingPage: false,
  maskedErrors: { errorMessage: 'Algo salió mal. Intenta de nuevo en un momento.' },
  graphiql: { title: 'fundamento · GraphQL', defaultQuery },
  plugins: [
    EnvelopArmorPlugin({ maxDepth: { n: 8 }, maxAliases: { n: 5 }, maxTokens: { n: 1500 }, costLimit: { maxCost: 5000 } }),
    consultasD1,
  ],
  context: ({ request, env }) => {
    const d = db(env)
    return {
      env,
      db: d,
      ip: request.headers.get('cf-connecting-ip') ?? 'local',
      modeloRespuesta: (env.DEV === '1' && request.headers.get('x-answer-model')) || env.ANSWER_MODEL,
      evaluando: env.DEV === '1' && request.headers.get('x-eval') === '1',
      excluir: env.DEV === '1' && request.headers.get('x-excluir-criterio') ? Number(request.headers.get('x-excluir-criterio')) : null,
      sinCriterios: env.DEV === '1' && request.headers.get('x-sin-criterios') === '1',
      load: loaders(d, request.headers.get('x-batch') !== 'off'),
    }
  },
})

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/graphql') return yoga.fetch(request, { env })
    if (url.pathname === '/dev/vec' && env.DEV === '1') {
      const { vector, topK, filter } = await request.json<{ vector: number[]; topK: number; filter?: VectorizeVectorMetadataFilter }>()
      return Response.json(await env.VEC.query(vector, { topK, filter }))
    }
    if (url.pathname === '/dev/ai' && env.DEV === '1') {
      const { model, input } = await request.json<{ model: string; input: unknown }>()
      return Response.json(await env.AI.run(model as keyof AiModels, input as never))
    }
    const res = await env.ASSETS.fetch(request)
    return res.headers.get('content-type')?.includes('text/html') ? marca(res) : res
  },
} satisfies ExportedHandler<Env>

/** The shared index.html carries the active site's name, description and theme, for browser tabs, link previews and a first paint without the other site's colours. */
function marca(res: Response) {
  const { nombre, lema, descripcion } = CORPUS.sitio
  const contenido = (valor: string) => ({ element: (e: Element) => void e.setAttribute('content', valor) })
  return new HTMLRewriter()
    .on('html', { element: e => void e.setAttribute('data-site', CORPUS.prefijo) })
    .on('a.wordmark', {
      element: e => {
        e.setInnerContent(nombre)
        e.setAttribute('aria-label', `${nombre}, inicio`)
      },
    })
    .on('title', { element: e => void e.setInnerContent(`${nombre} · ${lema}`) })
    .on('meta[name="description"]', contenido(descripcion))
    .on('meta[property="og:title"]', contenido(nombre))
    .on('meta[property="og:description"]', contenido(descripcion))
    .transform(res)
}
