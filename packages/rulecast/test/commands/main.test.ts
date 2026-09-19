import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"

describe("rulecast CLI", () => {
  test("an unknown command is a usage error", async () => {
    const result = await runCli(await createFixture(), ["frobnicate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown command "frobnicate"')
    expect(result.stderr).toContain("usage:")
  })
})
