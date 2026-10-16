import { describe, expect, test } from "vitest"

import { findingIds } from "../../src/core/finding-id"
import type { Match } from "../../src/core/types"
import { rule } from "../helpers/rules"

const match = (line: number, text: string, captures: Record<string, string> = {}, column = 1): Match => ({
  file: "app/a.py",
  line,
  endLine: line,
  column,
  text,
  captures,
})
const regex = rule({ id: "py/no-print" })
const llm = rule({ id: "py/judged", detector: { kind: "llm", config: {}, captures: ["reason"] } })
const volatile = (kind: string) => (kind === "llm" ? ["reason"] : [])
const ids = (...items: { rule: typeof regex; match: Match }[]) => findingIds(items, volatile)
const one = (item: { rule: typeof regex; match: Match }) => ids(item)[0]

describe("findingIds", () => {
  test("the same violation keeps its id after unrelated lines are inserted above it", () => {
    const before = ids({ rule: regex, match: match(3, "print(x)") }, { rule: regex, match: match(9, "print(y)") })
    const after = ids({ rule: regex, match: match(7, "print(x)") }, { rule: regex, match: match(13, "print(y)") })
    expect(after).toEqual(before)
    expect(before[0]).toMatch(/^[0-9a-f]{16}$/)
  })

  test("changing the offending text, the rule or the file changes the id", () => {
    const base = one({ rule: regex, match: match(3, "print(x)") })
    expect(one({ rule: regex, match: match(3, "print(z)") })).not.toBe(base)
    expect(one({ rule: rule({ id: "py/other" }), match: match(3, "print(x)") })).not.toBe(base)
    expect(one({ rule: regex, match: { ...match(3, "print(x)"), file: "app/b.py" } })).not.toBe(base)
  })

  test("identical matches in one file are numbered by position, whatever order the tool emits them in", () => {
    const [first, second] = ids(
      { rule: regex, match: match(3, "print(x)") },
      { rule: regex, match: match(9, "print(x)") },
    )
    expect(first).not.toBe(second)
    const reversed = ids({ rule: regex, match: match(9, "print(x)") }, { rule: regex, match: match(3, "print(x)") })
    expect(reversed).toEqual([second, first])
    // On one line, the column decides.
    const sameLine = ids(
      { rule: regex, match: match(3, "print(x)", {}, 20) },
      { rule: regex, match: match(3, "print(x)", {}, 1) },
    )
    expect(sameLine).toEqual([second, first])
  })

  test("re-indenting the line or a CRLF checkout does not change the id", () => {
    const base = one({ rule: regex, match: match(3, "if x:\n    print(x)") })
    expect(one({ rule: regex, match: match(3, "  if x:\r\n\t\tprint(x)  ") })).toBe(base)
  })

  test("captures are part of what a match is, so two tool rules on one line differ", () => {
    const tool = rule({ id: "py/ruff", detector: { kind: "linter", config: {}, captures: [] } })
    const [e501, f401] = ids(
      { rule: tool, match: match(3, "import os", { ruleId: "E501", message: "Line too long" }) },
      { rule: tool, match: match(3, "import os", { ruleId: "F401", message: "`os` imported but unused" }) },
    )
    expect(e501).not.toBe(f401)
    // And the capture order a tool happens to emit does not matter.
    expect(one({ rule: tool, match: match(3, "import os", { message: "Line too long", ruleId: "E501" }) })).toBe(e501)
  })

  test("an llm's reason is left out: the model words it differently every run", () => {
    const first = one({ rule: llm, match: match(3, "x = load()", { reason: "loads at import time" }) })
    const second = one({ rule: llm, match: match(3, "x = load()", { reason: "this runs on import" }) })
    expect(second).toBe(first)
  })

  test("a hook's empty text and a path rule's file still give stable, distinct ids", () => {
    const hook = rule({ id: "hooks/mypy", detector: { kind: "hook", config: {}, captures: [] } })
    const [a, b] = ids(
      { rule: hook, match: match(3, "", { message: "Incompatible types", ruleId: "mypy", severity: "error" }) },
      { rule: hook, match: match(8, "", { message: "Missing return", ruleId: "mypy", severity: "error" }) },
    )
    expect(a).not.toBe(b)
    const path = rule({ id: "layout/no-utils", detector: { kind: "path", config: {}, captures: [] } })
    expect(one({ rule: path, match: match(1, "app/a.py") })).toBe(one({ rule: path, match: match(1, "app/a.py") }))
  })
})
