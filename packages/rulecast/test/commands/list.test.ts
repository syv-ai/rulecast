import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { createProject } from "../helpers/project"

describe("rulecast list", () => {
  test("a disabled rule is listed and says so", async () => {
    const rules = fixtureRules.map((rule) =>
      rule.id === "frontend/no-generated-edits" ? { ...rule, enabled: false } : rule,
    )
    const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(rules) })
    const json = JSON.parse((await runCli(root, ["list", "--format", "json"])).stdout)
    expect(json.find((rule: { id: string }) => rule.id === "frontend/no-generated-edits").enabled).toBe(false)
    expect((await runCli(root, ["list"])).stdout).toContain("frontend/no-generated-edits  (disabled)")
  })

  test("outside a project it fails, and an unknown format is a usage error", async () => {
    const outside = await createProject({})
    expect((await runCli(outside, ["list"])).code).toBe(2)
    const root = await createRepo(fixtureFiles)
    const result = await runCli(root, ["list", "--format", "sarif"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown format "sarif"')
  })
})
