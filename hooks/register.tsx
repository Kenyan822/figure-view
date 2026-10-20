import type { EngineInterface, Register, Timer } from 'claude-code'

import { compile, setUp, type Env, type Look, type Picture } from './lib/render'
import { estimateRows, nearView } from './lib/rows'
import { splitSegments, type Segment } from './lib/segments'
import { convertInlineMath, latexToUnicode } from './lib/unicode'

type Piece = Exclude<Segment, { kind: 'md' }>

const LOOKS: Record<'dark' | 'light', Look> = {
  dark: { fg: '#f2f2f2', bg: '#1e1e1e', isDark: true },
  light: { fg: '#24292f', bg: '#ffffff', isDark: false },
}

// How long a draw waits for a compile before it shows the source. Outside
// fullscreen a finished answer goes to the terminal's scrollback and is not
// drawn again, so the first draw waits for most compiles to land.
const WAIT_MS = 3000
// The compile worker's period while work is queued, and while idle (each
// tick is a dispatch, so an idle worker ticks rarely), and how many Typst
// processes it runs at once.
const PUMP_MS = 50
const IDLE_MS = 1000
const MAX_RUNNING = 2
// Pictures kept in memory (base64 PNGs, tens of kB each); the least recently
// drawn go first and are compiled again if they come back.
const MAX_PICTURES = 300
// Pictures are drawn three times as large as the terminal text by default: at
// the text's own size, subscripts and axis labels are too small to read.
const DEFAULT_ZOOM = 3
// Drawings carry their own text and are wide already: at the formulas' zoom a
// plot fills the screen and several megabytes of picture memory.
const DRAWING_SCALE = 0.6
// Blank rows above and below each picture, apart from the text around it.
const PICTURE_MARGIN = 1

const PROMPT = `In this terminal, display math and Typst drawings in your replies are drawn as pictures; the rest of a reply stays plain terminal text.
- Display math: put LaTeX between $$ lines (or $$ … $$ on one line); it is typeset.
- Inline math ($…$) is shown as Unicode text (x², α, a/b), so keep inline math short and simple; use display math for fractions, sums, matrices or anything tall.
- Diagrams, flow charts and plots: a fenced \`\`\`typst block (Typst 0.15, markup mode, code lines start with #). Offline packages: #import "@preview/cetz:0.5.2", #import "@preview/cetz-plot:0.1.4": plot, chart, #import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge. A \`theme\` dictionary is in scope: theme.fg, theme.muted, theme.bg, theme.border, theme.blue/green/red/orange/yellow/purple, theme.palette, theme.width, theme.height, theme.dark. Default strokes are black and invisible on a dark terminal: always pass theme.fg (fletcher node-stroke/edge-stroke, cetz set-style(stroke: theme.fg)). Fill shapes with the opaque theme.fill-blue / fill-green / fill-orange / fill-red / fill-purple / fill-yellow, never a transparentize()d colour (text on a see-through fill is hard to read). Keep drawings within theme.width x theme.height; #page and #set page are errors.
- When explaining a mechanism, a structure, a flow, a comparison, a trend or a calculation, add typst drawings or display math wherever they convey it better than words alone (as many as help; not for simple factual answers).
- Tables, lists and code stay normal markdown.`

