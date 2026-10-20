// Splits an answer's markdown into the parts drawn as text and the parts
// drawn as pictures: display math ($$…$$ or \[…\] on lines of their own) and
// ```typst fences. A part still open at the end (the block is streaming) stays
// text, so only finished sources are ever compiled.

export type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'math'; src: string }
  | { kind: 'typst'; src: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/

export function splitSegments(text: string): Segment[] {
  const lines = text.split('\n')
  const out: Segment[] = []
  let md: string[] = []
  const flushMd = () => {
    if (md.length) out.push({ kind: 'md', text: md.join('\n') })
    md = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1] ?? '```'
      const close = findClose(lines, i + 1, l => l.trimStart().startsWith(mark) && l.trim().replace(/[`~]/g, '') === '')
      if (close < 0) {
        md.push(...lines.slice(i))
        break
      }
      if ((fence[2] ?? '').toLowerCase() === 'typst') {
        flushMd()
        out.push({ kind: 'typst', src: lines.slice(i + 1, close).join('\n') })
      } else {
        md.push(...lines.slice(i, close + 1))
      }
      i = close + 1
      continue
    }

    const t = line.trim()
    const open = t.startsWith('$$') ? '$$' : t.startsWith('\\[') ? '\\[' : ''
    if (open) {
      const shut = open === '$$' ? '$$' : '\\]'
      const rest = t.slice(2)
      // $$ x $$ on one line.
      if (rest.trimEnd().endsWith(shut) && rest.trim().length >= 2) {
        flushMd()
        out.push({ kind: 'math', src: rest.trimEnd().slice(0, -2).trim() })
        i++
        continue
      }
      const close = findClose(lines, i + 1, l => l.trimEnd().endsWith(shut))
      if (close < 0) {
        md.push(...lines.slice(i))
        break
      }
      const last = (lines[close] ?? '').trimEnd()
      const body = [rest, ...lines.slice(i + 1, close), last.slice(0, -2)].join('\n').trim()
      flushMd()
      if (body) out.push({ kind: 'math', src: body })
      i = close + 1
      continue
    }

    md.push(line)
    i++
  }
  flushMd()
  return out
}

function findClose(lines: string[], from: number, isClose: (line: string) => boolean): number {
  for (let j = from; j < lines.length; j++) if (isClose(lines[j] ?? '')) return j
  return -1
}
