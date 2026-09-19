import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"

describe("rulecast warm", () => {
  test("with no detector warm-up work there is nothing to warm", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["warm"])).toMatchObject({ code: 0, stdout: "rulecast: nothing to warm\n" })
  })

  test("outside a rulecast project it fails", async () => {
    const result = await runCli(await createProject({}), ["warm"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast directory")
  })
})
