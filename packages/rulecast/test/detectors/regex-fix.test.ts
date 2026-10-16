import { describe, expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { defaultDetectorSettings } from "../../src/core/types"
import { regexDetector } from "../../src/detectors/regex"

const run = (text: string, config: unknown, fixes?: boolean) =>
  regexDetector.run({
    event: "verify",
    rules: [{ id: "r", config: regexDetector.schema.parse(config), files: ["a.py"], context: [] }],
    changes: new Map(),
    read: async () => text,
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd: "/",
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
    ...(fixes === undefined ? {} : { fixes }),
  })

describe("regex fix", () => {
  test("renders the named groups and {{text}} into an edit over the match", async () => {
    const text = 'x = 1\nprint("hi", n)\n'
    const result = await run(text, { pattern: "print\\((?<args>[^)]*)\\)", fix: "log.info({{args}}) # {{text}}" }, true)
    const [finding] = result.findings
    expect(finding!.fix).toEqual({ start: 6, end: 20, text: 'log.info("hi", n) # print("hi", n)' })
    expect(text.slice(finding!.fix!.start, finding!.fix!.end)).toBe(finding!.match.text)
  })

  test("keeps line breaks in the template and in the values", async () => {
    const result = await run("a(1,\n  2)", { pattern: "a\\((?<args>[^)]*)\\)", flags: "s", fix: "b(\n{{args}})" }, true)
    expect(result.findings[0]!.fix!.text).toBe("b(\n1,\n  2)")
  })

  test("an edit is attached only when the run asks for fixes", async () => {
    const config = { pattern: "print", fix: "log" }
    expect((await run("print", config)).findings[0]!.fix).toBeUndefined()
    expect((await run("print", config, false)).findings[0]!.fix).toBeUndefined()
    expect((await run("print", { pattern: "print" }, true)).findings[0]!.fix).toBeUndefined()
  })

  test("fixable is whether the config has a fix", () => {
    expect(regexDetector.fixable!(regexDetector.schema.parse({ pattern: "a", fix: "" }))).toBe(true)
    expect(regexDetector.fixable!(regexDetector.schema.parse({ pattern: "a" }))).toBe(false)
  })

  test("a variable the match has no value for, or a position, is refused at compile time", () => {
    const issues = (config: unknown) => {
      const parsed = regexDetector.schema.safeParse(config)
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
    }
    expect(issues({ pattern: "(?<a>x)", fix: "{{b}}" })).toEqual([
      'unknown template variable "b" in fix (use the pattern\'s named groups or text)',
    ])
    expect(issues({ pattern: "x", fix: "{{line}}" })).toEqual([
      "fix cannot use {{line}}: it would be written into the code",
    ])
    expect(issues({ pattern: "(?<a>x)", fix: "{{a}}{{text}}" })).toEqual([])
  })
})
