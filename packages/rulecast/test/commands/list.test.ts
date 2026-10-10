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

  test("shows what each detector looks for, so overlap can be judged without the rule repo", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "app/no-print",
          name: "No print",
          files: "^app/",
          detect: { regex: { pattern: "\\bprint\\(" } },
          message: "{{file}}:{{line}} prints",
        },
        { id: "app/services", name: "Services", files: "^app/services/", stages: ["touch"], context: ["@x.md"] },
      ]),
      "x.md": "# X\n",
    })
    const text = (await runCli(root, ["list"])).stdout
    // As YAML, the way the rule is written: a pattern reads as it was typed, not JSON-escaped.
    expect(text).toContain("  detects:\n    pattern: \\bprint\\(\n")
    const json = JSON.parse((await runCli(root, ["list", "--format", "json"])).stdout)
    expect(json[0].config.pattern).toBe("\\bprint\\(")
    expect(json[1].config).toBeNull()
  })

  test("says how many project files each rule matches, and calls out a rule that matches none", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        { id: "a/services", name: "S", files: "^app/services/", stages: ["touch"], context: ["@x.md"] },
        { id: "a/routes", name: "R", files: "(^|/)routes/", stages: ["touch"], context: ["@x.md"] },
      ]),
      "x.md": "# X\n",
      "app/services/a.py": "x = 1\n",
      "app/services/b.py": "x = 1\n",
      "app/api/routes.py": "x = 1\n",
    })
    const text = (await runCli(root, ["list"])).stdout
    expect(text).toContain("files ^app/services/ — matches 2 files")
    expect(text).toContain("files (^|/)routes/ — matches no file in this project")
    const json = JSON.parse((await runCli(root, ["list", "--format", "json"])).stdout)
    expect(json.map((rule: { matchingFiles: number }) => rule.matchingFiles)).toEqual([2, 0])
  })

  test("a rule id prints that rule in full, with the text of every section it cites", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "app/no-print",
          name: "No print",
          files: "^app/",
          detect: { regex: { pattern: "print\\(" } },
          message: "{{file}}:{{line}} prints. Use the logger.",
          context: ["@AGENTS.md#logging"],
        },
        { id: "app/other", name: "Other", files: "^app/", stages: ["touch"], context: ["@AGENTS.md"] },
      ]),
      "AGENTS.md": "# Project\n\n## Logging\n\nNever print. Use the module logger.\n\n## Other\n\nUnrelated.\n",
      "app/a.py": "x = 1\n",
    })
    const result = await runCli(root, ["list", "app/no-print"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("app/no-print  regex")
    expect(result.stdout).toContain("message {{file}}:{{line}} prints. Use the logger.")
    expect(result.stdout).toContain("--- AGENTS.md#logging ---\n## Logging\n\nNever print. Use the module logger.")
    expect(result.stdout).not.toContain("Unrelated.")
    expect(result.stdout).not.toContain("app/other")
    // The files themselves, so a count of 2 that is one module and an __init__.py can be seen.
    expect(result.stdout).toContain("  matching app/a.py")
    const json = JSON.parse((await runCli(root, ["list", "app/no-print", "--format", "json"])).stdout)
    expect(json[0].matching).toEqual(["app/a.py"])
    expect(json[0].sections).toEqual([
      { ref: "AGENTS.md#logging", content: "## Logging\n\nNever print. Use the module logger." },
    ])
    const unknown = await runCli(root, ["list", "app/nope"])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('no rule "app/nope"')
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