// The module's own state: a reload starts it over, which only recompiles.
const state = {
  isOn: true,
  look: LOOKS.dark,
  zoom: DEFAULT_ZOOM,
  env: null as Promise<Env | { error: string }> | null,
  envValue: null as Env | { error: string } | null,
  pictures: new Map<string, Picture>(),
  // Pieces waiting for the worker, by key, and the keys it is compiling.
  queue: new Map<string, { seg: Piece; columns: number; zoom: number; look: Look }>(),
  running: new Set<string>(),
  lastAnswer: '',
  // The worker's next tick, and what runs it at once (set at session start).
  nextTick: null as Timer | null,
  wake: null as (() => void) | null,
  // Bumped by /figure redraw: new Image keys make the terminal get every
  // picture again (Orca drops them when its tab is switched away).
  epoch: 0,
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'figure',
      description: '数式と図だけを画像にする表示: on / off / dark / light / size <倍率%> / redraw / open / status',
      argumentHint: '[on|off|dark|light|size <%>|redraw|open|status]',
    })
    // A draw's own processes are stopped as soon as a newer draw replaces it
    // (every scroll), so the compiles run on this timer, outside any draw.
    // A newly queued piece runs the worker at once instead of at the idle
    // tick, so it starts compiling without waiting up to IDLE_MS.
    state.wake = () => {
      state.nextTick?.cancel()
      state.nextTick = $.clock.after(0, () => tick($))
    }
    tick($)
    return next(e)
  })

  on('command.run', { command: 'figure' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'open') return { text: await openLastAnswer($) }
    if (arg === 'redraw') {
      state.epoch++
      $.ui.invalidate('ui.render')
      return { text: '画像を送り直しました' }
    }
    const size = /^size\s+(\d+)%?$/.exec(arg)
    if (arg === 'on' || arg === 'off') state.isOn = arg === 'on'
    else if (arg === 'dark' || arg === 'light') state.look = LOOKS[arg]
    else if (size && Number(size[1]) >= 50 && Number(size[1]) <= 800) state.zoom = Number(size[1]) / 100
    else if (arg && arg !== 'status') return { text: '使い方: /figure on | off | dark | light | size <50〜800> | redraw | open | status' }
    $.ui.invalidate('ui.render')
    return { text: await statusOf($) }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.answer.trim()) state.lastAnswer = e.answer
    return done
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!state.isOn || !e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'figure-view:prompt', text: PROMPT, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!state.isOn || e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const segments = splitSegments(e.props.text)
    const hasPicture = segments.some(s => s.kind !== 'md')
    const hasInline = /\$[^$\n]+\$|\\\(/.test(e.props.text)
    if (!hasPicture && !hasInline) return next(e)

    const ready = state.envValue ?? { error: '準備中' }
    const { Box, Image, Markdown, Text } = $.ui.resolve(e)
    // Room beside the bullet column the engine draws before a reply.
    const columns = Math.max(10, (e.viewport?.columns ?? 80) - 4)
    type Part =
      | { kind: 'md'; text: string }
      | { kind: 'source'; seg: Piece; isDim: boolean }
      | { kind: 'failed'; seg: Piece; error: string }
      | { kind: 'picture'; seg: Piece; picture: Extract<Picture, { status: 'ready' }> }
    const items: Part[] = []
    for (const seg of segments) {
      if (seg.kind === 'md') items.push({ kind: 'md', text: convertInlineMath(seg.text) })
      else if ('error' in ready) items.push({ kind: 'source', seg, isDim: false })
      else {
        const picture = await pictureOf($, seg, columns)
        if (!picture) items.push({ kind: 'source', seg, isDim: true })
        else if (picture.status === 'failed') items.push({ kind: 'failed', seg, error: picture.error })
        else items.push({ kind: 'picture', seg, picture })
      }
    }

    // Only the pictures within a screen of the view are drawn as pictures; the
    // others are text of the same height, so the terminal holds few pictures
    // at a time and one it dropped is sent again when it comes back in view.
    const heights = items.map(item =>
      item.kind === 'md' ? estimateRows(item.text, columns)
      : item.kind === 'picture' ? item.picture.rows + 2 * PICTURE_MARGIN
      : estimateRows(sourceOf(item.seg), columns) + (item.kind === 'failed' ? 1 : 0),
    )
    const isNear = nearView(heights, e.props.onScreen)

    const parts = items.map((item, i) => {
      switch (item.kind) {
        case 'md':
          return <Markdown key={`md${i}`} text={item.text} />
        case 'source':
          return <Markdown key={`src${i}`} text={sourceOf(item.seg)} dimColor={item.isDim} />
        case 'failed':
          return (
            <Box key={`err${i}`} flexDirection="column">
              <Markdown text={sourceOf(item.seg)} />
              <Text dimColor>figure-view: {item.error}</Text>
            </Box>
          )
        case 'picture':
          return isNear[i] ? (
            <Box key={`img${i}`} marginY={PICTURE_MARGIN}>
              <Image key={`img${i}-${state.epoch}`} source={{ png: item.picture.png }} columns={item.picture.columns} rows={item.picture.rows} alt={altOf(item.seg)} />
            </Box>
          ) : (
            <Box key={`off${i}`} height={item.picture.rows} marginY={PICTURE_MARGIN}>
              <Text dimColor wrap="truncate">{offscreenOf(item.seg)}</Text>
            </Box>
          )
      }
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

function keyOf(seg: Piece, columns: number): string {
  return `${seg.kind}|${state.look.fg}|${state.zoom}|${columns}|${seg.src}`
}

// The picture of a finished piece from the cache; else the piece is queued
// for the worker, and a draw waits up to WAIT_MS before showing the source
// (the worker redraws the transcript when the picture lands).
async function pictureOf($: EngineInterface, seg: Piece, columns: number): Promise<Picture | undefined> {
  const key = keyOf(seg, columns)
  const kept = state.pictures.get(key)
  if (kept) {
    state.pictures.delete(key)
    state.pictures.set(key, kept)
    return kept
  }
  if (!state.running.has(key)) {
    state.queue.set(key, { seg, columns, zoom: seg.kind === 'typst' ? state.zoom * DRAWING_SCALE : state.zoom, look: state.look })
    state.wake?.()
  }
  for (let waited = 0; !state.pictures.has(key) && waited < WAIT_MS; waited += 50) await $.clock.sleep(50)
  return state.pictures.get(key)
}

// Runs the worker and schedules the next run: soon while pieces wait or
// compile, rarely otherwise.
function tick($: EngineInterface): void {
  pump($)
  const isBusy = state.queue.size > 0 || state.running.size > 0 || !state.envValue
  state.nextTick = $.clock.after(isBusy ? PUMP_MS : IDLE_MS, () => tick($))
}

// The compile worker: sets up Typst once, then starts queued compiles, a few
// at a time, and redraws the transcript as each picture lands.
function pump($: EngineInterface): void {
  if (!state.env) {
    state.env = setUp($).then(env => {
      state.envValue = env
      $.ui.invalidate('ui.render')
      return env
    })
  }
  const env = state.envValue
  if (!env || 'error' in env) return
  for (const [key, job] of state.queue) {
    if (state.running.size >= MAX_RUNNING) break
    state.queue.delete(key)
    state.running.add(key)
    void compile($, env, job.seg.kind, job.seg.src, job.look, job.columns, job.zoom)
      .catch((err: unknown): Picture => ({ status: 'failed', error: String(err) }))
      .then(picture => {
        state.pictures.set(key, picture)
        for (const old of state.pictures.keys()) {
          if (state.pictures.size <= MAX_PICTURES) break
          state.pictures.delete(old)
        }
        state.running.delete(key)
        $.ui.invalidate('ui.render')
      })
  }
}

async function statusOf($: EngineInterface): Promise<string> {
  const ready = state.envValue ?? (state.env ? await state.env : { error: '準備中' })
  const head = `${state.isOn ? 'on' : 'off'}（${state.look.isDark ? 'dark' : 'light'}、大きさ ${Math.round(state.zoom * 100)}%）`
  if ('error' in ready) return `${head}\n使えません: ${ready.error}`
  return `${head}\ntypst: ${ready.typst}\nセル: ${ready.cell.width.toFixed(1)} x ${ready.cell.height.toFixed(1)} px\n画像: ${state.pictures.size} 件`
}

function sourceOf(seg: Piece): string {
  return seg.kind === 'math' ? `$$\n${seg.src}\n$$` : `\`\`\`typst\n${seg.src}\n\`\`\``
}

function altOf(seg: Piece): string {
  return seg.kind === 'math' ? seg.src.replace(/\s+/g, ' ').slice(0, 200) : '[typst の図]'
}

function offscreenOf(seg: Piece): string {
  return seg.kind === 'math' ? latexToUnicode(seg.src.replace(/\s+/g, ' ')) : '［図］'
}

// Writes the last answer to <session folder>/.figure-view/answer.md and opens it
// in Orca's Markdown preview, which typesets its math (KaTeX) and Mermaid
// without the terminal's picture memory. Orca opens files of its worktree only;
// outside Orca the file goes to the system's default app for .md.
async function openLastAnswer($: EngineInterface): Promise<string> {
  if (!state.lastAnswer) return 'まだ回答がありません'
  const cwd = await $.session.cwd()
  const made = await $.process.run(['mkdir', '-p', `${cwd}/.figure-view`])
  if (made.exitCode !== 0) return `フォルダを作れません: ${made.stderr.trim()}`
  const path = `${cwd}/.figure-view/answer.md`
  await $.fs.write(path, state.lastAnswer)
  const inOrca = (await $.env.get('TERM_PROGRAM')) === 'Orca'
  if (inOrca) {
    const opened = await $.process.run(['sh', '-lc', 'orca file open "$1" --focus --json', 'sh', '.figure-view/answer.md'], { cwd, timeoutMs: 15000 })
    if (opened.exitCode === 0 && opened.stdout.includes('"ok": true')) return `直前の回答を ${path} に書き出し、Orca で開きました`
  }
  const shown = await $.process.run(['open', path], { timeoutMs: 15000 }).catch(() => null)
  if (shown?.exitCode === 0) return `直前の回答を ${path} に書き出し、既定のアプリで開きました`
  return `直前の回答を ${path} に書き出しました（開くことはできませんでした）`
}
