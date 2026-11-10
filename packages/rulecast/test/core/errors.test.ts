import { describe, expect, test } from "vitest"
import { z } from "zod"

import { errorMessage, isNotFound, parseReported } from "../../src/core/errors"

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

  test("parseReported joins paths and messages", () => {
    expect(parseReported(z.object({ a: z.object({ b: z.number() }) }), { a: { b: "x" } })).toEqual({
      success: false,
      message: "a.b: Expected number, received string",
    })
  })

  test("parseReported passes the data through", () => {
    expect(parseReported(z.object({ a: z.number().default(1) }), {})).toEqual({ success: true, data: { a: 1 } })
  })
})

/** What a person reads when `value` fails `schema`. */
function failure(schema: z.ZodType, value: unknown, prefix?: string): string {
  const result = parseReported(schema, value, prefix)
  if (result.success) throw new Error("expected a failure")
  return result.message
}

/** Plan 10, R1: `detect.llm: question: Required; (root): Unrecognized key(s) in object: 'prompt'`. */
describe("parseReported says what to do", () => {
  const llm = z.object({ model: z.string(), question: z.string() }).strict()

  test("the review's case: a lone unknown key where one required key is missing", () => {
    expect(failure(llm, { model: "haiku", prompt: "x" }, "detect.llm")).toBe(
      'detect.llm: unknown key "prompt" (did you mean "question"?); detect.llm.question: required',
    )
  })

  test("a typo two edits away is named", () => {
    expect(failure(llm, { model: "haiku", question: "x", qestion: "y" })).toBe(
      'unknown key "qestion" (did you mean "question"?)',
    )
  })

  test("nothing close, nothing suggested", () => {
    expect(failure(llm, { model: "haiku", question: "x", colour: "red" })).toBe('unknown key "colour"')
  })

  test("a nested path keeps its prefix, and the root is never called (root)", () => {
    const outer = z.object({ llm: z.object({ provider: z.string() }).strict() }).strict()
    const message = failure(outer, { llm: { provder: "x" } })
    expect(message).toContain('llm: unknown key "provder" (did you mean "provider"?)')
    expect(message).not.toContain("(root)")
  })
})

/** Rule authors read these, and zod's own text changes between majors: they are rulecast's wording. */
describe("parseReported words a validation failure the same whatever zod says", () => {
  const message = (schema: z.ZodType, value: unknown) => failure(schema, value)

  test.each([
    ["wrong type", z.string(), 1, "Expected string, received number"],
    ["a record is an object", z.record(z.string(), z.unknown()), 1, "Expected object, received number"],
    ["not an integer", z.number().int(), 1.5, "Expected integer, received float"],
    ["minus infinity", z.number().int(), Number.NEGATIVE_INFINITY, "Expected integer, received float"],
    ["empty string", z.string().min(1), "", "String must contain at least 1 character(s)"],
    ["empty list", z.array(z.string()).min(1), [], "Array must contain at least 1 element(s)"],
    ["not positive", z.number().positive(), 0, "Number must be greater than 0"],
    ["negative", z.number().nonnegative(), -1, "Number must be greater than or equal to 0"],
    ["literal", z.literal("x"), "y", 'Invalid literal value, expected "x"'],
    ["enum", z.enum(["a", "b"]), "c", "Invalid enum value. Expected 'a' | 'b', received 'c'"],
    ["enum, wrong type", z.enum(["a", "b"]), 1, "Expected 'a' | 'b', received number"],
  ])("%s", (_name, schema, value, expected) => {
    expect(message(schema, value)).toBe(expected)
  })

  test("a missing enum key is required, and counts towards a did-you-mean", () => {
    const schema = z.object({ mode: z.enum(["a", "b"]) }).strict()
    expect(message(schema, { mod: "a" })).toBe('unknown key "mod" (did you mean "mode"?); mode: required')
  })

  test("a value of the wrong type is not also called too short", () => {
    expect(message(z.string().min(1), [])).toBe("Expected string, received array")
  })

  test("a message the schema wrote is left alone", () => {
    expect(message(z.string().min(1, "must not be blank"), "")).toBe("must not be blank")
  })

  test("a missing key keeps the message its schema wrote", () => {
    expect(message(z.object({ m: z.enum(["a"], { error: "pick a mode" }) }), {})).toBe("m: pick a mode")
    expect(message(z.object({ m: z.literal("a", { error: "pick a" }) }), {})).toBe("m: pick a")
    expect(message(z.object({ m: z.enum(["a", "b"], { error: "pick a mode" }) }), { m: "c" })).toBe("m: pick a mode")
  })

  test("a missing key with its own message still counts towards a did-you-mean", () => {
    const schema = z.object({ mode: z.enum(["a", "b"], { error: "pick a mode" }) }).strict()
    expect(message(schema, { mod: "a" })).toBe('unknown key "mod" (did you mean "mode"?); mode: pick a mode')
  })

  test("zod rewording its English text does not change rulecast's", () => {
    // What a later zod would say: rulecast's wording comes from the issue, never from this text.
    z.config({ localeError: () => "Reworded by a later zod" })
    try {
      expect(failure(z.object({ a: z.string(), b: z.number().int(), c: z.enum(["x", "y"]) }), { b: 1.5, c: "z" })).toBe(
        "a: required; b: Expected integer, received float; c: Invalid enum value. Expected 'x' | 'y', received 'z'",
      )
    } finally {
      z.config(z.locales.en())
    }
  })
})
