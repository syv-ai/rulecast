import { describe, expect, test } from "vitest"

import { addLocalRules, newConfigText } from "../../src/init/config-text"
import { detectHooks, globToRegex, hookRule, notOfferedLines, rebaseGlob, scanHooks } from "../../src/init/hooks"

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

describe("hooks for a project below the git top", () => {
  const ROOTED = `pre-commit:
  jobs:
    - name: pytest
      root: backend/
      glob: "*.py"
      run: pytest
    - name: eslint
      glob: "frontend/**/*.ts"
      run: eslint
`

  test("a lefthook job's root: is prefixed onto its glob, then rebased onto the project", async () => {
    const patterns = (hooks: Awaited<ReturnType<typeof detectHooks>>) => hooks.map((hook) => [hook.id, hook.files])
    expect(patterns(await detectHooks(files({ "lefthook.yml": ROOTED }), "backend"))).toEqual([
      ["hook/pre-commit-pytest", "^.*\\.py$"],
    ])
    expect(patterns(await detectHooks(files({ "lefthook.yml": ROOTED }), "frontend"))).toEqual([
      ["hook/pre-commit-eslint", "^.*/.*\\.ts$"],
    ])
    expect(patterns(await detectHooks(files({ "lefthook.yml": ROOTED })))).toEqual([
      ["hook/pre-commit-pytest", "^backend/.*\\.py$"],
      ["hook/pre-commit-eslint", "^frontend/.*/.*\\.ts$"],
    ])
  })

  test("the source is named from the project, and a rule does not cite a config outside it", async () => {
    const [hook] = await detectHooks(files({ "lefthook.yml": ROOTED }), "services/backend")
    expect(hook).toBeUndefined()
    const [pytest] = await detectHooks(files({ "lefthook.yml": ROOTED }), "backend/")
    expect(pytest!.source).toBe("../lefthook.yml")
    expect(hookRule(pytest!).context).toEqual([])
  })

  test("pre-commit: a files: regex anchored to another directory is not offered; anything else is", async () => {
    const config = `repos:
  - repo: local
    hooks:
      - { id: web, entry: eslint, language: system, files: ^frontend/ }
      - { id: api, entry: mypy, language: system, files: ^backend/.*\\.py$ }
      - { id: any, entry: check, language: system, files: \\.py$ }
      - { id: top, entry: check, language: system, files: ^(backend|frontend)/ }
`
    const ids = async (project: string) =>
      (await detectHooks(files({ ".pre-commit-config.yaml": config }), project)).map((hook) => [hook.id, hook.files])
    expect(await ids("backend")).toEqual([
      ["hook/api", null],
      ["hook/any", null],
      ["hook/top", null],
    ])
    expect((await ids("")).length).toBe(4)
  })

  test("the hooks left out of a project are kept, each with why", async () => {
    const config = `pre-commit:
  jobs:
    - name: lint
      glob: "{a,b}/*.py"
      run: ruff check
    - name: web
      root: frontend/
      run: eslint
    - name: types
      glob: "*.py"
      run: mypy
`
    const scan = await scanHooks(files({ "lefthook.yml": config }), "backend")
    expect(scan.offered.map((hook) => hook.id)).toEqual(["hook/pre-commit-types"])
    expect(notOfferedLines(scan.skipped)).toEqual([
      "Not offered from ../lefthook.yml: lint (glob {a,b}/*.py can't be rebased onto backend)",
      "Not offered from ../lefthook.yml: web (runs outside backend)",
    ])
    const preCommit =
      "repos:\n  - repo: local\n    hooks:\n      - { id: web, entry: eslint, language: system, files: ^frontend/src/ }\n"
    const pre = await scanHooks(files({ ".pre-commit-config.yaml": preCommit }), "backend")
    expect(notOfferedLines(pre.skipped)).toEqual([
      "Not offered from ../.pre-commit-config.yaml: web (files only under frontend/src/)",
    ])
    expect((await scanHooks(files({ "lefthook.yml": config }))).skipped).toEqual([])
  })

  test("many hooks of other directories are counted in one line", () => {
    const other = (name: string) => ({ name, source: "../lefthook.yml", reason: "runs outside api", elsewhere: true })
    const skipped = [other("a"), other("b"), other("c"), other("d")]
    skipped.push({
      name: "lint",
      source: "../lefthook.yml",
      reason: "glob {a,b}/*.py can't be rebased onto api",
      elsewhere: false,
    })
    expect(notOfferedLines(skipped)).toEqual([
      "Not offered from ../lefthook.yml: lint (glob {a,b}/*.py can't be rebased onto api)",
      "Not offered from ../lefthook.yml: 4 hooks for other directories",
    ])
  })

  test("a hook rule from a config outside the project says so in its description", async () => {
    const [pytest] = await detectHooks(files({ "lefthook.yml": ROOTED }), "backend")
    expect(hookRule(pytest!).description).toBe(
      "Runs the lefthook job pytest from ../lefthook.yml. No doc section: the config is outside this project.",
    )
    const [top] = await detectHooks(files({ "lefthook.yml": ROOTED }))
    expect(hookRule(top!).description).toBeUndefined()
  })

  test("rebaseGlob: exact rebases only; anything else is not offered", () => {
    expect(rebaseGlob("backend/*.py", "backend/")).toBe("^.*\\.py$")
    expect(rebaseGlob("backend/src/*.py", "backend/")).toBe("^src/.*\\.py$")
    expect(rebaseGlob("*.py", "backend/")).toBe("^.*\\.py$")
    expect(rebaseGlob("**/*.py", "backend/")).toBe("^.*\\.py$")
    expect(rebaseGlob("**/Makefile", "backend/")).toBe("^(.*/)?Makefile$")
    expect(rebaseGlob("backend/*", "backend/")).toBeNull()
    expect(rebaseGlob("frontend/*.ts", "backend/")).toBeUndefined()
    expect(rebaseGlob("*/src/*.py", "backend/")).toBeUndefined()
    expect(rebaseGlob("back?nd/*.py", "backend/")).toBeUndefined()
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
    const text = newConfigText([hookRule(mypy)])
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
