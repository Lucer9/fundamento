ObjC.import('PDFKit')
/**
 * PDF text as visual lines, for layouts where plain extraction scrambles the order (the RMF prints rule numbers
 * in a margin column). Fragments on the same baseline are joined left to right. Output: one "page\tx\ty\ttext" per line (PDF points, y grows upward).
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
      if (last && Math.abs(last.y - f.y) < 3) last.t += ' ' + f.t
      else merged.push({ x: f.x, y: f.y, t: f.t })
    }
    for (const m of merged) out.push(`${p + 1}\t${Math.round(m.x)}\t${Math.round(m.y)}\t${m.t}`)
  }
  return out.join('\n')
}
