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
