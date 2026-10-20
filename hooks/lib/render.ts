import type { EngineInterface } from 'claude-code'

import { PIECE_TYP } from './piece'

// One finished formula or drawing, compiled once per source, theme and cell
// size. `png` is base64; `columns` x `rows` is its box in terminal cells.
export type Picture =
  | { status: 'ready'; png: string; columns: number; rows: number }
  | { status: 'failed'; error: string }

export type Cell = { width: number; height: number }

export type Look = { fg: string; bg: string; isDark: boolean }

// Pictures are drawn at twice the terminal's css pixels, so they stay sharp on
// a Retina screen while each formula stays well under a megabyte of memory.
const SCALE = 2
const COMPILE_TIMEOUT_MS = 20000
// The terminal's own text is about 0.62 of a row tall.
const TEXT_PER_ROW = 0.62

// Typst must not fetch: a package that is not vendored fails at once.
const NO_NETWORK = { HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' }

// What `$.process.run` reads from the terminal: rows, columns and its pixel
// size (TIOCGWINSZ), for the size of one cell.
const CELL_PL =
  'open(T, "</dev/tty") or exit 1; my $w = " " x 8; ioctl(T, ($^O eq "darwin" ? 0x40087468 : 0x5413), $w) or exit 1; print join(" ", unpack("S4", $w))'

export type Env = { typst: string; dir: string; packages: string; cell: Cell }

export async function setUp($: EngineInterface): Promise<Env | { error: string }> {
  const typst = await findTypst($)
  if (!typst) return { error: 'typst が見つかりません（brew install typst）' }
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
  const dir = `${tmp}/figure-view-${await $.session.id()}`
  // Work folders of sessions that ended more than two days ago.
  await $.process.run(['find', tmp, '-maxdepth', '1', '-name', 'figure-view-*', '-type', 'd', '-mtime', '+2', '-exec', 'rm', '-rf', '{}', '+'], { timeoutMs: 10000 }).catch(() => null)
  const made = await $.process.run(['mkdir', '-p', dir])
  if (made.exitCode !== 0) return { error: `作業フォルダを作れません: ${made.stderr.trim()}` }
  await $.fs.write(`${dir}/piece.typ`, PIECE_TYP)
  return { typst, dir, packages: `${$.plugin.root}/render/packages`, cell: await cellSize($) }
}

async function findTypst($: EngineInterface): Promise<string | null> {
  for (const path of ['/opt/homebrew/bin/typst', '/usr/local/bin/typst']) {
    const got = await $.fs.stat(path).catch(() => null)
    if (got?.kind === 'file') return path
  }
  const found = await $.process.run(['sh', '-lc', 'command -v typst'], { timeoutMs: 5000 }).catch(() => null)
  const path = found?.exitCode === 0 ? found.stdout.trim() : ''
  return path || null
}

// The cell size in css pixels; a common 13px monospace cell when the terminal
// does not report its pixels.
async function cellSize($: EngineInterface): Promise<Cell> {
  const got = await $.process.run(['perl', '-e', CELL_PL], { timeoutMs: 5000 }).catch(() => null)
  const [rows = 0, cols = 0, xpix = 0, ypix = 0] = (got?.exitCode === 0 ? got.stdout : '').trim().split(/\s+/).map(Number)
  if (rows > 0 && cols > 0 && xpix > 0 && ypix > 0) return { width: xpix / cols, height: ypix / rows }
  return { width: 8, height: 17 }
}

export async function compile(
  $: EngineInterface,
  env: Env,
  kind: 'math' | 'typst',
  src: string,
  look: Look,
  maxColumns: number,
  zoom: number,
): Promise<Picture> {
  const key = hash(`${kind}\n${src}\n${look.fg}\n${zoom}`)
  const srcName = `${key}.${kind === 'math' ? 'tex' : 'typ'}`
  const out = `${env.dir}/${key}-${maxColumns}.png`
  await $.fs.write(`${env.dir}/${srcName}`, src)
  const { width: cw, height: ch } = env.cell
  const inputs = {
    kind,
    src: `/${srcName}`,
    cw: String(cw),
    ch: String(ch),
    maxw: String(maxColumns * cw),
    fs: String(ch * TEXT_PER_ROW),
    zoom: String(zoom),
    fg: look.fg,
    bg: look.bg,
    dark: look.isDark ? '1' : '0',
  }
  const argv = [
    env.typst, 'compile', '--root', env.dir, '--package-path', env.packages, '--ppi', String(72 * SCALE),
    ...Object.entries(inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
    `${env.dir}/piece.typ`, out,
  ]
  const ran = await $.process.run(argv, { timeoutMs: COMPILE_TIMEOUT_MS, env: NO_NETWORK }).catch((err: unknown) => ({
    exitCode: 1,
    stdout: '',
    stderr: String(err),
  }))
  if (ran.exitCode !== 0) return { status: 'failed', error: firstError(ran.stderr) }
  const { base64 } = await $.fs.read(out, { as: 'bytes' })
  const size = pngSize(base64)
  if (!size) return { status: 'failed', error: 'PNG を読めませんでした' }
  return {
    status: 'ready',
    png: base64,
    columns: clamp(Math.round(size.width / SCALE / cw), 1, 255),
    rows: clamp(Math.round(size.height / SCALE / ch), 1, 255),
  }
}

function firstError(stderr: string): string {
  const line = stderr.split('\n').find(l => l.startsWith('error:')) ?? stderr.split('\n')[0] ?? ''
  return line.replace(/^error:\s*/, '').trim() || 'typst が失敗しました'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Width and height from the IHDR of a base64 PNG.
export function pngSize(base64: string): { width: number; height: number } | null {
  const bytes = decodeBase64(base64.slice(0, 32))
  if (bytes.length < 24 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const at = (o: number) => bytes[o] ?? 0
  const u32 = (o: number) => ((at(o) << 24) | (at(o + 1) << 16) | (at(o + 2) << 8) | at(o + 3)) >>> 0
  return { width: u32(16), height: u32(20) }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeBase64(s: string): number[] {
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const c of s) {
    const v = B64.indexOf(c)
    if (v < 0) break
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return out
}

// FNV-1a, for file names and cache keys.
export function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
