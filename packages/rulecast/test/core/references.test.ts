import { describe, expect, test } from "vitest"

import { parseReference, type ReferenceRoot, ReferenceSyntaxError } from "../../src/core/references"

const PROJECT: ReferenceRoot = { dir: "/project", label: null }
const REPO: ReferenceRoot = { dir: "/cache/repos/github.com_syv-ai_rulecast/v0.2.0", label: "syv-ai/rulecast@v0.2.0" }

describe("parseReference", () => {
  test("parses a whole-file string reference with the default mode", () => {
    expect(parseReference("@conventions/api.md", "inject", PROJECT)).toEqual({
      ref: "conventions/api.md",
      path: "conventions/api.md",
      anchor: null,
      mode: "inject",
    })
  })

  test("parses an anchor and an explicit mode", () => {
    expect(parseReference({ path: "@conventions/api.md#errors", mode: "read" }, "inject", PROJECT)).toEqual({
      ref: "conventions/api.md#errors",
      path: "conventions/api.md",
      anchor: "errors",
      mode: "read",
    })
  })

  test("object without mode uses the default", () => {
    expect(parseReference({ path: "@src/queries.ts" }, "read", PROJECT).mode).toBe("read")
  })

  test("normalises the path", () => {
    expect(parseReference("@./docs/../AGENTS.md#errors", "inject", PROJECT)).toMatchObject({
      ref: "AGENTS.md#errors",
      path: "AGENTS.md",
    })
  })

  test("a rule repo reference is labelled and has an absolute path in the repo", () => {
    expect(parseReference("@packages/rules-python/errors.md#services", "inject", REPO)).toEqual({
      ref: "syv-ai/rulecast@v0.2.0:packages/rules-python/errors.md#services",
      path: "/cache/repos/github.com_syv-ai_rulecast/v0.2.0/packages/rules-python/errors.md",
      anchor: "services",
      mode: "inject",
    })
  })

  test("rejects malformed references", () => {
    expect(() => parseReference("conventions/api.md", "inject", PROJECT)).toThrow(ReferenceSyntaxError)
    expect(() => parseReference("@", "inject", PROJECT)).toThrow(/has no path/)
    expect(() => parseReference("@conventions/api.md#", "inject", PROJECT)).toThrow(/empty anchor/)
    expect(() => parseReference("@src/queries.ts#exports", "inject", PROJECT)).toThrow(/only supported in .md and .mdx/)
  })

  test("rejects references that leave their root", () => {
    expect(() => parseReference("@../other/AGENTS.md", "inject", PROJECT)).toThrow(/leaves its root/)
    expect(() => parseReference("@docs/../../x.md", "inject", REPO)).toThrow(/leaves its root/)
    expect(() => parseReference("@/etc/passwd", "inject", PROJECT)).toThrow(/leaves its root/)
  })
})
