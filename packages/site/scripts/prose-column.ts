/**
 * Which column of a Markdown table is its prose: the one that says the most. The theme lets that
 * column take the width the others leave, and keeps the chips in the others (names, commands,
 * defaults) on one line. CSS can't tell the columns apart, so the build marks the prose column's
 * cells with `data-prose`, and each other cell of one word with `data-word`: a word such as
 * "pre-commit" would otherwise break at its hyphen.
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
type Node = { type: string; tagName?: string; children?: readonly Node[] }
type Context = { textContent(node: Node): string; setProperty(node: Node, key: string, value: unknown): void }

const cellsOf = (row: Node) => (row.children ?? []).filter((c) => c.tagName === "td" || c.tagName === "th")
function rowsOf(node: Node): Node[] {
  if (node.tagName === "tr") return [node]
  return (node.children ?? []).flatMap(rowsOf)
}

/** One word, as a table cell holds it: no spaces, short enough to never need breaking. */
export const isWord = (text: string) => /^\S{1,32}$/.test(text.trim())

/** The Sätteri HAST plugin that marks each table's prose cells and its one-word cells. */
export const proseColumnPlugin = {
  name: "rulecast-prose-column",
  element: {
    filter: ["table"],
    visit(table: Node, ctx: Context) {
      const rows = rowsOf(table).map(cellsOf)
      const texts = rows.map((cells) => cells.map((cell) => ctx.textContent(cell)))
      const prose = proseColumn(texts)
      rows.forEach((cells, r) => {
        cells.forEach((cell, c) => {
          if (c === prose) ctx.setProperty(cell, "dataProse", true)
          else if (isWord(texts[r]?.[c] ?? "")) ctx.setProperty(cell, "dataWord", true)
        })
      })
    },
  },
}
