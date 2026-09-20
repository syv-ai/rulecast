import { describe, expect, test } from "vitest"

import { metavariables } from "../../../src/detectors/ast-grep/metavars"

describe("metavariables", () => {
  test("finds single and multi metavariables anywhere in the config, in first-seen order", () => {
    expect(
      metavariables({
        rule: { pattern: "raise HTTPException($$$ARGS)", inside: { kind: "function_definition" } },
        constraints: { ARGS: { regex: "$CODE" } },
      }),
    ).toEqual([
      { name: "ARGS", multi: true },
      { name: "CODE", multi: false },
    ])
  })

  test("a name seen once as $$$NAME is multi everywhere", () => {
    expect(metavariables({ rule: { any: [{ pattern: "f($A)" }, { pattern: "g($$$A)" }] } })).toEqual([
      { name: "A", multi: true },
    ])
  })

  test("skips non-capturing metavariables and anonymous $$$", () => {
    expect(metavariables({ rule: { pattern: "f($_IGNORED, $$$, $KEPT)" } })).toEqual([{ name: "KEPT", multi: false }])
  })

  test("ignores non-string values and a $ that starts no name", () => {
    expect(metavariables({ rule: { pattern: "cost($ + 1)", stopBy: "end", limit: 3, ok: true } })).toEqual([])
  })
})
