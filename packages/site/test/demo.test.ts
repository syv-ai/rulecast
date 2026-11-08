import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEMO_PATH, renderDemo, session, wrap } from "../scripts/demo"
import { golden, openingOutput, REPO_ROOT } from "../scripts/sources"

describe("the README's terminal demo", () => {
  it("is committed as pnpm demo writes it", () => {
    expect(readFileSync(path.join(REPO_ROOT, DEMO_PATH), "utf8"), `${DEMO_PATH} is stale: run pnpm demo`).toBe(
      renderDemo(),
    )
  })

  it("prints only real output: the README's opening block and the shell-edit golden, line for line", () => {
    const printed = session()
      .filter((line) => line.kind === "rulecast")
      .map((line) => line.text)
    const real = `${openingOutput().trimEnd()}\n${golden("shell-edit").trimEnd()}`.split("\n")
    expect(printed).toEqual(real)
  })

  it("wraps a long line at spaces, continuation rows indented", () => {
    expect(wrap("  one two three four", 10)).toEqual(["  one two", "    three", "    four"])
    expect(wrap("short", 10)).toEqual(["short"])
    expect(wrap("abcdefghijklmnop", 10)).toEqual(["abcdefghij", "  klmnop"])
  })

  it("shows the whole session with reduced motion", () => {
    expect(renderDemo()).toMatch(/<style>[^<]*@media \(prefers-reduced-motion:no-preference\)\{@keyframes/)
    expect(renderDemo().split("@media")).toHaveLength(2)
  })
})
