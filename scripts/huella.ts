import { createHash } from 'node:crypto'

/** Content address for chunks and embedding-cache entries: unchanged text keeps its id across re-ingests. */
export const huella = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 32)
