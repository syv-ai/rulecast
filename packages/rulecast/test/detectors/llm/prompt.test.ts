import { describe, expect, test } from "vitest"

import { buildPrompt } from "../../../src/detectors/llm/prompt"

const SOURCE = ["import os", "", "def get(id):", "    return fetch(id)"].join("\n")

describe("buildPrompt", () => {
  test("marks the changed lines and tells the model to report only those", () => {
    const prompt = buildPrompt({
      file: "app/a.py",
      source: SOURCE,
      changedLines: [[3, 4]],
      rules: [{ id: "python/thin-routes", question: "Does this do too much?", grounding: [] }],
    })
    expect(prompt).toBe(
      [
        "Check the file below against each rule. Report every line that breaks a rule.",
        "",
        'Answer with JSON only: {"findings": [{"rule": "<rule id>", "line": <number>, "text": "<the line>", "reason": "<why>"}]}',
        "Report nothing when a rule is not broken. Use the rule ids exactly as given.",
        'Only lines marked with ">" were changed. Report findings on those lines only.',
        "",
        "## Rules",
        "",
        "### python/thin-routes",
        "Does this do too much?",
        "",
        "## File: app/a.py",
        "",
        "```",
        "  1  import os",
        "  2  ",
        "> 3  def get(id):",
        "> 4      return fetch(id)",
        "```",
      ].join("\n"),
    )
  })

  test("no change set means no marks and a whole-file judgement", () => {
    const prompt = buildPrompt({
      file: "a.py",
      source: "x = 1\n",
      changedLines: null,
      rules: [{ id: "r1", question: "q", grounding: [] }],
    })
    expect(prompt).toContain("Judge the whole file.")
    expect(prompt).not.toContain('Only lines marked with ">"')
    expect(prompt).toContain("\n```\n  1  x = 1\n```")
  })

  test("several rules in one call, each with its own grounding", () => {
    const prompt = buildPrompt({
      file: "a.tsx",
      source: "export const x = 1\n",
      changedLines: [[1, 1]],
      rules: [
        {
          id: "api/no-client",
          question: "Does this import the generated client?",
          grounding: [
            { ref: "docs/api.md#frontend", content: "Components never talk to the API." },
            { ref: "docs/state.md", content: "State lives in hooks." },
          ],
        },
        { id: "api/thin", question: "Does this do too much?", grounding: [] },
      ],
    })
    expect(prompt).toContain(
      [
        "### api/no-client",
        "Does this import the generated client?",
        "",
        "Reference — docs/api.md#frontend:",
        '"""',
        "Components never talk to the API.",
        '"""',
        "",
        "Reference — docs/state.md:",
        '"""',
        "State lives in hooks.",
        '"""',
        "",
        "### api/thin",
        "Does this do too much?",
      ].join("\n"),
    )
  })

  test("line numbers are right-aligned to the width of the last one", () => {
    const prompt = buildPrompt({
      file: "a.py",
      source: Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n"),
      changedLines: [[11, 11]],
      rules: [{ id: "r1", question: "q", grounding: [] }],
    })
    expect(prompt).toContain("   1  line 1")
    expect(prompt).toContain("> 11  line 11")
  })

  test("a source line that is itself a fence does not end the file block", () => {
    const source = ["# Docs", "```python", "x = 1", "```"].join("\n")
    const prompt = buildPrompt({
      file: "README.md",
      source,
      changedLines: null,
      rules: [{ id: "r1", question: "q", grounding: [] }],
    })
    // The fence widens past the longest run inside the source.
    expect(prompt).toContain("\n````\n  1  # Docs")
    expect(prompt.endsWith("\n````")).toBe(true)
  })
})
