import { describe, expect, it } from "vitest"
import { isWord, proseColumn, proseColumnPlugin, shortCode, tableBox } from "../scripts/prose-column"

const long = "Files changed between the merge base and the ref, read at the ref"

describe("proseColumn", () => {
  it("picks the column that says the most, wherever it sits", () => {
    expect(
      proseColumn([
        ["Key", "Meaning", "Runs on"],
        ["`regex`", long, "every edit"],
      ]),
    ).toBe(1)
    expect(
      proseColumn([
        ["Where", "Command", "Checks"],
        ["pre-commit", "`rulecast run`", long],
      ]),
    ).toBe(2)
  })

  it("finds none in a table of figures or of one column", () => {
    expect(
      proseColumn([
        ["date", "violating / total"],
        ["2026-01-15", "61 / 80"],
      ]),
    ).toBe(-1)
    expect(proseColumn([["Notes"], [long]])).toBe(-1)
  })

  it("tells a one-word cell from one that may wrap", () => {
    expect(isWord("pre-commit")).toBe(true)
    expect(isWord(" ast-grep ")).toBe(true)
    expect(isWord("a scheduled sweep")).toBe(false)
    expect(isWord("")).toBe(false)
  })
})

type Fake = { type: string; tagName?: string; text?: string; children?: Fake[]; properties?: Record<string, unknown> }

function run(table: Fake, siblings: Fake[] = [table]) {
  const root: Fake = { type: "root", children: siblings }
  const marks: [string, string, unknown][] = []
  const wrapped: unknown[] = []
  const text = (node: Fake): string => node.text ?? (node.children ?? []).map(text).join("")
  proseColumnPlugin.element.visit(table, {
    textContent: text,
    setProperty: (node, key, value) => marks.push([text(node as Fake), key, value]),
    wrapNode: (node, parent) => wrapped.push([node, parent]),
    parent: (node) => (node === table ? root : undefined),
    indexOf: (node) => siblings.indexOf(node as Fake),
  })
  return { marks, wrapped }
}

describe("proseColumnPlugin", () => {
  const cell = (tagName: string, text: string): Fake => ({ type: "element", tagName, text })
  const row = (...children: Fake[]): Fake => ({ type: "element", tagName: "tr", children })
  const table: Fake = {
    type: "element",
    tagName: "table",
    children: [row(cell("th", "Key"), cell("th", "Meaning")), row(cell("td", "pre-commit"), cell("td", long))],
  }

  it("marks the prose and one-word cells, and puts the table in its scrolling box", () => {
    const { marks, wrapped } = run(table)
    expect(marks).toEqual([
      ["Key", "dataWord", true],
      ["Meaning", "dataProse", true],
      ["pre-commit", "dataWord", true],
      [long, "dataProse", true],
    ])
    expect(wrapped).toEqual([[table, tableBox("Table")]])
  })

  it("labels the box, which a keyboard can scroll, by the heading above the table", () => {
    const heading: Fake = { type: "element", tagName: "h2", text: "Exit codes" }
    const text: Fake = { type: "element", tagName: "p", text: "Some words." }
    const { wrapped } = run(table, [heading, text, table])
    expect(wrapped).toEqual([[table, tableBox("Exit codes")]])
    expect(tableBox("Exit codes").properties).toMatchObject({ tabIndex: 0, role: "region", ariaLabel: "Exit codes" })
  })

  it("prefers the table's caption", () => {
    const captioned: Fake = {
      ...table,
      children: [{ type: "element", tagName: "caption", text: "Flags" }, ...table.children!],
    }
    const heading: Fake = { type: "element", tagName: "h2", text: "Exit codes" }
    expect(run(captioned, [heading, captioned]).wrapped).toEqual([[captioned, tableBox("Flags")]])
  })
})

describe("shortCode", () => {
  it("keeps short inline code on one line, and lets long code wrap", () => {
    expect(shortCode("--scope personal")).toBe(true)
    expect(shortCode("a".repeat(24))).toBe(true)
    expect(shortCode("rulecast run --from-ref origin/main --format json")).toBe(false)
  })

  it("marks inline code with a class, leaving code in a block alone", () => {
    const marks: [string, unknown][] = []
    const code = (text: string, parent: string): [Fake, Fake] => {
      const node: Fake = { type: "element", tagName: "code", text, properties: { className: ["x"] } }
      return [node, { type: "element", tagName: parent, children: [node] }]
    }
    for (const [node, parent] of [code("--scope personal", "p"), code("ls", "pre"), code("a ".repeat(20), "p")]) {
      proseColumnPlugin.element.visit(node, {
        textContent: (n) => (n as Fake).text ?? "",
        setProperty: (_, key, value) => marks.push([key, value]),
        wrapNode: () => {},
        parent: () => parent,
        indexOf: () => 0,
      })
    }
    expect(marks).toEqual([["className", ["x", "rc-nowrap"]]])
  })
})
