/**
 * Which column of a Markdown table is its prose: the one that says the most. The theme lets that
 * column take the width the others leave, and keeps the chips in the others (names, commands,
 * defaults) on one line. CSS can't tell the columns apart, so the build marks the prose column's
 * cells with `data-prose`, and each other cell of one word with `data-word`: a word such as
 * "pre-commit" would otherwise break at its hyphen. It also puts each table in a box that scrolls,
 * and keeps short inline code anywhere on one line.
 */

/** Below this many characters a row, on average, no column is prose: a table of figures, say. */
const PROSE_CHARS = 30

/** The index of the column with the most text over all rows, or -1 when no column is prose. */
export function proseColumn(rows: string[][]): number {
  const totals: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      totals[i] = (totals[i] ?? 0) + cell.trim().length
    })
  }
  const most = Math.max(...totals)
  if (totals.length < 2 || most < PROSE_CHARS * rows.length) return -1
  return totals.indexOf(most)
}

/** As much of Sätteri's HAST as the plugin reads: Astro's Markdown processor is Sätteri. */
type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: readonly Node[] }
type Context = {
  textContent(node: Node): string
  setProperty(node: Node, key: string, value: unknown): void
  wrapNode(node: Node, parent: Node): void
  parent(node: Node): Node | undefined
  indexOf(node: Node): number | undefined
}

/**
 * The box a table sits in. A table sized to its column can't scroll by itself, so the box does:
 * a table wider than the column scrolls inside it, never the page. A keyboard scrolls it too, so
 * it takes focus, as a region named for its table. Whether a table will overflow depends on the
 * reader's width, which the build can't know, so every box takes focus.
 */
export function tableBox(label: string): Node {
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["rc-table"], tabIndex: 0, role: "region", ariaLabel: label },
    children: [],
  }
}

const cellsOf = (row: Node) => (row.children ?? []).filter((c) => c.tagName === "td" || c.tagName === "th")
function rowsOf(node: Node): Node[] {
  if (node.tagName === "tr") return [node]
  return (node.children ?? []).flatMap(rowsOf)
}

/** A table's name: its caption, else the heading above it. */
function tableLabel(table: Node, ctx: Context): string {
  const caption = (table.children ?? []).find((child) => child.tagName === "caption")
  if (caption) return ctx.textContent(caption).trim()
  const parent = ctx.parent(table)
  const at = ctx.indexOf(table)
  const before = parent && at !== undefined ? (parent.children ?? []).slice(0, at) : []
  const heading = before.findLast((node) => /^h[1-6]$/.test(node.tagName ?? ""))
  return heading ? ctx.textContent(heading).trim() : "Table"
}

/** One word, as a table cell holds it: no spaces, short enough to never need breaking. */
export const isWord = (text: string) => /^\S{1,32}$/.test(text.trim())

/**
 * Inline code short enough to keep on one line: `--scope personal` breaking at its hyphen reads as
 * two things. Anything longer still wraps, so it never runs out of a phone's column.
 */
export const shortCode = (text: string) => text.length <= 24

function visitTable(table: Node, ctx: Context) {
  const rows = rowsOf(table).map(cellsOf)
  const texts = rows.map((cells) => cells.map((cell) => ctx.textContent(cell)))
  const prose = proseColumn(texts)
  rows.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      if (c === prose) ctx.setProperty(cell, "dataProse", true)
      else if (isWord(texts[r]?.[c] ?? "")) ctx.setProperty(cell, "dataWord", true)
    })
  })
  ctx.wrapNode(table, tableBox(tableLabel(table, ctx)))
}

function visitCode(code: Node, ctx: Context) {
  if (ctx.parent(code)?.tagName === "pre" || !shortCode(ctx.textContent(code))) return
  const classes = code.properties?.className
  ctx.setProperty(code, "className", [...(Array.isArray(classes) ? classes : []), "rc-nowrap"])
}

/**
 * The Sätteri HAST plugin that marks each table's prose cells and its one-word cells and boxes the
 * table, and marks short inline code to stay on one line.
 */
export const proseColumnPlugin = {
  name: "rulecast-prose-column",
  element: {
    filter: ["table", "code"],
    visit(node: Node, ctx: Context) {
      if (node.tagName === "table") visitTable(node, ctx)
      else visitCode(node, ctx)
    },
  },
}
