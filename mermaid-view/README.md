# mermaid-view

A [Claude Code](https://code.claude.com) mod that draws the ` ```mermaid ` blocks of Claude's answers as terminal text — no pictures, so it is instant, copyable, searchable and works in any terminal.

| Diagram | Drawn as |
|---|---|
| `flowchart` / `graph` (TD, LR) | filled cards with light rounded outlines, coloured by `:::colour` or by shape; `subgraph` groups on a tinted background; edges that skip layers or go back are routed round the outside |
| `sequenceDiagram`, `classDiagram`, `erDiagram`, `stateDiagram-v2`, `xychart-beta` | plain box drawing by [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)'s terminal renderer |

Wide (CJK) characters are measured as two cells, so boxes stay aligned around Japanese labels. A diagram wider than the terminal is shown as its Mermaid source.

## Install

```
/plugin install mermaid-view --marketplace Kenyan822/figure-view
```

Claude Code 2.1.298 or later. No other dependency.

## Commands

| Command | What it does |
|---|---|
| `/mermaid on` / `off` | Turns the drawing on or off |
| `/mermaid dark` / `light` | Flowchart colours for a dark or a light terminal |

## Flowchart syntax it reads

`A[text]`, `A(text)`, `A{decision}`, `A[(database)]`, a second line with `<br>` (`A["Title<br>detail"]`), `:::blue` / `green` / `orange` / `red` / `purple` / `yellow` / `teal` / `gray` (or `classDef … fill:#hex`), `subgraph id[Title] … end`, edges `-->`, `-.->`, `==>`, `-->|label|`, `A & B --> C`.

## Limits

- With [figure-view](../README.md) installed too, an answer that has both a ` ```mermaid ` block and math or a ` ```typst ` block is drawn by only one of the two mods.
- Edges in ER diagrams can take detours; use short relationship labels.

## Licence

MIT. The vendored renderer keeps its own licence: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
