import { describe, expect, it } from "vitest"
import { isWord, proseColumn } from "../scripts/prose-column"

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
