import { describe, expect, test } from "vitest"

import { extractFindingsJson } from "../../../src/detectors/llm/providers/extract"

const FINDING = { rule: "r1", line: 2, reason: "prints" }

describe("extractFindingsJson", () => {
  test("bare JSON", () => {
    expect(extractFindingsJson('{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}')).toEqual({
      findings: [FINDING],
    })
  })

  test("JSON inside a fenced block with prose either side", () => {
    const text = [
      "Here is what I found.",
      "```json",
      '{"findings": [{"rule":"r1","line":2,"reason":"prints"}]}',
      "```",
      "Let me know.",
    ].join("\n")
    expect(extractFindingsJson(text)).toEqual({ findings: [FINDING] })
  })

  test("takes the last object that has findings, so thinking out loud in JSON still parses", () => {
    const text = '{"plan":"look at line 2"} {"findings":[]} {"findings":[{"rule":"r1","line":2,"reason":"prints"}]}'
    expect(extractFindingsJson(text)).toEqual({ findings: [FINDING] })
  })

  test("braces and quotes inside a string value do not end the object", () => {
    const text = '{"findings":[{"rule":"r1","line":2,"reason":"uses {} and a \\" quote"}]}'
    expect(extractFindingsJson(text)).toEqual({
      findings: [{ rule: "r1", line: 2, reason: 'uses {} and a " quote' }],
    })
  })

  test("trailing garbage after the object is ignored", () => {
    expect(extractFindingsJson('{"findings":[]} oh and also, nothing else.')).toEqual({ findings: [] })
  })

  test("no JSON, or JSON without findings, is null", () => {
    expect(extractFindingsJson("I could not find anything wrong.")).toBeNull()
    expect(extractFindingsJson('{"result":"ok"}')).toBeNull()
    expect(extractFindingsJson('{"findings": "not an array"}')).toBeNull()
    expect(extractFindingsJson("")).toBeNull()
  })

  test("an unbalanced brace does not hang or throw", () => {
    expect(extractFindingsJson('{"findings":[{"rule":')).toBeNull()
  })
})
