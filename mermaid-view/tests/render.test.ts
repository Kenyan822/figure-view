import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/lib/diagram'
import { drawFlow, parseFlow } from '../hooks/lib/flow'
import { splitSegments } from '../hooks/lib/segments'

const textOf = (grid: { ch: string }[][] | null | undefined) => grid?.map(row => row.map(c => c.ch).join('')) ?? []

test('mermaid fences are split from the text; an open one stays text', () => {
  expect(splitSegments('前\n```mermaid\nflowchart LR\n  A --> B\n```\n後')).toEqual([
    { kind: 'md', text: '前' },
    { kind: 'mermaid', src: 'flowchart LR\n  A --> B' },
    { kind: 'md', text: '後' },
  ])
  expect(splitSegments('```mermaid\nflowchart LR')).toEqual([{ kind: 'md', text: '```mermaid\nflowchart LR' }])
})

test('a flowchart is drawn as cards and arrows', () => {
  const flow = parseFlow('flowchart LR\n  A["入力<br>説明"]:::green -->|読む| B[(DB)]')
  expect(flow?.nodes.map(n => [n.lines, n.shape, n.colour])).toEqual([[['入力', '説明'], 'box', 'green'], [['DB'], 'db', undefined]])
  const lines = textOf(flow && drawFlow(flow, 80)?.grid)
  expect(lines.join('\n')).toContain('入力')
  expect(lines.join('\n')).toContain('▶')
})

test('a sequence diagram is drawn with wide characters aligned and filled boxes', () => {
  const grid = drawDiagram('sequenceDiagram\n  participant U as ユーザー\n  participant A as アプリ\n  U->>A: 質問', 100)
  expect(textOf(grid).some(l => l.includes('│ ユーザー │'))).toBe(true)
  expect(grid?.some(row => row.some(c => c.kind === 'node' && c.ch === 'ユ'))).toBe(true)
  expect(drawDiagram('pie\n  "a": 1', 100)).toBeNull()
})
