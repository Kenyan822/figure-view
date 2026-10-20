import { expect, test } from 'claude-code/testing'

import { estimateRows, nearView } from '../hooks/lib/rows'
import { splitSegments } from '../hooks/lib/segments'
import { convertInlineMath, latexToUnicode } from '../hooks/lib/unicode'

test('display math and typst fences become pictures, the rest stays text', () => {
  const text = ['前置き', '$$', 'a^2 + b^2 = c^2', '$$', '中', '```typst', '#box[x]', '```', '後'].join('\n')
  expect(splitSegments(text)).toEqual([
    { kind: 'md', text: '前置き' },
    { kind: 'math', src: 'a^2 + b^2 = c^2' },
    { kind: 'md', text: '中' },
    { kind: 'typst', src: '#box[x]' },
    { kind: 'md', text: '後' },
  ])
})

test('one-line $$ and \\[ \\] are display math', () => {
  expect(splitSegments('$$ x = 1 $$')).toEqual([{ kind: 'math', src: 'x = 1' }])
  expect(splitSegments('\\[\ny = 2\n\\]')).toEqual([{ kind: 'math', src: 'y = 2' }])
})

test('a block still streaming stays text', () => {
  expect(splitSegments('説明\n$$\nx = ')).toEqual([{ kind: 'md', text: '説明\n$$\nx = ' }])
  expect(splitSegments('```typst\n#box')).toEqual([{ kind: 'md', text: '```typst\n#box' }])
})

test('$$ inside another code fence is left alone', () => {
  const text = '```python\nprint("$$")\n```'
  expect(splitSegments(text)).toEqual([{ kind: 'md', text }])
})

test('inline LaTeX becomes Unicode', () => {
  expect(latexToUnicode('x^2 + \\alpha_t')).toBe('x² + αₜ')
  expect(latexToUnicode('\\frac{m_t}{\\sqrt{v_t}+\\epsilon}')).toBe('mₜ/(√vₜ+ε)')
  expect(latexToUnicode('w \\leftarrow w - \\eta \\cdot g')).toBe('w ← w - η · g')
  expect(latexToUnicode('\\mathrm{KL}(p_s \\| p_t)')).toBe('KL(pₛ ‖ pₜ)')
})

test('inline math is converted outside code, prices are not math', () => {
  expect(convertInlineMath('重み $w_t$ と `$x$` の比較')).toBe('重み wₜ と `$x$` の比較')
  expect(convertInlineMath('$5 and $10 dollars')).toBe('$5 and $10 dollars')
  expect(convertInlineMath('```\n$a$\n```')).toBe('```\n$a$\n```')
})

test('only pictures within a screen of the view are drawn', () => {
  // Ten parts of 10 rows; rows 40-49 in view, so 30-59 is within a screen.
  const heights = Array(10).fill(10)
  expect(nearView(heights, { first: 40, last: 49, of: 100 })).toEqual([false, false, true, true, true, true, false, false, false, false])
  expect(nearView(heights, null).every(x => !x)).toBe(true)
  expect(nearView(heights, undefined).every(x => x)).toBe(true)
})

test('rows count wide characters twice', () => {
  expect(estimateRows('ab\n日本語日本語', 4)).toBe(1 + 3)
})
