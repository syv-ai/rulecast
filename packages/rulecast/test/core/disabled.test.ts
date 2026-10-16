import { describe, expect, test } from "vitest"

import type { Diagnostic } from "../../src/core/compile/project"
import { disabledCount, disabledRules, disabledText } from "../../src/core/disabled"

const REPO = "https://example.com/rules.git@v1.0.0"

const missingRepo: Diagnostic = {
  source: REPO,
  rule: null,
  message: "not in the cache",
  level: "error",
  hint: "rulecast install",
  rules: ["py/a", "py/b", "py/c"],
}

describe("disabledRules", () => {
  test("a repo that is not in the cache counts every rule in its entry, with the hint", () => {
    const groups = disabledRules({ diagnostics: [missingRepo], detectorErrors: [] })
    expect(groups).toEqual([
      { reason: `${REPO}: not in the cache`, hint: "rulecast install", rules: ["py/a", "py/b", "py/c"] },
    ])
    expect(disabledText(groups[0]!)).toBe(`3 rules disabled: ${REPO}: not in the cache (run rulecast install)`)
  })

  test("a rule that failed to compile counts one, and warnings count nothing", () => {
    const groups = disabledRules({
      diagnostics: [
        { source: ".rulecast-config.yaml", rule: "mine", message: "invalid regex", level: "error" },
        { source: REPO, rule: null, message: "looks like a branch", level: "warning" },
      ],
      detectorErrors: [],
    })
    expect(groups.map(disabledText)).toEqual(["1 rule disabled: .rulecast-config.yaml: invalid regex"])
  })

  test("detector failures group by kind and message, and a rule is counted once", () => {
    const groups = disabledRules({
      diagnostics: [],
      detectorErrors: [
        { kind: "linter", rules: ["py/ruff-a"], message: "ruff not installed" },
        { kind: "linter", rules: ["py/ruff-b", "py/ruff-a"], message: "ruff not installed" },
        { kind: "command", rules: ["sh/x"], message: "shellcheck not installed" },
      ],
    })
    expect(groups.map(disabledText)).toEqual([
      "1 rule disabled: command detector: shellcheck not installed",
      "2 rules disabled: linter detector: ruff not installed",
    ])
    expect(disabledCount(groups)).toBe(3)
  })

  test("a config that did not load names no rules but is still said", () => {
    const groups = disabledRules({
      diagnostics: [{ source: ".rulecast-config.yaml", rule: null, message: "not valid YAML", level: "error" }],
      detectorErrors: [],
    })
    expect(groups.map(disabledText)).toEqual([
      "no rules ran: the config did not load: .rulecast-config.yaml: not valid YAML",
    ])
    expect(disabledCount(groups)).toBe(0)
  })

  test("nothing wrong is nothing disabled", () => {
    expect(disabledRules({ diagnostics: [], detectorErrors: [] })).toEqual([])
  })
})
