import { describe, expect, test } from "vitest"

import { llmSchema } from "../../../src/detectors/llm/schema"

describe("llmSchema", () => {
  test("question is required; grounding defaults to true", () => {
    expect(llmSchema.parse({ model: "haiku", question: "Does this route do too much?" })).toEqual({
      model: "haiku",
      question: "Does this route do too much?",
      grounding: true,
    })
  })

  test("grounding can be turned off", () => {
    expect(llmSchema.parse({ model: "haiku", question: "q", grounding: false }).grounding).toBe(false)
  })

  test("a rule may leave out its model: the config's llm.model is used", () => {
    expect(llmSchema.parse({ question: "q" })).toEqual({ question: "q", grounding: true })
  })

  test("blank values and unknown keys are rejected", () => {
    expect(llmSchema.safeParse({ model: "", question: "q" }).success).toBe(false)
    expect(llmSchema.safeParse({ model: "haiku", question: "   " }).success).toBe(false)
    expect(llmSchema.safeParse({ model: "haiku" }).success).toBe(false)
    expect(llmSchema.safeParse({ model: "haiku", question: "q", temperature: 0 }).success).toBe(false)
  })

  test("surrounding whitespace is trimmed, so a YAML folded block is usable", () => {
    expect(llmSchema.parse({ model: " haiku ", question: "q\n" })).toMatchObject({ model: "haiku", question: "q" })
  })
})
