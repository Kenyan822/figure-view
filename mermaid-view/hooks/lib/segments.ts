// Splits an answer's markdown into text and ```mermaid fences. A fence still
// open at the end (the answer is streaming) stays text.

export type Segment = { kind: 'md'; text: string } | { kind: 'mermaid'; src: string }

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
    if (!fence) {
      md.push(line)
      i++
      continue
    }
    const mark = fence[1] ?? '```'
    let close = -1
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? ''
      if (l.trimStart().startsWith(mark) && l.trim().replace(/[`~]/g, '') === '') {
        close = j
        break
      }
    }
    if (close < 0) {
      md.push(...lines.slice(i))
      break
    }
    if ((fence[2] ?? '').toLowerCase() === 'mermaid') {
      flushMd()
      out.push({ kind: 'mermaid', src: lines.slice(i + 1, close).join('\n') })
    } else {
      md.push(...lines.slice(i, close + 1))
    }
    i = close + 1
  }
  flushMd()
  return out
}
