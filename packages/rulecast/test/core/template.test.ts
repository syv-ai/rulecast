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

test("a multi-line value is collapsed onto one line", () => {
  // Found by dogfooding on a 1,945-file project: an ast-grep rule matching `style={{ … }}` across
  // several lines put those newlines straight into the message, and every renderer — terminal,
  // agent, json, sarif — assumes one finding is one line.
  const text = 'style={{\n        animation: "pulse 2s",\n        color: red,\n      }}'
  expect(renderTemplate("{{file}}:{{line}} styles inline with {{text}}.", { file: "a.tsx", line: "50", text })).toBe(
    'a.tsx:50 styles inline with style={{ animation: "pulse 2s", color: red, }}.',
  )
})

test("collapsing does not disturb a value that is already one line", () => {
  expect(renderTemplate("{{text}}", { text: "print(x)" })).toBe("print(x)")
})

test("tabs and carriage returns collapse too, and the value is trimmed", () => {
  expect(renderTemplate("[{{text}}]", { text: "  a\r\n\tb  " })).toBe("[a b]")
})
