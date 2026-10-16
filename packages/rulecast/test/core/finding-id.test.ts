import { describe, expect, test } from "vitest"

import { findingIds } from "../../src/core/finding-id"
import { sourceLines, suppress } from "../../src/core/suppress"
import type { Match } from "../../src/core/types"
import { rule } from "../helpers/rules"

const FILE = "app/a.py"

const match = (
  line: number,
  text: string,
  captures: Record<string, string> = {},
  column = 1,
  endLine = line,
): Match => ({
  file: FILE,
  line,
  endLine,
  column,
  text,
  captures,
})
const regex = rule({ id: "py/no-eval" })
const llm = rule({ id: "py/judged", detector: { kind: "llm", config: {}, captures: ["reason"] } })
const detectors = (kind: string) =>
  kind === "llm" ? { volatileCaptures: ["reason"] } : kind === "path" ? { wholeFile: true } : {}
/** The ids of `items`, judged against `source` as the content of FILE. */
const ids = (source: string | null, ...items: { rule: typeof regex; match: Match }[]) =>
  findingIds(
    items,
    detectors,
    sourceLines(async (file) => (file === FILE ? source : null)),
  )
const one = async (source: string | null, item: { rule: typeof regex; match: Match }) => (await ids(source, item))[0]
const lines = (...source: string[]) => `${source.join("\n")}\n`

