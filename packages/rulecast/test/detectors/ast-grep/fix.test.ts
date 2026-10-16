import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { defaultDetectorSettings } from "../../../src/core/types"
import { astGrepDetector } from "../../../src/detectors/ast-grep/detector"

async function fixesOf(text: string, config: unknown) {
  const parsed = await astGrepDetector.schema.parseAsync(config)
  const result = await astGrepDetector.run({
    event: "verify",
    rules: [{ id: "r", config: parsed, files: ["a.ts"], context: [] }],
    changes: new Map(),
    read: async () => text,
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd: "/",
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
    fixes: true,
  })
  expect(result.errors).toEqual([])
  return result.findings.map((finding) => finding.fix!)
}

const apply = (text: string, edits: { start: number; end: number; text: string }[]) =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), text)

const issues = async (config: unknown) => {
  const parsed = await astGrepDetector.schema.safeParseAsync(config)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
}

describe("ast-grep fix", () => {
  test("$VAR is its node's text, and $$$VARS keeps the separators and comments between the nodes", async () => {
    const text = "console.log(a, /* why */ b)\nwarn(x)\n"
    const edits = await fixesOf(text, {
      language: "typescript",
      rule: { pattern: "console.log($$$ARGS)" },
      fix: "logger.debug($$$ARGS)",
    })
    expect(apply(text, edits)).toBe("logger.debug(a, /* why */ b)\nwarn(x)\n")
    const single = await fixesOf("warn(x)\n", {
      language: "typescript",
      rule: { pattern: "warn($A)" },
      fix: "log($A, $A)",
    })
    expect(apply("warn(x)\n", single)).toBe("log(x, x)\n")
  })

  test("an empty $$$VARS is empty", async () => {
    const edits = await fixesOf("f()\n", { language: "typescript", rule: { pattern: "f($$$A)" }, fix: "g($$$A)" })
    expect(apply("f()\n", edits)).toBe("g()\n")
  })

  test("a multi-line fix is indented to the line the match starts on", async () => {
    const text = "if (x) {\n    console.log(a)\n}\n"
    const edits = await fixesOf(text, {
      language: "typescript",
      rule: { pattern: "console.log($A)" },
      fix: "if (debug) {\n  logger.debug($A)\n}",
    })
    expect(apply(text, edits)).toBe("if (x) {\n    if (debug) {\n      logger.debug(a)\n    }\n}\n")
  })

  test("a multi-line fix uses the file's line endings", async () => {
    const text = "if (x) {\r\n    console.log(a)\r\n}\r\n"
    const edits = await fixesOf(text, {
      language: "typescript",
      rule: { pattern: "console.log($A)" },
      fix: "if (debug) {\n  logger.debug($A)\n}",
    })
    expect(apply(text, edits)).toBe("if (x) {\r\n    if (debug) {\r\n      logger.debug(a)\r\n    }\r\n}\r\n")
    const last = "x()\r\nconsole.log(a)"
    const atEnd = await fixesOf(last, { language: "typescript", rule: { pattern: "console.log($A)" }, fix: "a(\n$A)" })
    expect(apply(last, atEnd)).toBe("x()\r\na(\r\na)")
  })

  test("offsets are UTF-16 code units, as JavaScript strings index: non-ASCII before the match", async () => {
    // napi's types call `index` a byte offset. It is not: "é" is 2 bytes and "😀" is 4 in UTF-8,
    // and 1 and 2 code units, so a byte offset would land 3 characters past the match.
    const text = 'const s = "é😀"; console.log(a)\n'
    const [edit] = await fixesOf(text, { language: "typescript", rule: { pattern: "console.log($A)" }, fix: "log($A)" })
    expect(text.slice(edit!.start, edit!.end)).toBe("console.log(a)")
    expect(apply(text, [edit!])).toBe('const s = "é😀"; log(a)\n')
  })

  test("a fix may only name metavariables the rule captures", async () => {
    expect(await issues({ language: "typescript", rule: { pattern: "f($A)" }, fix: "g($B)" })).toEqual([
      "fix uses $B, which the rule does not capture",
    ])
    expect(await issues({ language: "typescript", rule: { pattern: "f($_A)" }, fix: "g($_A)" })).toEqual([
      "fix uses $_A, which the rule does not capture",
    ])
    // The fix's metavariables are not captures of their own: a message cannot name one the rule lacks.
    const parsed = await astGrepDetector.schema.parseAsync({
      language: "typescript",
      rule: { pattern: "f($A)" },
      fix: "g($A)",
    })
    expect(astGrepDetector.captures(parsed)).toEqual(["A"])
    expect(astGrepDetector.fixable!(parsed)).toBe(true)
  })

  test("FixConfig objects, transform and rewriters are refused", async () => {
    const rule = { language: "typescript", rule: { pattern: "f($A)" } }
    expect(await issues({ ...rule, fix: { template: "g($A)", expandEnd: { regex: "," } } })).toEqual([
      "fix must be a string: the FixConfig object (expandStart, expandEnd) is not supported",
    ])
    expect(
      (await issues({ ...rule, fix: "g($B)", transform: { B: { substring: { source: "$A" } } } })).length,
    ).toBeGreaterThan(0)
    expect((await issues({ ...rule, fix: "g($A)", rewriters: [] })).length).toBeGreaterThan(0)
  })
})
