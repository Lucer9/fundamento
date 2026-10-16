ObjC.import('PDFKit')
/**
 * PDF text as visual lines, for layouts where plain extraction scrambles the order (the RMF prints rule numbers
 * in a margin column). Fragments within 3 pt of the same baseline are joined left to right (a bold heading can sit
 * a couple of points below the text it opens). Output: one "page\tx\ty\ttext" per line (PDF points, y grows upward).
 * Usage: osascript -l JavaScript scripts/pdf-lineas.js file.pdf
 */
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  const out = []
  for (let p = 0; p < doc.pageCount; p++) {
    const page = doc.pageAtIndex(p)
    const lines = page.selectionForRect(page.boundsForBox(0)).selectionsByLine
    const frags = []
    for (let i = 0; i < lines.count; i++) {
      const l = lines.objectAtIndex(i)
      const b = l.boundsForPage(page)
      const t = l.string.js.replace(/\s+/g, ' ').trim()
      if (t) frags.push({ x: b.origin.x, y: b.origin.y, t })
    }
    frags.sort((a, b) => b.y - a.y || a.x - b.x)
    const merged = []
    for (const f of frags) {
      const last = merged[merged.length - 1]
      if (last && Math.abs(last.y - f.y) < 3) last.partes.push(f)
      else merged.push({ y: f.y, partes: [f] })
    }
    for (const m of merged) {
      m.partes.sort((a, b) => a.x - b.x)
      out.push(`${p + 1}\t${Math.round(m.partes[0].x)}\t${Math.round(m.y)}\t${m.partes.map(f => f.t).join(' ')}`)
    }
  }
  return out.join('\n')
}
