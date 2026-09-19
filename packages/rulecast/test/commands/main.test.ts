import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"

async function run(cwd: string, ...argv: string[]) {
  const { code, stdout, stderr } = await runCli(cwd, argv)
  return { code, stdout, stderr }
}

describe("rulecast CLI", () => {
  test("validate reports rule count, or diagnostics with exit 2", async () => {
    const root = await createFixture()
    expect(await run(root, "validate")).toEqual({ code: 0, stdout: "rulecast: 3 rules valid\n", stderr: "" })
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([...fixtureRules, { id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    )
    expect(await run(root, "validate")).toEqual({
      code: 2,
      stdout: '.rulecast-config.yaml (broken): unknown detector "nope"\n',
      stderr: "",
    })
  })

  test("usage errors exit 2", async () => {
    const root = await createFixture()
    expect((await run(root, "frobnicate")).code).toBe(2)
  })
})
