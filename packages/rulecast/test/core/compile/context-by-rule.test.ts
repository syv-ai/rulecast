import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { compile } from "../../../src/core/compile/project"
import { allRuleContext, type CompiledRule, findingDocs, ruleContextFor } from "../../../src/core/compile/rule"
import { createRegistry } from "../../../src/core/detection/registry"
import { fetchingRepos } from "../../../src/core/repos/provider"
import type { Match } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const registry = createRegistry([...builtinDetectors])

const docs = {
  "docs/conventions.md": "# Conventions\n\n## Comparisons\nUse ===.\n\n## Logging\nUse the logger.\n",
  "docs/async.md": "# Async\n\n## Awaiting\nAwait it.\n",
}

async function compileRules(...rules: unknown[]) {
  const root = await createProject({
    ...docs,
    ".rulecast-config.yaml": stringify({ repos: [{ repo: "local", rules }] }),
  })
  return compile({ root, registry, repos: fetchingRepos(TEST_HOME) })
}

const eslintRule = (extra: Record<string, unknown> = {}) => ({
  id: "linter/eslint",
  name: "ESLint errors",
  types_or: ["javascript", "jsx", "ts", "tsx"],
  detect: { linter: { tool: "eslint" } },
  message: "{{message}} ({{ruleId}})",
  ...extra,
})

const errorsOf = async (...rules: unknown[]) =>
  (await compileRules(...rules)).diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => [diagnostic.rule, diagnostic.message])

const match = (ruleId: string, docsUrl?: string): Match => ({
  file: "src/a.js",
  line: 1,
  endLine: 1,
  column: 1,
  text: "x",
  captures: { message: "m", ruleId },
  ...(docsUrl && { docs: docsUrl }),
})

async function compiledEslint(extra: Record<string, unknown>): Promise<CompiledRule> {
  const project = await compileRules(eslintRule(extra))
  expect(project.diagnostics).toEqual([])
  return project.rules[0]!
}

describe("context_by_rule", () => {
  test("maps lint rule ids to references checked like context", async () => {
    const rule = await compiledEslint({
      context_by_rule: {
        eqeqeq: "@docs/conventions.md#comparisons",
        "@typescript-eslint/no-floating-promises": [
          "@docs/async.md#awaiting",
          { path: "@docs/conventions.md#logging", mode: "read" },
        ],
      },
    })
    expect([...rule.contextByRule.keys()]).toEqual(["eqeqeq", "@typescript-eslint/no-floating-promises"])
    expect(rule.contextByRule.get("eqeqeq")!.map((spec) => spec.ref)).toEqual(["docs/conventions.md#comparisons"])
    expect(
      rule.contextByRule.get("@typescript-eslint/no-floating-promises")!.map((spec) => [spec.ref, spec.mode]),
    ).toEqual([
      ["docs/async.md#awaiting", "inject"],
      ["docs/conventions.md#logging", "read"],
    ])
  })

  test("a rule without the key has an empty map", async () => {
    expect((await compiledEslint({})).contextByRule.size).toBe(0)
  })

  test("rejects context_by_rule on a regex rule and on a touch rule", async () => {
    expect(
      await errorsOf(
        {
          id: "regex",
          name: "Regex",
          detect: { regex: { pattern: "x" } },
          message: "{{file}}",
          context_by_rule: { x: "@docs/conventions.md" },
        },
        {
          id: "touch",
          name: "Touch",
          stages: ["touch"],
          context: ["@docs/conventions.md"],
          context_by_rule: { x: "@docs/conventions.md" },
        },
      ),
    ).toEqual([
      ["regex", "context_by_rule needs a detector that reports rule ids; regex does not"],
      ["touch", "context_by_rule needs a detector that reports rule ids; a rule without detect does not"],
    ])
  })

  test("names the missing anchor and the lint rule it was for", async () => {
    expect(
      await errorsOf(
        eslintRule({ context_by_rule: { eqeqeq: "@docs/conventions.md#nope" } }),
        eslintRule({ id: "linter/two", context_by_rule: { "no-console": "@docs/missing.md" } }),
        eslintRule({ id: "linter/three", context_by_rule: { eqeqeq: [] } }),
      ),
    ).toEqual([
      ["linter/eslint", 'context_by_rule.eqeqeq: anchor "#nope" not found in docs/conventions.md'],
      ["linter/two", "context_by_rule.no-console: referenced file not found: docs/missing.md"],
      ["linter/three", "context_by_rule.eqeqeq: Array must contain at least 1 element(s)"],
    ])
  })

  test("rejects a ruff rule name as a key", async () => {
    expect(
      await errorsOf({
        id: "linter/ruff",
        name: "Ruff errors",
        detect: { linter: { tool: "ruff" } },
        message: "{{message}} ({{ruleId}})",
        context_by_rule: { B006: "@docs/conventions.md", "mutable-argument-default": "@docs/conventions.md" },
      }),
    ).toEqual([
      ["linter/ruff", "context_by_rule.mutable-argument-default: ruff reports rule codes such as B006, not names"],
    ])
  })

  test("ruleContextFor puts the rule's own context first, then each fired lint rule's, once", async () => {
    const rule = await compiledEslint({
      context: ["@docs/async.md"],
      context_by_rule: {
        eqeqeq: "@docs/conventions.md#comparisons",
        "no-console": ["@docs/conventions.md#logging", "@docs/conventions.md#comparisons"],
        "no-debugger": "@docs/async.md#awaiting",
      },
    })
    const refs = ruleContextFor(rule, [match("no-console"), match("eqeqeq"), match("no-console"), match("other")])
    expect(refs.map((spec) => spec.ref)).toEqual([
      "docs/async.md",
      "docs/conventions.md#logging",
      "docs/conventions.md#comparisons",
    ])
    expect(allRuleContext(rule).map((spec) => spec.ref)).toEqual([
      "docs/async.md",
      "docs/conventions.md#comparisons",
      "docs/conventions.md#logging",
      "docs/async.md#awaiting",
    ])
  })

  test("findingDocs prefers the project's section over the tool's url", async () => {
    const rule = await compiledEslint({ context_by_rule: { eqeqeq: "@docs/conventions.md#comparisons" } })
    const docsOf = findingDocs(rule, match("eqeqeq", "https://eslint.org/docs/latest/rules/eqeqeq"))
    expect(docsOf).not.toBeNull()
    expect("spec" in docsOf! && docsOf.spec.ref).toBe("docs/conventions.md#comparisons")
  })

  test("findingDocs falls back to the url, and to nothing", async () => {
    const rule = await compiledEslint({ context_by_rule: { eqeqeq: "@docs/conventions.md#comparisons" } })
    expect(findingDocs(rule, match("no-console", "https://eslint.org/docs/latest/rules/no-console"))).toEqual({
      url: "https://eslint.org/docs/latest/rules/no-console",
    })
    expect(findingDocs(rule, match(""))).toBeNull()
  })
})
