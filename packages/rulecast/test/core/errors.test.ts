import { describe, expect, test } from "vitest"
import { z } from "zod"

import { errorMessage, formatZodError, isNotFound } from "../../src/core/errors"

describe("errors", () => {
  test("isNotFound recognises ENOENT only", () => {
    expect(isNotFound(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true)
    expect(isNotFound(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false)
    expect(isNotFound("ENOENT")).toBe(false)
  })

  test("errorMessage reads Error and non-Error values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("plain")).toBe("plain")
  })

  test("formatZodError joins paths and messages", () => {
    const result = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: "x" } })
    expect(result.success).toBe(false)
    if (!result.success) expect(formatZodError(result.error)).toBe("a.b: Expected number, received string")
  })
})

/** Plan 10, R1: `detect.llm: question: Required; (root): Unrecognized key(s) in object: 'prompt'`. */
describe("formatZodError says what to do", () => {
  const llm = z.object({ model: z.string(), question: z.string() }).strict()
  const fail = (schema: z.ZodTypeAny, value: unknown) => {
    const result = schema.safeParse(value)
    if (result.success) throw new Error("expected a failure")
    return result.error
  }

  test("the review's case: a lone unknown key where one required key is missing", () => {
    expect(formatZodError(fail(llm, { model: "haiku", prompt: "x" }), { prefix: "detect.llm", schema: llm })).toBe(
      'detect.llm: unknown key "prompt" (did you mean "question"?); detect.llm.question: required',
    )
  })

  test("a typo two edits away is named", () => {
    expect(formatZodError(fail(llm, { model: "haiku", question: "x", qestion: "y" }), { schema: llm })).toBe(
      'unknown key "qestion" (did you mean "question"?)',
    )
  })

  test("nothing close, nothing suggested", () => {
    expect(formatZodError(fail(llm, { model: "haiku", question: "x", colour: "red" }), { schema: llm })).toBe(
      'unknown key "colour"',
    )
  })

  test("a nested path keeps its prefix, and the root is never called (root)", () => {
    const outer = z.object({ llm: z.object({ provider: z.string() }).strict() }).strict()
    const message = formatZodError(fail(outer, { llm: { provder: "x" } }), { schema: outer })
    expect(message).toContain('llm: unknown key "provder" (did you mean "provider"?)')
    expect(message).not.toContain("(root)")
  })
})
