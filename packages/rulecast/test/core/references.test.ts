import { describe, expect, test } from "vitest"

import { parseReference, ReferenceSyntaxError } from "../../src/core/references"

describe("parseReference", () => {
  test("parses a whole-file string reference with the default mode", () => {
    expect(parseReference("@conventions/api.md", "inject")).toEqual({
      ref: "conventions/api.md",
      path: "conventions/api.md",
      anchor: null,
      mode: "inject",
    })
  })

  test("parses an anchor and an explicit mode", () => {
    expect(parseReference({ path: "@conventions/api.md#errors", mode: "read" }, "inject")).toEqual({
      ref: "conventions/api.md#errors",
      path: "conventions/api.md",
      anchor: "errors",
      mode: "read",
    })
  })

  test("object without mode uses the default", () => {
    expect(parseReference({ path: "@src/queries.ts" }, "read").mode).toBe("read")
  })

  test("rejects malformed references", () => {
    expect(() => parseReference("conventions/api.md", "inject")).toThrow(ReferenceSyntaxError)
    expect(() => parseReference("@", "inject")).toThrow(/has no path/)
    expect(() => parseReference("@conventions/api.md#", "inject")).toThrow(/empty anchor/)
    expect(() => parseReference("@src/queries.ts#exports", "inject")).toThrow(/only supported in .md and .mdx/)
  })
})
