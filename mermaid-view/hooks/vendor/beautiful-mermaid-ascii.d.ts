// The part of beautiful-mermaid's API this mod uses.
export function renderMermaidASCII(
  text: string,
  options?: {
    colorMode?: 'none' | 'ansi16' | 'ansi256' | 'truecolor' | 'html' | 'auto'
    useAscii?: boolean
    theme?: { fg?: string; border?: string; line?: string; arrow?: string; accent?: string; bg?: string }
  },
): string
