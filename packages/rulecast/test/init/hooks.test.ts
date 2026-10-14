import { describe, expect, test } from "vitest"

import { addLocalRules, newConfigText } from "../../src/init/config-text"
import { detectHooks, globToRegex, hookRule } from "../../src/init/hooks"

const files = (map: Record<string, string>) => async (file: string) => map[file] ?? null

const PRE_COMMIT = `repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: check-yaml
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.14.0
    hooks:
      - id: ruff-format
      - id: ruff-check
        args: [--fix]
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.18.0
    hooks:
      - id: mypy
  - repo: meta
    hooks:
      - id: check-hooks-apply
  - repo: local
    hooks:
      - id: rulecast
        name: rulecast
        entry: rulecast run
        language: system
`

const LEFTHOOK = `pre-commit:
  jobs:
    - name: fix-then-check
      group:
        jobs:
          - name: biome
            glob: "*.{js,ts}"
            run: biome check --write {staged_files}
            stage_fixed: true
          - name: rulecast
            run: npx rulecast run
    - name: typecheck
      glob: "*.ts"
      run: tsc --noEmit
pre-push:
  commands:
    test:
      run: pnpm test
`

describe("detectHooks", () => {
  test("pre-commit: every hook but meta ones and rulecast itself; fixers are marked", async () => {
    const hooks = await detectHooks(files({ ".pre-commit-config.yaml": PRE_COMMIT }))
    expect(hooks.map((hook) => [hook.id, hook.modifies])).toEqual([
      ["hook/trailing-whitespace", true],
      ["hook/check-yaml", false],
      ["hook/ruff-format", true],
      ["hook/ruff-check", true],
      ["hook/mypy", false],
    ])
    expect(hooks[4]).toEqual({
      id: "hook/mypy",
      name: "mypy",
      detect: { "pre-commit": "mypy" },
      files: null,
      modifies: false,
      source: ".pre-commit-config.yaml",
    })
  })

  test("lefthook: jobs inside groups and old-style commands, with their globs; rulecast itself is left out", async () => {
    const hooks = await detectHooks(files({ "lefthook.yml": LEFTHOOK }))
    expect(hooks.map((hook) => [hook.id, hook.detect, hook.files, hook.modifies])).toEqual([
      ["hook/pre-commit-biome", { lefthook: "pre-commit/biome" }, "^.*\\.(js|ts)$", true],
      ["hook/pre-commit-typecheck", { lefthook: "pre-commit/typecheck" }, "^.*\\.ts$", false],
      ["hook/pre-push-test", { lefthook: "pre-push/test" }, null, false],
    ])
  })

  test("no hook config is no hooks, and a config that does not parse is no hooks", async () => {
    expect(await detectHooks(files({}))).toEqual([])
    expect(await detectHooks(files({ ".pre-commit-config.yaml": "repos: [" }))).toEqual([])
  })
})

describe("globToRegex", () => {
  test("lefthook globs: * crosses directories, braces are alternatives, the rest is literal", () => {
    expect(globToRegex("*.{js,ts}")).toBe("^.*\\.(js|ts)$")
    expect(globToRegex("src/**/*.py")).toBe("^src/.*/.*\\.py$")
    expect(globToRegex("a?.md")).toBe("^a.\\.md$")
  })
})

describe("hook rules in the config", () => {
  const mypy = {
    id: "hook/mypy",
    name: "mypy",
    detect: { "pre-commit": "mypy" },
    files: null,
    modifies: false,
    source: ".pre-commit-config.yaml",
  }
  const biome = {
    id: "hook/pre-commit-biome",
    name: "biome",
    detect: { lefthook: "pre-commit/biome" },
    files: "^.*\\.(js|ts)$",
    modifies: true,
    source: "lefthook.yml",
  }

  test("a hook rule cites the config that declares the hook", () => {
    expect(hookRule(biome)).toEqual({
      id: "hook/pre-commit-biome",
      name: "biome (lefthook)",
      files: "^.*\\.(js|ts)$",
      detect: { hook: { lefthook: "pre-commit/biome" } },
      message: "{{file}}:{{line}}: {{message}}",
      context: ["@lefthook.yml"],
    })
  })

  test("a new config holds them under repo: local", () => {
    const text = newConfigText(null, [], [hookRule(mypy)])
    expect(text).toContain("  - repo: local\n    rules:\n      - id: hook/mypy\n")
    expect(text).toContain('        message: "{{file}}:{{line}}: {{message}}"\n')
  })

  test("an existing config gains them in its local repo, or a local repo when it has none", () => {
    const withLocal = "repos:\n  - repo: local\n    rules: []\n"
    expect(addLocalRules(withLocal, [hookRule(mypy)])).toBe(
      'repos:\n  - repo: local\n    rules:\n      - id: hook/mypy\n        name: "mypy (pre-commit)"\n        detect:\n          hook:\n            pre-commit: mypy\n        message: "{{file}}:{{line}}: {{message}}"\n        context:\n          - "@.pre-commit-config.yaml"\n',
    )
    const without = "repos:\n  - repo: https://x\n    rev: v1\n    rules: []\n"
    expect(addLocalRules(without, [hookRule(mypy)])).toContain("  - repo: local\n    rules:\n      - id: hook/mypy\n")
  })

  test("a rule already in the local repo is not added twice", () => {
    const once = addLocalRules("repos:\n  - repo: local\n    rules: []\n", [hookRule(mypy)])
    expect(addLocalRules(once, [hookRule(mypy)])).toBe(once)
  })
})
