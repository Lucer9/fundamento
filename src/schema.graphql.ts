import { CORPUS } from './corpus.ts'

export const typeDefs = /* GraphQL */ `
  "Every document in the index, in display order."
  enum LawCode {
${Object.entries(CORPUS.docs)
  .map(([codigo, d]) => `    "${d.nombre}"\n    ${codigo}`)
  .join('\n')}
  }

  enum LawKind {
    "Passed by Congress."
    LAW
    "Issued by the President to carry out a law."
    REGULATION
    "SAT's yearly general rules; its units are rules (2.7.1.21), not articles."
    RULES
  }

  enum SearchMode {
    "SQLite FTS5 over whole words minus stopwords, bm25-ranked."
    KEYWORD
    "Embedding similarity in Vectorize."
    VECTOR
    "Reciprocal rank fusion of KEYWORD and VECTOR."
    HYBRID
  }

  "The site this API serves: its name, how search splits results into lists, and the UMA for fines."
  type Site {
    name: String!
    "The home page's title."
    title: String!
    tagline: String!
    description: String!
    "One line for the footer: what the site is not."
    disclaimer: String!
    "The search mode measured best for this corpus; the site's default."
    defaultMode: SearchMode!
    "Example questions for the home page."
    examples: [String!]!
    "Search result lists in order; ask for each with search(laws:)."
    lists: [SearchList!]!
    "Unidad de Medida y Actualización used to turn fines written in UMA into pesos; null where the corpus has none."
    uma: Uma
    "Static files with this corpus's search and answer eval results."
    evalPath: String!
    answersEvalPath: String!
    "What to know when a traffic agent stops you, each tip with the articles it rests on; null where the site has no guide."
    guide: Guide
  }

  type Guide {
    "What the site covers."
    scope: String!
    "Why a reader should know the rules, in two or three sentences."
    knowTheRules: String!
    tips: [Tip!]!
  }

  type Tip {
    "URL fragment of the tip on the guide page."
    slug: String!
    title: String!
    text: String!
    "Articles the tip rests on, as LAW:number keys."
    cites: [String!]!
    "Official page behind a claim no article makes."
    source: TipSource
  }

  type TipSource {
    name: String!
    url: String!
  }

  "A plain-Spanish summary of an article, written by Claude from its official text. The official text governs."
  type Summary {
    "A few words naming what the article is about."
    topic: String!
    text: String!
    "Questions a person might ask that the article answers."
    questions: [String!]!
    model: String!
  }

  type SearchList {
    title: String!
    note: String!
    laws: [LawCode!]!
  }

  type Uma {
    "Pesos per UMA, daily value."
    value: Float!
    "Date the value took effect (YYYY-MM-DD)."
    since: String!
    source: String!
  }

  type Query {
    site: Site!
    laws: [Law!]!
    law(code: LawCode!): Law
    article(law: LawCode!, number: String!): Article
    "Plain-language search. One hit per article with the passage that matched best; articles the query names (LISR 151, artículo 29-A del CFF) come first. laws (or kinds) keeps only some documents: ask for each of site.lists separately, because in one ranking the rules crowd out the law they apply."
    search(query: String!, mode: SearchMode = VECTOR, law: LawCode, laws: [LawCode!], kinds: [LawKind!], first: Int = 10): [SearchHit!]!
    "A short answer grounded in retrieved articles. Every citation in the text is one of the sources."
    answer(question: String!): Answer!
    "Articles other articles point to most."
    mostCited(first: Int = 10, law: LawCode): [CitationCount!]!
    "Every Diario Oficial date that amended at least one article, newest first."
    amendments(law: LawCode): [Amendment!]!
    criteria(law: LawCode, kind: CriterionKind): [Criterion!]!
    "Every distinct citation between two articles, as article keys: the whole graph in one request."
    citations(law: LawCode): [Citation!]!
    stats: Stats!
    "Published questions and answers, newest first."
    faqs: [Faq!]!
    faq(slug: ID!): Faq
  }

  type Law {
    code: LawCode!
    name: String!
    "Short label for badges and filters, e.g. Ley del ISR."
    shortName: String!
    kind: LawKind!
    "For a regulation, the law it carries out."
    regulates: Law
    "The official PDF the text was parsed from."
    source: String!
    articleCount: Int!
    "Every article key in order (LISR:1, LISR:2, ...): enough to lay out a graph without paging."
    articleKeys: [ID!]!
    articles(first: Int = 50, after: String): ArticleConnection!
  }

  type Article {
    "LISR:27, or RMF:2.7.1.21 for a Miscelánea rule"
    key: ID!
    law: Law!
    number: String!
    "A Miscelánea rule's heading (epígrafe); null for articles, which have none."
    title: String
    "Título, capítulo and sección headings the article sits under."
    location: [String!]!
    text: String!
    repealed: Boolean!
    "Diario Oficial dates of the amendments noted in the text (YYYY-MM-DD)."
    amendedOn: [String!]!
    "Dates SAT's Resolución Miscelánea Fiscal updated or compiled peso amounts (fines, thresholds) in the article. Inflation updates, not amendments."
    amountsUpdatedOn: [String!]!
    "Fines written in multiples of the UMA, as character spans in text; empty where the site has no UMA (site.uma)."
    fines: [Fine!]!
    "Character spans in text that cite another article."
    links: [Link!]!
    cites: [Article!]!
    citedBy: [Article!]!
    "Articles closest in meaning that neither cite nor are cited by this one (scripts/relacionados.ts): where an obligation's fine lives in another document."
    related: [Related!]!
    "Plain-Spanish summary written by Claude; null until one is generated."
    summary: Summary
    "SAT criteria that cite this article: how SAT reads it (Anexo 7) and practices it calls improper (Anexo 3)."
    criteria(kind: CriterionKind): [Criterion!]!
  }

  type Related {
    article: Article!
    "Cosine similarity of the two articles' mean embeddings."
    score: Float!
  }

  "A question answered ahead of time with Claude and published as a page; the answer box serves it for that question."
  type Faq {
    slug: ID!
    question: String!
    "Plain text with the same citation markers as Answer.text."
    answer: String!
    sources: [Article!]!
    criteria: [Criterion!]!
    model: String!
    "Checked by a judge model against SAT's criterio or a hand-written reference answer."
    verified: Boolean!
    date: String!
  }

  type Citation {
    "LISR:27"
    from: ID!
    to: ID!
  }

  type Fine {
    start: Int!
    end: Int!
    "UMA multiples: three tiers (minimum, middle, maximum), a range's two ends, or one amount."
    times: [Float!]!
  }

  type Link {
    start: Int!
    end: Int!
    target: Article!
  }

  type SearchHit {
    article: Article!
    score: Float!
    passage: String!
    "Fines in the passage, as spans relative to it (see Article.fines)."
    fines: [Fine!]!
  }

  type Answer {
    "Plain text with citation markers: [LISR 151] or [RMF 2.7.1.21] for articles and rules, [SAT 12] for criteria (12 = Criterion.number)."
    text: String!
    sources: [Article!]!
    "SAT criteria the answer cites."
    criteria: [Criterion!]!
    model: String!
    cached: Boolean!
  }

  type CitationCount {
    article: Article!
    count: Int!
  }

  type Amendment {
    date: String!
    articles: [Article!]!
  }

  enum CriterionKind {
    "Criterio normativo, Anexo 7 de la RMF 2026: how SAT interprets the law."
    NORMATIVE
    "Criterio no vinculativo, Anexo 3 de la RMF 2026: a practice SAT considers improper."
    IMPROPER_PRACTICE
  }

  type Criterion {
    "Stable number used in answer citations ([SAT 12])."
    number: Int!
    "SAT's own id, e.g. 47/ISR/N; null when the PDF layout detached it."
    id: String
    kind: CriterionKind!
    law: LawCode!
    title: String!
    text: String!
    articles: [Article!]!
  }

  type ArticleConnection {
    nodes: [Article!]!
    pageInfo: PageInfo!
  }

  type PageInfo {
    endCursor: String
    hasNextPage: Boolean!
  }

  type Stats {
    articles: Int!
    citations: Int!
    chunks: Int!
    criteria: Int!
  }
`
