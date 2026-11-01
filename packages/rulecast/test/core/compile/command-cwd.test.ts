import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { compile } from "../../../src/core/compile/project"
import { createRegistry } from "../../../src/core/detection/registry"
import { cachedRepos } from "../../../src/core/repos/provider"
import { builtinDetectors } from "../../../src/detectors"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const registry = createRegistry([...builtinDetectors])

async function compileCommand(command: Record<string, unknown>) {
  const rule = { id: "tests", name: "Tests", files: "\\.py$", detect: { command }, message: "{{message}}" }
  const root = await createProject({
    ".rulecast-config.yaml": stringify({ repos: [{ repo: "local", rules: [rule] }] }),
  })
  return compile({ root, registry, repos: cachedRepos(TEST_HOME) })
}

describe("compiling a command rule's cwd", () => {
  test("a directory inside the project compiles", async () => {
    const project = await compileCommand({ run: ["pytest", "{{files}}"], cwd: "backend" })
    expect(project.diagnostics).toEqual([])
    expect(project.rules.map((rule) => rule.id)).toEqual(["tests"])
  })

  test("a cwd that leaves the project is an error, and the rule does not run", async () => {
    const project = await compileCommand({ run: ["pytest", "{{files}}"], cwd: "../x" })
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((diagnostic) => [diagnostic.rule, diagnostic.level])).toEqual([["tests", "error"]])
    expect(project.diagnostics[0]!.message).toContain("cwd must be a directory inside the project")
  })
})
