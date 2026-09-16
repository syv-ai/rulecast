import { describe, expect, test } from "vitest"

import { CORE_VARIABLES, renderTemplate, templateVariables, UnknownTemplateVariable } from "../../src/core/template"

describe("templates", () => {
  test("lists each variable once", () => {
    expect(templateVariables("{{file}}:{{ line }} {{NAMES}} again {{file}}")).toEqual(["file", "line", "NAMES"])
  })

  test("core variables", () => {
    expect(CORE_VARIABLES).toEqual(["file", "line", "column", "text", "rule"])
  })

  test("renders values, including empty strings", () => {
    expect(renderTemplate("{{file}}:{{line}} {{NAMES}}", { file: "a.tsx", line: "3", NAMES: "" })).toBe("a.tsx:3 ")
  })

  test("throws on a missing value", () => {
    expect(() => renderTemplate("{{reason}}", {})).toThrow(UnknownTemplateVariable)
  })
})