describe("findingIds", () => {
  test("a duplicate inserted above two short matches gets a new id, and theirs stay put", async () => {
    const before = await ids(
      lines("x = eval(userInput)", "y = eval(config)"),
      { rule: regex, match: match(1, "eval(", {}, 5) },
      { rule: regex, match: match(2, "eval(", {}, 5) },
    )
    const after = await ids(
      lines("z = eval(other)", "x = eval(userInput)", "y = eval(config)"),
      { rule: regex, match: match(1, "eval(", {}, 5) },
      { rule: regex, match: match(2, "eval(", {}, 5) },
      { rule: regex, match: match(3, "eval(", {}, 5) },
    )
    expect(after.slice(1)).toEqual(before)
    expect(before).not.toContain(after[0])
    expect(before[0]).toMatch(/^[0-9a-f]{16}$/)
  })

  test("the same violation keeps its id after unrelated lines are inserted above it", async () => {
    const before = await ids(
      lines("print(x)", "pass", "print(y)"),
      { rule: regex, match: match(1, "print(") },
      { rule: regex, match: match(3, "print(") },
    )
    const after = await ids(
      lines("import os", "", "print(x)", "pass", "print(y)"),
      { rule: regex, match: match(3, "print(") },
      { rule: regex, match: match(5, "print(") },
    )
    expect(after).toEqual(before)
  })

  test("an inline rulecast-ignore added to the finding's line, in any comment syntax, keeps its id", async () => {
    const judged = (line: string) =>
      one(lines("import os", line), { rule: llm, match: match(2, line, { reason: "loads at import time" }) })
    const base = await judged("x = load()")
    for (const ignored of [
      "x = load()  # rulecast-ignore: py/judged loads lazily in tests",
      "x = load() // rulecast-ignore: py/judged loads lazily in tests",
      "x = load() /* rulecast-ignore: py/judged loads lazily in tests */",
      "x = load() <!-- rulecast-ignore: py/judged loads lazily in tests -->",
      "x = load() -- rulecast-ignore: py/judged loads lazily in tests",
      "x = load()  # rulecast-ignore: py/judged",
    ]) {
      expect(await judged(ignored)).toBe(base)
    }
  })

  test("so does an ignore in JSX, a doc comment or a `;` comment, and code punctuation before it stays", async () => {
    const judged = (line: string) => one(lines(line), { rule: llm, match: match(1, line, { reason: "r" }) })
    for (const [base, ignored] of [
      ["<Foo />", "<Foo /> {/* rulecast-ignore: py/judged legacy */}"],
      ["x = load()", "x = load() /** rulecast-ignore: py/judged legacy */"],
      ["(load x)", "(load x) ; rulecast-ignore: py/judged legacy"],
      ["x = load();", "x = load(); // rulecast-ignore: py/judged legacy"],
    ] as const) {
      expect(await judged(ignored)).toBe(await judged(base))
    }
  })

  test("an ignore that no comment opener introduces, as in a string literal, is part of the line", async () => {
    const judged = (line: string) => one(lines(line), { rule: llm, match: match(1, line, { reason: "r" }) })
    expect(await judged('print("rulecast-ignore: py/judged one")')).not.toBe(
      await judged('print("rulecast-ignore: py/judged two")'),
    )
    expect(await judged("x = 1 rulecast-ignore: py/judged one")).not.toBe(
      await judged("x = 2 rulecast-ignore: py/judged one"),
    )
  })

  test("re-indenting the lines or a CRLF checkout does not change the id", async () => {
    const base = await one(lines("if x:", "    print(x)"), {
      rule: regex,
      match: match(1, "if x:\n    print(", {}, 1, 2),
    })
    const moved = await one("  if x:\r\n\t\tprint(x)  \r\n", {
      rule: regex,
      match: match(1, "if x:\r\n\t\tprint(", {}, 3, 2),
    })
    expect(moved).toBe(base)
  })

  test("editing elsewhere on the finding's line changes the id: the line is what is new", async () => {
    const base = await one(lines("a = 1; eval(x)"), { rule: regex, match: match(1, "eval(", {}, 8) })
    expect(await one(lines("a = 2; eval(x)"), { rule: regex, match: match(1, "eval(", {}, 8) })).not.toBe(base)
  })

  test("the rule or the file changes the id", async () => {
    const source = lines("eval(x)")
    const base = await one(source, { rule: regex, match: match(1, "eval(") })
    expect(await one(source, { rule: rule({ id: "py/other" }), match: match(1, "eval(") })).not.toBe(base)
    const elsewhere = await findingIds(
      [{ rule: regex, match: { ...match(1, "eval("), file: "app/b.py" } }],
      detectors,
      sourceLines(async () => source),
    )
    expect(elsewhere[0]).not.toBe(base)
  })

  test("identical lines in one file are numbered by position, whatever order the tool emits them in", async () => {
    const source = lines("eval(x)", "pass", "eval(x)")
    const [first, second] = await ids(
      source,
      { rule: regex, match: match(1, "eval(") },
      { rule: regex, match: match(3, "eval(") },
    )
    expect(first).not.toBe(second)
    expect(
      await ids(source, { rule: regex, match: match(3, "eval(") }, { rule: regex, match: match(1, "eval(") }),
    ).toEqual([second, first])
    // On one line, the column decides.
    const sameLine = lines("eval(x) + eval(x)")
    const [left, right] = await ids(
      sameLine,
      { rule: regex, match: match(1, "eval(", {}, 1) },
      { rule: regex, match: match(1, "eval(", {}, 11) },
    )
    expect(left).not.toBe(right)
    expect(
      await ids(
        sameLine,
        { rule: regex, match: match(1, "eval(", {}, 11) },
        { rule: regex, match: match(1, "eval(", {}, 1) },
      ),
    ).toEqual([right, left])
  })

  test("captures are part of what a match is, so two tool rules on one line differ", async () => {
    const tool = rule({ id: "py/ruff", detector: { kind: "linter", config: {}, captures: [] } })
    const source = lines("import os")
    const [e501, f401] = await ids(
      source,
      { rule: tool, match: match(1, "import os", { ruleId: "E501", message: "Line too long" }) },
      { rule: tool, match: match(1, "import os", { ruleId: "F401", message: "`os` imported but unused" }) },
    )
    expect(e501).not.toBe(f401)
    // And the capture order a tool happens to emit does not matter.
    expect(
      await one(source, { rule: tool, match: match(1, "import os", { message: "Line too long", ruleId: "E501" }) }),
    ).toBe(e501)
  })

  test("an llm's reason is left out: the model words it differently every run", async () => {
    const source = lines("x = load()")
    const first = await one(source, { rule: llm, match: match(1, "x = load()", { reason: "loads at import time" }) })
    const second = await one(source, { rule: llm, match: match(1, "x = load()", { reason: "this runs on import" }) })
    expect(second).toBe(first)
  })

  test("a path rule hashes the path, so editing the file keeps its id", async () => {
    const path = rule({ id: "layout/no-utils", detector: { kind: "path", config: {}, captures: [] } })
    const before = await one(lines("a = 1"), { rule: path, match: match(1, FILE) })
    expect(await one(lines("a = 2"), { rule: path, match: match(1, FILE) })).toBe(before)
  })

  test("a hook's whole-file finding hashes its captures, not the file; its line findings hash their line", async () => {
    const hook = rule({ id: "hooks/mypy", detector: { kind: "hook", config: {}, captures: [] } })
    const whole = (source: string) =>
      one(source, {
        rule: hook,
        match: {
          ...match(1, "", { message: "would reformat", ruleId: "black" }, 1, source.split("\n").length),
          wholeFile: true,
        },
      })
    expect(await whole(lines("a = 1", "b = 2"))).toBe(await whole(lines("a = 1", "b = 3")))
    // A one-line file without a trailing newline is whole-file too: the match says so.
    expect(await whole("a = 1")).toBe(await whole("a = 2"))
    const source = lines("a = 1", "b: int = ''", "c = 3", "def f() -> int: pass")
    const [a, b] = await ids(
      source,
      { rule: hook, match: match(2, "", { message: "Incompatible types", ruleId: "mypy" }) },
      { rule: hook, match: match(4, "", { message: "Incompatible types", ruleId: "mypy" }) },
    )
    expect(a).not.toBe(b)
  })

  test("a match over every line of a file without a trailing newline still hashes its lines", async () => {
    const twoLines = (second: string) =>
      one(`x = eval(\n${second})`, { rule: regex, match: match(1, "eval(\n", {}, 5, 2) })
    expect(await twoLines("a")).not.toBe(await twoLines("b"))
  })

  test("a redacted match hashes its text and captures, never the line its secret is on", async () => {
    const leaks = rule({ id: "secrets", detector: { kind: "linter", config: {}, captures: [] } })
    const leak = (line: number): Match => ({
      ...match(line, "[redacted]", { message: "API key", ruleId: "generic-api-key" }),
      redacted: true,
    })
    const first = await one(lines('KEY = "sk-aaaa"'), { rule: leaks, match: leak(1) })
    expect(await one(lines('KEY = "sk-bbbb"'), { rule: leaks, match: leak(1) })).toBe(first)
    // As if the file could not be read: nothing of the line goes in.
    expect(await one(null, { rule: leaks, match: leak(1) })).toBe(first)
    // Two secrets in one file stay apart by their order.
    const [a, b] = await ids(
      lines('KEY = "sk-aaaa"', "pass", 'KEY = "sk-bbbb"'),
      { rule: leaks, match: leak(1) },
      { rule: leaks, match: leak(3) },
    )
    expect(a).toBe(first)
    expect(b).not.toBe(a)
  })

  test("a file that cannot be read falls back to the match's own text", async () => {
    const first = await one(null, { rule: regex, match: match(3, "eval(") })
    expect(await one(null, { rule: regex, match: match(9, "eval(") })).toBe(first)
  })

  test("reads each file once, sharing the lines suppression read", async () => {
    let reads = 0
    const shared = sourceLines(async () => {
      reads++
      return lines("eval(a)", "eval(b)")
    })
    const items = [
      { rule: regex, match: match(1, "eval(") },
      { rule: regex, match: match(2, "eval(") },
    ]
    await suppress(items, shared)
    await findingIds(items, detectors, shared)
    expect(reads).toBe(1)
  })
})
