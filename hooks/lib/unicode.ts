// Inline math ($…$, \(…\)) cannot sit inside a line of terminal text as a
// picture, so it is written in Unicode: an approximation (x², α, √v, a/b) that
// stays selectable and searchable. Code spans and fences are left as written.

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  sum: 'Σ', prod: 'Π', int: '∫', infty: '∞', partial: '∂', nabla: '∇',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', circ: '∘',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡',
  propto: '∝', ll: '≪', gg: '≫',
  leftarrow: '←', gets: '←', rightarrow: '→', to: '→', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
  Leftrightarrow: '⇔', mapsto: '↦', implies: '⇒', iff: '⇔',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  mid: '|', vert: '|', Vert: '‖', lVert: '‖', rVert: '‖', langle: '⟨', rangle: '⟩',
  ldots: '…', cdots: '⋯', dots: '…', prime: '′', star: '⋆', dagger: '†',
  log: 'log', ln: 'ln', exp: 'exp', max: 'max', min: 'min', arg: 'arg', argmax: 'argmax', argmin: 'argmin',
  sin: 'sin', cos: 'cos', tan: 'tan', lim: 'lim', det: 'det', Pr: 'Pr', E: 'E',
  ',': ' ', ';': ' ', ':': ' ', '!': '', quad: '  ', qquad: '    ', '{': '{', '}': '}', '%': '%', '$': '$',
  '|': '‖', '\\': ' ',
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', t: 'ᵗ', T: 'ᵀ', k: 'ᵏ', a: 'ᵃ', b: 'ᵇ',
  c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', u: 'ᵘ', v: 'ᵛ', x: 'ˣ', y: 'ʸ', '*': '*', '′': '′',
}

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
  m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}

const DROP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', 'limits', 'nolimits'])
const KEEP_ARG = new Set(['mathrm', 'text', 'textrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'boldsymbol', 'bm', 'mathcal', 'mathbb', 'textbf', 'textit'])
const ACCENT: Record<string, string> = { hat: '̂', bar: '̄', overline: '̅', tilde: '̃', vec: '⃗', dot: '̇' }

// Reads one argument: a {group} or a single token, from `s` at `i`.
function arg(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++
  if (s[i] === '{') {
    let depth = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++
      else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1] as [string, number]
    }
    return [s.slice(i + 1), s.length]
  }
  if (s[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
    if (m) return [m[0], i + m[0].length]
  }
  return [s[i] ?? '', i + 1]
}

// One symbol with its scripts (mₜ, x², 10) needs no parentheses around it.
const wrap = (x: string) => ([...x].length > 1 && !/^[\p{L}\p{N}.′²³¹⁰-₟ᴀ-ᶿ]+$/u.test(x) ? `(${x})` : x)

function script(x: string, table: Record<string, string>, mark: string): string {
  const chars = [...x]
  if (chars.length && chars.every(c => table[c])) return chars.map(c => table[c]).join('')
  return `${mark}${wrap(x)}`
}

export function latexToUnicode(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i] ?? ''
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i))
      const name = m?.[1] ?? ''
      i += m ? m[0].length : 1
      if (DROP.has(name)) continue
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, j] = arg(src, i)
        const [b, k] = arg(src, j)
        out += `${wrap(latexToUnicode(a))}/${wrap(latexToUnicode(b))}`
        i = k
        continue
      }
      if (name === 'sqrt') {
        const [a, j] = arg(src, i)
        out += `√${wrap(latexToUnicode(a))}`
        i = j
        continue
      }
      if (KEEP_ARG.has(name)) {
        const [a, j] = arg(src, i)
        out += latexToUnicode(a)
        i = j
        continue
      }
      if (ACCENT[name]) {
        const [a, j] = arg(src, i)
        const inner = latexToUnicode(a)
        out += [...inner].length === 1 ? inner + ACCENT[name] : `${name}(${inner})`
        i = j
        continue
      }
      out += SYMBOLS[name] ?? name
      continue
    }
    if (c === '^' || c === '_') {
      const [a, j] = arg(src, i + 1)
      const inner = latexToUnicode(a)
      out += c === '^' ? script(inner, SUP, '^') : script(inner, SUB, '_')
      i = j
      continue
    }
    if (c === '{' || c === '}') {
      i++
      continue
    }
    out += c
    i++
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

// Rewrites the inline math of markdown text, outside code spans and fences.
export function convertInlineMath(md: string): string {
  const lines = md.split('\n')
  let inFence = false
  return lines
    .map(line => {
      if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, k) => (k % 2 === 1 ? part : convertPart(part)))
        .join('')
    })
    .join('\n')
}

function convertPart(s: string): string {
  return s
    .replace(/\\\((.+?)\\\)/g, (_, m: string) => latexToUnicode(m))
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?![\w$])/g, (_, pre: string, m: string) => pre + latexToUnicode(m))
}
