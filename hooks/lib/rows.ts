// Which pictures of a long answer are near the viewport. The engine reports
// the rows of the answer in view (onScreen); the mod knows each picture's
// height and estimates the text's, so each picture gets a row span and only
// those near the view are drawn as pictures.

export type View = { first: number; last: number; of: number }

// Rows a markdown text takes at `columns`: one per line, more for a line
// wider than the room (a wide CJK character takes two columns).
export function estimateRows(text: string, columns: number): number {
  let rows = 0
  for (const line of text.split('\n')) {
    let width = 0
    for (const ch of line) width += isWide(ch) ? 2 : 1
    rows += Math.max(1, Math.ceil(width / Math.max(1, columns)))
  }
  return rows
}

function isWide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}

// For each part's height in rows, whether it is within one screen of the
// view. The estimated heights are scaled to the answer's laid-out height, so
// an estimate that is off by a few rows per paragraph does not add up.
export function nearView(heights: readonly number[], view: View | null | undefined): boolean[] {
  if (view === undefined) return heights.map(() => true)
  if (view === null) return heights.map(() => false)
  const total = heights.reduce((a, b) => a + b, 0)
  const scale = total > 0 && view.of > 0 ? view.of / total : 1
  const screen = view.last - view.first + 1
  const from = view.first - screen
  const to = view.last + screen
  let top = 0
  return heights.map(h => {
    const start = top * scale
    const end = (top + h) * scale
    top += h
    return end >= from && start <= to
  })
}
