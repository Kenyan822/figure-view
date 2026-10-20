import type { Register } from 'claude-code'

import { drawDiagram } from './lib/diagram'
import { drawFlow, parseFlow, type Cell, type Colour } from './lib/flow'
import { splitSegments } from './lib/segments'

const PROMPT = `In this terminal, fenced \`\`\`mermaid blocks in your replies are drawn as coloured terminal text (no picture), instantly and at any length.
- flowchart TD / LR is drawn as filled cards: nodes A[text], A(text), A{decision}, A[(database)]; a second line with <br> (A["Title<br>short detail"]); a colour with :::blue / green / orange / red / purple / yellow / teal / gray; groups with subgraph id[Title] … end; edges -->, -.->, ==>, -->|label|, A & B --> C.
- sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2 and xychart-beta (bar / line) are drawn too. In stateDiagram use ASCII ids with quoted labels (state "受付" as S1).
- Keep labels short; a diagram wider than the terminal is shown as code.`

// The module's own state: a reload starts it over.
const state = { isOn: true, isDark: true }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mermaid',
      description: 'Mermaid の図を文字で描く表示: on / off / dark / light',
      argumentHint: '[on|off|dark|light]',
    })
    return next(e)
  })

  on('command.run', { command: 'mermaid' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') state.isOn = arg === 'on'
    else if (arg === 'dark' || arg === 'light') state.isDark = arg === 'dark'
    else if (arg) return { text: '使い方: /mermaid on | off | dark | light' }
    $.ui.invalidate('ui.render')
    return { text: `mermaid-view: ${state.isOn ? 'on' : 'off'}（${state.isDark ? 'dark' : 'light'}）` }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!state.isOn || !e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'mermaid-view:prompt', text: PROMPT, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!state.isOn || e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const segments = splitSegments(e.props.text)
    if (!segments.some(s => s.kind === 'mermaid')) return next(e)

    const { Box, Markdown, Text } = $.ui.resolve(e)
    // Room beside the bullet column the engine draws before a reply.
    const columns = Math.max(10, (e.viewport?.columns ?? 80) - 4)

    const parts = segments.map((seg, i) => {
      if (seg.kind === 'md') return <Markdown key={`md${i}`} text={seg.text} />
      const flow = parseFlow(seg.src)
      const drawn = flow && drawFlow(flow, columns)
      const diagram = drawn ? null : drawDiagram(seg.src, columns)
      const grid = drawn?.grid ?? diagram
      if (!grid) return <Markdown key={`src${i}`} text={'```mermaid\n' + seg.src + '\n```'} />
      // Diagrams other than flowcharts stay plain: the terminal's own colours.
      if (diagram) {
        return (
          <Box key={`fig${i}`} flexDirection="column" marginY={1}>
            {diagram.map((row, y) => <Text key={`r${y}`} wrap="truncate-end">{row.map(c => c.ch).join('')}</Text>)}
          </Box>
        )
      }
      return (
        <Box key={`fig${i}`} flexDirection="column" marginY={1}>
          {grid.map((row, y) => (
            <Text key={`r${y}`} wrap="truncate-end">
              {runsOf(row).map((run, j) => (
                <Text key={`c${j}`} {...styleOf(run.cell)}>{run.text}</Text>
              ))}
            </Text>
          ))}
          {(drawn?.notes ?? []).map((note, j) => <Text key={`n${j}`} dimColor>{note}</Text>)}
        </Box>
      )
    })

    const body = <Box flexDirection="column" flexGrow={1}>{parts}</Box>
    if (!e.props.isFirstOfReply) return <Box paddingLeft={2}>{body}</Box>
    return (
      <Box flexDirection="row">
        <Text>⏺ </Text>
        {body}
      </Box>
    )
  })
}

// Colours. Cards are filled by their `:::colour`, else by shape (decisions
// and databases stand out); lines and arrows are a soft accent, labels small
// pills, subgraphs a faint tint, chart series their own colour.
type Palette = Record<Colour, string> & { text: string; sub: string; border: string; line: string; arrow: string; label: string; labelText: string; groups: string[]; title: string }
const PALETTE: { dark: Palette; light: Palette } = {
  dark: {
    blue: '#2d4a6e', green: '#2f5a3c', orange: '#6e4a22', red: '#6b2f35', purple: '#4f3a6e', yellow: '#5f5420', teal: '#22585a', gray: '#3e434d',
    text: '#f5f5f5', sub: '#c9d1dc', border: '#f0f0f0', line: '#7f93ad', arrow: '#c8d6ea', label: '#3a3f4b', labelText: '#e8edf5',
    groups: ['#23262d', '#262329', '#22282a', '#28261f'], title: '#9aa6b8',
  },
  light: {
    blue: '#dbe7f7', green: '#dcefe0', orange: '#f6e3cc', red: '#f6d9db', purple: '#ece0f5', yellow: '#f4ecc6', teal: '#d5eeee', gray: '#e6e8ec',
    text: '#1f2328', sub: '#4a5361', border: '#3a4250', line: '#8a9bb0', arrow: '#3b5578', label: '#e8ecf2', labelText: '#2a3442',
    groups: ['#f3f5f8', '#f6f3f8', '#f2f7f7', '#f8f6ef'], title: '#5b6676',
  },
}
const SHAPE_COLOUR: Record<string, Colour> = { box: 'blue', round: 'green', diamond: 'yellow', db: 'purple' }

type Run = { text: string; cell: Cell }

// Consecutive cells drawn alike become one run of text.
function runsOf(row: Cell[]): Run[] {
  const runs: Run[] = []
  for (const cell of row) {
    if (cell.ch === '') continue
    const last = runs[runs.length - 1]
    const same =
      last && last.cell.kind === cell.kind && last.cell.node === cell.node && last.cell.head === cell.head &&
      last.cell.group === cell.group && last.cell.hex === cell.hex
    if (last && same) last.text += cell.ch
    else runs.push({ text: cell.ch, cell })
  }
  return runs
}

function styleOf(cell: Cell): { color?: string; backgroundColor?: string; bold?: boolean } {
  const c = state.isDark ? PALETTE.dark : PALETTE.light
  const tint = cell.group === undefined ? undefined : c.groups[cell.group % c.groups.length]
  // A box the vendored renderer drew has no node: the default fill.
  const fill = cell.node ? c[cell.node.colour ?? SHAPE_COLOUR[cell.node.shape] ?? 'blue'] : c.blue
  if (cell.hex) return { color: cell.hex, backgroundColor: tint }
  switch (cell.kind) {
    case 'node':
      return { color: cell.head || !cell.node ? c.text : c.sub, backgroundColor: fill, bold: cell.head || !cell.node }
    case 'fill':
      return { backgroundColor: fill }
    case 'border':
      // The outline sits on the background: a filled cell behind a corner
      // would show the fill outside the rounded frame.
      return { color: c.border, backgroundColor: tint }
    case 'arrow':
      return { color: c.arrow, backgroundColor: tint }
    case 'line':
      return { color: c.line, backgroundColor: tint }
    case 'label':
      return { color: c.labelText, backgroundColor: c.label }
    case 'title':
      return { color: c.title, backgroundColor: tint, bold: true }
    default:
      return { backgroundColor: tint }
  }
}
