import { describe, expect, test } from "vitest"

import { commandSchema } from "../../../src/detectors/command/schema"

describe("command schema", () => {
  test("defaults output to json and captures to none", () => {
    expect(commandSchema.parse({ run: ["./check"] })).toEqual({ run: ["./check"], output: "json", captures: [] })
  })

  test("rejects an empty run, an unknown output and a capture that is not a variable name", () => {
    expect(commandSchema.safeParse({ run: [] }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], output: "xml" }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], captures: ["not a name"] }).success).toBe(false)
  })

  test("rejects a capture that shadows a core template variable", () => {
    const result = commandSchema.safeParse({ run: ["x"], captures: ["line"] })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toContain("line")
  })
})
