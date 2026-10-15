export const typeDefs = /* GraphQL */ `
  "Every document in the index: four federal tax laws, the 2026 income law, four regulations and the 2026 Miscelánea."
  enum LawCode {
    "Ley del Impuesto sobre la Renta"
    LISR
    "Ley del Impuesto al Valor Agregado"
    LIVA
    "Ley del Impuesto Especial sobre Producción y Servicios"
    LIEPS
    "Código Fiscal de la Federación"
    CFF
    "Ley de Ingresos de la Federación para 2026"
    LIF
    "Reglamento de la Ley del ISR"
    RLISR
    "Reglamento de la Ley del IVA"
    RLIVA
    "Reglamento de la Ley del IEPS"
    RLIEPS
    "Reglamento del Código Fiscal de la Federación"
    RCFF
    "Resolución Miscelánea Fiscal para 2026 (SAT's compiled edition): numbered rules instead of articles"
    RMF
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

  type Query {
    laws: [Law!]!
    law(code: LawCode!): Law
    article(law: LawCode!, number: String!): Article
    "Plain-language search. One hit per article with the passage that matched best; articles the query names (LISR 151, artículo 29-A del CFF) come first."
    search(query: String!, mode: SearchMode = VECTOR, law: LawCode, first: Int = 10): [SearchHit!]!
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
  }

  type Law {
    code: LawCode!
    name: String!
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
    "Character spans in text that cite another article."
    links: [Link!]!
    cites: [Article!]!
    citedBy: [Article!]!
    "SAT criteria that cite this article: how SAT reads it (Anexo 7) and practices it calls improper (Anexo 3)."
    criteria(kind: CriterionKind): [Criterion!]!
  }

  type Citation {
    "LISR:27"
    from: ID!
    to: ID!
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
