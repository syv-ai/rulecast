import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { compile } from "../../../src/core/compile/project"
import { FIX_WITHOUT_EXAMPLE } from "../../../src/core/compile/rule"
import { createRegistry } from "../../../src/core/detection/registry"
import { cachedRepos } from "../../../src/core/repos/provider"
import { builtinDetectors } from "../../../src/detectors"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const registry = createRegistry([...builtinDetectors])

async function compileRules(...rules: unknown[]) {
  const root = await createProject({ ".rulecast-config.yaml": stringify({ repos: [{ repo: "local", rules }] }) })
  return compile({ root, registry, repos: cachedRepos(TEST_HOME) })
}

const BAD = [{ path: "a.py", code: "print(1)\n" }]

const regexRule = (extra: Record<string, unknown> = {}) => ({
  id: "py/logger",
  name: "Logger",
  files: "\\.py$",
  detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)", fix: "log.info({{args}})" } },
  message: "{{file}}:{{line}} print",
  examples: { bad: BAD },
  ...extra,
})

describe("compiling a rule with fix", () => {
  test("a regex rule with a fix and a bad example is fixable, and says nothing", async () => {
    const project = await compileRules(regexRule())
    expect(project.diagnostics).toEqual([])
    expect(project.rules[0]!.fixable).toBe(true)
  })

  test("a rule without fix is not fixable", async () => {
    const project = await compileRules(regexRule({ detect: { regex: { pattern: "print" } } }))
    expect(project.rules[0]!.fixable).toBe(false)
  })

  test("fix on a detector that cannot apply one is refused, naming the ones that can", async () => {
    for (const detect of [
      { linter: { tool: "ruff", rules: ["T201"], fix: "x" } },
      { command: { run: ["./check.sh"], fix: "x" } },
      { llm: { model: "haiku", prompt: "p", fix: "x" } },
      { path: { fix: "x" } },
    ]) {
      const project = await compileRules(regexRule({ detect }))
      expect(project.rules).toEqual([])
      const kind = Object.keys(detect)[0]
      expect(project.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        `fix is supported by regex and ast-grep rules only; ${kind} cannot apply one`,
      ])
    }
  })

  test("a fix with no bad example is dropped with a warning, and the rule still runs", async () => {
    for (const examples of [undefined, { good: [{ path: "a.py", code: "log.info(1)\n" }] }]) {
      const project = await compileRules(regexRule({ examples }))
      expect(project.rules).toHaveLength(1)
      expect(project.rules[0]!.fixable).toBe(false)
      expect(project.diagnostics).toEqual([
        expect.objectContaining({ rule: "py/logger", level: "warning", message: FIX_WITHOUT_EXAMPLE }),
      ])
    }
  })

  test("fixed on a bad example of a rule without fix is a warning; on a good example it is refused", async () => {
    const unfixed = await compileRules(
      regexRule({ detect: { regex: { pattern: "print" } }, examples: { bad: [{ ...BAD[0], fixed: "x" }] } }),
    )
    expect(unfixed.rules).toHaveLength(1)
    expect(unfixed.diagnostics.map((diagnostic) => [diagnostic.level, diagnostic.message])).toEqual([
      ["warning", "fixed is only checked for rules with fix"],
    ])
    const good = await compileRules(
      regexRule({ examples: { bad: BAD, good: [{ path: "a.py", code: "", fixed: "" }] } }),
    )
    expect(good.rules).toEqual([])
    expect(good.diagnostics[0]!.message).toContain("fixed")
  })
})
