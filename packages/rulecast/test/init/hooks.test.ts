import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { stringify } from "yaml"

import { RULE_ID } from "../../src/core/config/schema"
import { HK_PRE_PUSH_UNREAD, type HkPlan } from "../../src/detectors/hook/resolve"
import { addLocalRules, newConfigText } from "../../src/init/config-text"
import { detectHooks, globToRegex, hookRule, notOfferedLines, rebaseGlob, scanHooks } from "../../src/init/hooks"

const files = (map: Record<string, string>) => async (file: string) => map[file] ?? null

/** init reads remote hooks' manifests from pre-commit's and prek's clones: none but the ones a test makes. */
let cacheHome = ""
beforeEach(async () => {
  cacheHome = await mkdtemp(path.join(tmpdir(), "rulecast-init-hooks-cache-"))
  vi.stubEnv("XDG_CACHE_HOME", cacheHome)
  vi.stubEnv("PRE_COMMIT_HOME", "")
  vi.stubEnv("PREK_HOME", "")
  return () => vi.unstubAllEnvs()
})

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

  test("a hook that can never fail says why (#77)", async () => {
    const config = `repos:
  - repo: local
    hooks:
      - id: mypy-gate
        entry: bash -c 'mypy "\${files[@]}" || true'
        language: system
      - id: knip-check
        entry: bash -c 'cd frontend && npm run knip || true'
        language: system
      - id: exit-zero
        entry: bash -c 'pytest; exit 0'
        language: system
      - id: via-script
        entry: npm run typecheck
        language: system
      - id: honest
        entry: bash -c 'tsc --noEmit || exit 1'
        language: system
`
    const scripts = JSON.stringify({ scripts: { typecheck: "tsc --noEmit || :" } })
    const hooks = await detectHooks(files({ ".pre-commit-config.yaml": config, "package.json": scripts }))
    expect(hooks.map((hook) => [hook.id, hook.neverFails])).toEqual([
      ["hook/mypy-gate", "|| true"],
      ["hook/knip-check", "|| true"],
      ["hook/exit-zero", "; exit 0"],
      ["hook/via-script", "|| : (in npm run typecheck)"],
      ["hook/honest", undefined],
    ])
  })

  test("reading a huge command stays linear", async () => {
    for (const run of ["a#".repeat(200_000), "a&>".repeat(200_000), "a ".repeat(200_000)]) {
      const started = performance.now()
      await detectHooks(files({ "lefthook.yml": stringify({ "pre-commit": { jobs: [{ name: "x", run }] } }) }))
      expect(performance.now() - started).toBeLessThan(2_000)
    }
  })

  // Only the script the last command runs counts, one level down.
  test.each([
    ["npm run prep && npm run lint", undefined],
    ["npm run lint && npm run soft", "|| true (in npm run soft)"],
    ["pnpm soft", "|| true (in pnpm run soft)"],
    ["(npm run soft) && eslint .", undefined],
    ["npm run soft && eslint .", undefined],
  ])("never fails through a package script: %j -> %s", async (run, neverFails) => {
    const scripts = { prep: "rm -rf out || true", lint: "eslint .", soft: "eslint . || true" }
    const config = stringify({ "pre-commit": { jobs: [{ name: "check", run }] } })
    const [hook] = await detectHooks(files({ "lefthook.yml": config, "package.json": JSON.stringify({ scripts }) }))
    expect(hook?.neverFails).toBe(neverFails)
  })

  // Only how the script ends decides: a guarded setup line, a substitution, a string, a comment or
  // `set +e … exit $status` leaves the check's own exit code in place.
  test.each([
    ["mypy . || exit 1", undefined],
    ["mypy . || true", "|| true"],
    ["mypy . || exit 0", "|| exit 0"],
    ["mypy . ||true", "|| true"],
    ["mypy . 2>&1 || true", "|| true"],
    ["mypy . 2>&1", undefined],
    ["true &>/dev/null; mypy . 2>&1", undefined],
    ["mypy . || :", "|| :"],
    ["mypy .; exit 0", "; exit 0"],
    ["mypy . ; true", "; true"],
    ["mypy . || echo failed", "|| echo failed"],
    ["mypy . || echo 'mypy failed'", "|| echo 'mypy failed'"],
    ["mypy . || exit 0 # tolerate", "|| exit 0"],
    ["mypy . || { true; }", "|| { true; }"],
    ["mypy .\nexit 0\n", "; exit 0"],
    ["mypy . | tee out.txt", "| tee"],
    ["set -o pipefail; mypy . | tee out.txt", undefined],
    ["mypy . || true && false", undefined],
    ["test -f x || true; mypy .", undefined],
    ["[ -d node_modules ] || true\nnpm run lint", undefined],
    ["bash -c 'set +e; mypy .; status=$?; set -e; exit $status'", undefined],
    ["bash -c 'set +e; ty check'", undefined],
    ["echo '|| true' && mypy .", undefined],
    ["# ignore errors || true\nmypy .", undefined],
    ["bash -c 'cd x || true; mypy .'", undefined],
    ["bash -c 'rm -f .mypy.out || true; mypy . '", undefined],
    ["bash -c 'files=$(git diff --name-only HEAD | grep \\.py$ || true); [ -z \"$files\" ] || mypy $files'", undefined],
    ["bash -c 'mypy . || true' --", "|| true"],
    // A trailing exit 0 or true is reached only when the check passed, or exits nothing at all.
    ["if ! mypy .; then\n  exit 1\nfi\nexit 0", undefined],
    ["mypy . || exit 1\nexit 0", undefined],
    ["mypy . || exit $?\nexit 0", undefined],
    ["set -e\nmypy .\ntrue", undefined],
    ["set -e; mypy .; echo ok; exit 0", undefined],
    ["set -euo pipefail; mypy .; exit 0", undefined],
    ["set -o errexit; mypy .; exit 0", undefined],
    ["sh -ec 'mypy .; exit 0'", undefined],
    ["bash -e -c 'mypy .; exit 0'", undefined],
    ["set -e\nmypy . || true", "|| true"],
    // The command line around a `sh -c '…'` decides when it goes on after it.
    ["sh -c 'mypy .' || true", "|| true"],
    ["bash -c 'mypy .'; exit 0", "; exit 0"],
    ['sh -c "mypy ." || :', "|| :"],
    ["sh -c 'mypy . || true' && mypy .", undefined],
    ["cd web && bash -c 'tsc || true'", "|| true"],
  ])("never fails: %j -> %s", async (run, neverFails) => {
    const config = stringify({ "pre-commit": { jobs: [{ name: "check", run }] } })
    const [hook] = await detectHooks(files({ "lefthook.yml": config }))
    expect(hook?.neverFails).toBe(neverFails)
  })

  test("a hook's stages come from its own stages, the config's default_stages, or its lefthook hook (#78)", async () => {
    const config = `default_stages: [pre-commit]
repos:
  - repo: local
    hooks:
      - id: conventional
        entry: conventional-pre-commit
        language: system
        stages: [commit-msg]
      - id: backend-tests
        entry: pytest
        language: system
        stages: [manual]
      - id: lint
        entry: eslint .
        language: system
`
    const hooks = await detectHooks(files({ ".pre-commit-config.yaml": config }))
    expect(hooks.map((hook) => [hook.id, hook.stages])).toEqual([
      ["hook/conventional", ["commit-msg"]],
      ["hook/backend-tests", ["manual"]],
      ["hook/lint", ["pre-commit"]],
    ])
    const lefthook = await detectHooks(files({ "lefthook.yml": LEFTHOOK }))
    expect(lefthook.map((hook) => hook.stages)).toEqual([["pre-commit"], ["pre-commit"], ["pre-push"]])
  })

  const planned = (name: string, status = "included", reasons: { kind: string; detail: string }[] = []) => ({
    name,
    status,
    reasons,
  })

  test("hk: steps hk plans for each hook, offered once each with every hook as a stage, run in check mode (#87)", async () => {
    const plans: Record<string, HkPlan> = {
      "pre-commit": { steps: [planned("eslint"), planned("ruff")] },
      check: { steps: [planned("eslint"), planned("knip")] },
    }
    const asked: string[] = []
    const plan = async (hook: string): Promise<HkPlan> => {
      asked.push(hook)
      return plans[hook] ?? { missing: true }
    }
    const scan = await scanHooks(files({ "hk.pkl": 'amends "..."\n' }), "", { plan })
    expect(scan.offered.map((hook) => [hook.id, hook.detect, hook.modifies, hook.stages])).toEqual([
      ["hook/pre-commit-eslint", { hk: "pre-commit/eslint" }, false, ["pre-commit", "check"]],
      ["hook/pre-commit-ruff", { hk: "pre-commit/ruff" }, false, ["pre-commit"]],
      ["hook/check-knip", { hk: "check/knip" }, false, ["check"]],
    ])
    // pre-push's plan asks the git remote: never planned.
    expect(asked).toEqual(["pre-commit", "check", "commit-msg"])
    expect(hookRule(scan.offered[0]!)).toMatchObject({
      name: "eslint (hk)",
      detect: { hook: { hk: "pre-commit/eslint" } },
      context: ["@hk.pkl"],
    })
  })

  test("hk: steps hk never runs to check, commit-msg steps and pre-push say why they are not offered", async () => {
    const plans: Record<string, HkPlan> = {
      "pre-commit": {
        steps: [
          planned("fmt", "skipped", [{ kind: "no_command", detail: "no command defined for run type: check" }]),
          planned("slow", "skipped", [{ kind: "profile_exclude", detail: "required profile(s) not enabled: slow" }]),
          planned("py", "skipped", [{ kind: "filter_no_match", detail: "no files matched filters" }]),
        ],
      },
      "commit-msg": { steps: [planned("conventional")] },
    }
    const hkPkl = 'hooks { ["pre-commit"] {} ["pre-push"] {} }\n'
    const scan = await scanHooks(files({ "hk.pkl": hkPkl }), "", {
      plan: async (hook) => plans[hook] ?? { missing: true },
    })
    // A step whose glob matches no file today still runs when one does.
    expect(scan.offered.map((hook) => hook.id)).toEqual(["hook/pre-commit-py"])
    expect(notOfferedLines(scan.skipped)).toEqual([
      "Not offered from hk.pkl: fmt (hk never runs it to check: no command defined for run type: check)",
      "Not offered from hk.pkl: slow (hk never runs it to check: required profile(s) not enabled: slow)",
      "Not offered from hk.pkl: conventional (commit-msg: checks the commit message, and a hook rule runs on files)",
      `Not offered from hk.pkl: hk pre-push steps (${HK_PRE_PUSH_UNREAD})`,
    ])
  })

  test("hk: a plan hk could not make is said, not silently empty", async () => {
    const scan = await scanHooks(files({ "hk.pkl": "hooks {\n" }), "", {
      plan: async () => ({ error: "hk.pkl:2:62: Missing `}` delimiter." }),
    })
    expect(scan.offered).toEqual([])
    expect(notOfferedLines(scan.skipped)).toEqual([
      "Not offered from hk.pkl: hk steps (hk could not read them: hk.pkl:2:62: Missing `}` delimiter.)",
    ])
  })

  test("hk: when reading the steps would download hk's Pkl package, hk is not asked", async () => {
    const scan = await scanHooks(files({ "hk.pkl": 'amends "..."\n' }), "", {
      unread: "hk's Pkl package x is not cached",
    })
    expect(notOfferedLines(scan.skipped)).toEqual([
      "Not offered from hk.pkl: hk steps (not read: hk's Pkl package x is not cached; `hk run pre-commit --plan` downloads it and lists them)",
    ])
  })

  test("hk: the config hk reads first is the one cited: hk.pkl before .config/hk.pkl", async () => {
    const plan = async (hook: string): Promise<HkPlan> =>
      hook === "pre-commit" ? { steps: [planned("eslint")] } : { missing: true }
    const both = await scanHooks(files({ "hk.pkl": "a\n", ".config/hk.pkl": "b\n" }), "", { plan })
    expect(both.offered.map((hook) => hook.source)).toEqual(["hk.pkl"])
    const config = await scanHooks(files({ ".config/hk.pkl": "b\n", ".hk.pkl": "c\n" }), "", { plan })
    expect(config.offered.map((hook) => hook.source)).toEqual([".config/hk.pkl"])
    // hk 2.12 does not read .hk.pkl.
    expect((await scanHooks(files({ ".hk.pkl": "c\n" }), "", { plan })).offered).toEqual([])
  })

  test("hook names that are not rule ids become valid, distinct ids; detect keeps the real name", async () => {
    // A lefthook job's name is free text, and a local pre-commit hook's id may have underscores or
    // capitals: "lint typescript" was offered as hook/pre-commit-lint typescript, which init then
    // wrote and validate refused (plan 21, #3).
    const lefthook = `pre-commit:
  jobs:
    - name: lint typescript
      run: eslint {staged_files}
    - name: Format JSON/CSS
      run: prettier --check {staged_files}
    - name: format json css
      run: prettier --check {staged_files}
`
    const preCommit = `repos:
  - repo: local
    hooks:
      - id: run_Tests
        name: tests
        entry: pytest
        language: system
`
    const hooks = await detectHooks(files({ "lefthook.yml": lefthook, ".pre-commit-config.yaml": preCommit }))
    expect(hooks.map((hook) => [hook.id, hook.detect])).toEqual([
      ["hook/run-tests", { "pre-commit": "run_Tests" }],
      ["hook/pre-commit-lint-typescript", { lefthook: "pre-commit/lint typescript" }],
      ["hook/pre-commit-format-json-css", { lefthook: "pre-commit/Format JSON/CSS" }],
      ["hook/pre-commit-format-json-css-2", { lefthook: "pre-commit/format json css" }],
    ])
    for (const hook of hooks) expect(hook.id).toMatch(RULE_ID)
  })

  test("a hook that runs a script is judged by the script, or said to be unknown (plan 21, #5)", async () => {
    // "npm run lint" ran biome --write, and init called it read-only; so were a shell script that
    // regenerates a client and a Python script that rewrites release notes.
    const preCommit = `repos:
  - repo: local
    hooks:
      - id: lint-write
        name: lint
        entry: npm run lint
        language: system
      - id: check
        name: check
        entry: pnpm run check
        language: system
      - id: lint-elsewhere
        name: lint elsewhere
        entry: npm run lint:all
        language: system
      - id: gen
        name: generate client
        entry: bash ./scripts/generate-client.sh
        language: system
      - id: release-date
        name: release date
        entry: uv run python scripts/add_latest_release_date.py
        language: system
      - id: missing
        name: missing script
        entry: npm run nope
        language: system
      - id: ruff-lint
        name: ruff lint
        entry: uv run ruff check
        language: system
`
    const lefthook = `pre-commit:
  jobs:
    - name: eslint
      run: pnpm eslint {staged_files}
`
    const packageJson = JSON.stringify({
      scripts: { lint: "biome check --write .", check: "eslint .", "lint:all": "bun run --filter frontend lint" },
    })
    const hooks = await detectHooks(
      files({ ".pre-commit-config.yaml": preCommit, "lefthook.yml": lefthook, "package.json": packageJson }),
    )
    expect(hooks.map((hook) => [hook.id, hook.modifies, hook.runs])).toEqual([
      ["hook/lint-write", true, undefined],
      ["hook/check", false, undefined],
      ["hook/lint-elsewhere", null, "npm run lint:all"],
      ["hook/gen", null, "./scripts/generate-client.sh"],
      ["hook/release-date", null, "scripts/add_latest_release_date.py"],
      ["hook/missing", null, "npm run nope"],
      ["hook/ruff-lint", false, undefined],
      ["hook/pre-commit-eslint", false, undefined],
    ])
  })

  test("script lookup sees past flags and workspace selectors, other runners and fixer names (plan 21 review)", async () => {
    const lefthook = `pre-commit:
  jobs:
    - name: a
      run: pnpm run --silent lint
    - name: b
      run: pnpm --filter web lint
    - name: c
      run: npm --prefix web run lint
    - name: d
      run: yarn workspace web lint
    - name: e
      run: npm run lintall
    - name: f
      run: npm run py
    - name: g
      run: npm run biome
    - name: h
      run: npm test
    - name: i
      run: npm run format:check
`
    const packageJson = JSON.stringify({
      scripts: {
        lint: "eslint --fix .",
        lintall: "turbo run lint",
        py: "black . && isort .",
        biome: "biome check --apply .",
        test: "jest -w 2",
        "format:check": "prettier --check .",
      },
    })
    const hooks = await detectHooks(files({ "lefthook.yml": lefthook, "package.json": packageJson }))
    expect(hooks.map((hook) => [hook.name, hook.modifies])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", null],
      ["f", true],
      ["g", true],
      ["h", false],
      ["i", false],
    ])
  })

  test("one pre-commit id listed twice is offered once: one rule runs every entry with that id", async () => {
    const config = `repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.18.0
    hooks:
      - id: mypy
      - id: mypy
        args: [--strict]
`
    const hooks = await detectHooks(files({ ".pre-commit-config.yaml": config }))
    expect(hooks.map((hook) => [hook.id, hook.detect])).toEqual([["hook/mypy", { "pre-commit": "mypy" }]])
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
      ["hook/pre-commit-pytest", "^(?=backend/).*\\.py$"],
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

  test("lefthook matches a glob from the git top, then keeps the files under root: so does the rule", async () => {
    const lefthook = `pre-commit:
  jobs:
    - name: src
      root: backend/
      glob: "backend/src/*.py"
      run: mypy
`
    const at = async (project: string) => (await detectHooks(files({ "lefthook.yml": lefthook }), project))[0]!.files
    expect(await at("")).toBe("^(?=backend/)backend/src/.*\\.py$")
    expect(await at("backend")).toBe("^src/.*\\.py$")
    const rooted = `pre-commit:\n  jobs:\n    - name: all\n      root: backend/api/\n      run: mypy {staged_files}\n`
    expect((await detectHooks(files({ "lefthook.yml": rooted }), "backend"))[0]!.files).toBe("^api/")
  })

  test("glob classes: [jt] and [!a] are classes, and [ ends a glob's literal start", () => {
    expect(globToRegex("*.[jt]s")).toBe("^.*\\.[jt]s$")
    expect(globToRegex("[!_]*.py")).toBe("^[^_].*\\.py$")
    expect(globToRegex("a[.py")).toBe("^a\\[\\.py$")
    expect(rebaseGlob("web/[ab]/*.ts", "web/")).toBe("^[ab]/.*\\.ts$")
    expect(rebaseGlob("[wx]eb/*.ts", "web/")).toBeUndefined()
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

describe("a hook that does not get its files: always_run, pass_filenames: false (AIP)", () => {
  const config = (hooks: string) => `repos:
  - repo: local
    hooks:
${hooks}`
  const hook = (id: string, keys: string) =>
    `      - id: ${id}\n        name: ${id}\n        entry: uv run mypy app/\n        language: system\n${keys}`
  const ALWAYS = "        always_run: true\n        pass_filenames: false\n        stages: [manual]\n"
  const detect = async (hooks: string, project = "") =>
    detectHooks(files({ ".pre-commit-config.yaml": config(hooks) }), project)
  /** What init says of an always_run hook it could give no filter. */
  const note = async (keys: string, project = "") =>
    (await detect(hook("check", `${ALWAYS}${keys}`), project))[0]!.everyChange
  /** What the description says a filter skips: a config file the tool reads, named for its types when they say which. */
  const CONFIG_ALONE = (example?: string) =>
    `Changing only a config file it reads${example === undefined ? "" : `, such as ${example},`} doesn't run it.`

  test("always_run with types rulecast reads as pre-commit does: the rule runs only on those, and says why", async () => {
    const [found] = await detect(hook("tsc", `${ALWAYS}        types_or: [ts, tsx]\n`))
    expect(found).toMatchObject({ files: null, types_or: ["ts", "tsx"] })
    expect(found!.everyChange).toBeUndefined()
    const rule = hookRule(found!)
    expect(rule.types_or).toEqual(["ts", "tsx"])
    expect(rule.description).toBe(
      `Runs only when a TypeScript or TSX file changed: the hook is always_run, so pre-commit would run it on every commit. ${CONFIG_ALONE("tsconfig.json")}`,
    )
    expect(newConfigText([rule])).toContain("        types_or: [ts, tsx]\n")
  })

  test("types: [python] is carried over: rulecast types scripts by shebang and name, as pre-commit does", async () => {
    const [found] = await detect(hook("mypy-check", `${ALWAYS}        types: [python]\n`))
    expect(found).toMatchObject({ files: null, types: ["python"] })
    expect(found!.everyChange).toBeUndefined()
    expect(hookRule(found!).description).toBe(
      `Runs only when a Python file changed: the hook is always_run, so pre-commit would run it on every commit. ${CONFIG_ALONE("pyproject.toml")}`,
    )
  })

  test("what can't be carried over is said, tag by tag, beside what is", async () => {
    // types is all of them: leaving text out of it only widens the rule.
    const keys = "        types: [file, text, python]\n        exclude_types: [markdown, python, ts, dockerfile]\n"
    const rule = hookRule((await detect(hook("check", `${ALWAYS}${keys}`)))[0]!)
    expect(rule).toMatchObject({ types: ["python"], exclude_types: ["markdown"] })
    expect(rule.description).toBe(
      "Runs only when a Python file other than Markdown changed: the hook is always_run, so pre-commit would run it on every commit. " +
        `${CONFIG_ALONE("pyproject.toml")} Left out of the hook's filter: exclude_types [python, ts, dockerfile] ` +
        "(python, ts: rulecast's takes in files pre-commit's does not; dockerfile: rulecast has no such file type).",
    )
    expect(newConfigText([rule])).toContain("        types: [python]\n        exclude_types: [markdown]\n")
    // One tag of types_or that can't be carried leaves the whole of it out.
    expect(await note("        types_or: [ts, dockerfile]\n")).toBe(
      "always_run, and its types_or [ts, dockerfile] can't be carried over (dockerfile: rulecast has no such file type)",
    )
    expect(await note("        types: [text]\n")).toBe(
      "always_run, and its types [text] can't be carried over (text: pre-commit decides text from a file's content)",
    )
    const [partly] = await detect(hook("check", `${ALWAYS}        types_or: [ts, dockerfile]\n        files: ^app/\n`))
    expect(hookRule(partly!).description).toBe(
      "Runs only when a file matching ^app/ changed: the hook is always_run, so pre-commit would run it on every commit. " +
        `${CONFIG_ALONE()} Left out of the hook's filter: types_or [ts, dockerfile] (dockerfile: rulecast has no such file type).`,
    )
  })

  test("a remote always_run hook whose manifest isn't on disk: its filter is unknown, and init says so", async () => {
    const remote =
      "repos:\n  - repo: https://github.com/example/none\n    rev: v1\n    hooks:\n      - id: typecheck\n        always_run: true\n"
    const [found] = await detectHooks(files({ ".pre-commit-config.yaml": remote }))
    expect(found!.everyChange).toBe("always_run, and its manifest isn't on disk, so its filter is unknown")
  })

  test("a regex with a lookbehind is not rebased below the top: it could look at the directory taken off", async () => {
    expect(await note("        files: ^backend/(?<=d/)src/\n", "backend")).toBe(
      "always_run, and its files ^backend/(?<=d/)src/ can't be carried over (it can't be made relative to backend)",
    )
  })

  test("always_run with a files regex: the rule gets it, rebased onto a project below the top", async () => {
    const keys = `${ALWAYS}        files: ^backend/app/\n`
    const [top] = await detect(hook("mypy-check", keys))
    expect(top!.files).toBe("^backend/app/")
    expect(hookRule(top!).description).toBe(
      `Runs only when a file matching ^backend/app/ changed: the hook is always_run, so pre-commit would run it on every commit. ${CONFIG_ALONE()}`,
    )
    const [below] = await detect(hook("mypy-check", keys), "backend")
    expect(below!.files).toBe("^app/")
  })

  test("a regex with a top-level | is not rebased: its other alternatives would keep the directory", async () => {
    const keys = "        files: ^backend/src/|^backend/tests/\n"
    expect(await note(keys, "backend")).toBe(
      "always_run, and its files ^backend/src/|^backend/tests/ can't be carried over (it can't be made relative to backend)",
    )
    // At the top it needs no rebasing, and a | inside a group is fine below it.
    expect((await detect(hook("check", `${ALWAYS}${keys}`)))[0]!.files).toBe("^backend/src/|^backend/tests/")
    expect((await detect(hook("check", `${ALWAYS}        files: ^backend/(src|tests)/\n`), "backend"))[0]!.files).toBe(
      "^(src|tests)/",
    )
  })

  test("a regex JavaScript reads otherwise than Python is not carried over", async () => {
    const python =
      "always_run, and its files %s can't be carried over (JavaScript does not read it as pre-commit's Python does)"
    for (const regex of ["\\.py\\Z", "\\Aapp/", "^a{,3}/", "^\\w+\\.py$", "(?x)^app/", "(?P<dir>app)/"]) {
      expect(await note(`        files: '${regex}'\n`)).toBe(python.replace("%s", regex))
    }
  })

  test("a filter that takes in every file of the project is no filter: it runs on every change", async () => {
    expect(await note("        files: ^backend/\n", "backend")).toBe(
      "always_run, and its files and types take in every file in this project",
    )
  })

  test("always_run with nothing to filter on: offered unchanged, and init says it runs on every change", async () => {
    const [found] = await detect(hook("mypy-check", ALWAYS))
    expect(found).toMatchObject({ files: null, everyChange: "always_run, and it names no files or types" })
    const rule = hookRule(found!)
    expect(rule.description).toBeUndefined()
    expect(rule.types ?? rule.types_or ?? rule.files).toBeUndefined()
  })

  test("pass_filenames: false: pre-commit already skips it when no file matches, so only an unfiltered one is noted", async () => {
    const [typed, bare] = await detect(
      `${hook("typed", "        pass_filenames: false\n        types: [ts]\n")}${hook("bare", "        pass_filenames: false\n")}`,
    )
    expect(typed!.types).toBeUndefined()
    expect(typed!.everyChange).toBeUndefined()
    expect(bare!.everyChange).toBe("pass_filenames: false, and it names no files or types")
  })

  test("a hook that gets its files is unchanged: pre-commit filters it", async () => {
    const [found] = await detect(hook("mypy", "        types: [python]\n"))
    expect(found).toEqual({
      id: "hook/mypy",
      name: "mypy",
      detect: { "pre-commit": "mypy" },
      files: null,
      modifies: false,
      source: ".pre-commit-config.yaml",
    })
  })

  test("a remote hook's always_run and types come from its manifest in pre-commit's clone", async () => {
    const url = "https://github.com/example/hooks"
    const clone = path.join(cacheHome, "pre-commit", "repoabc")
    await mkdir(path.join(clone, ".git"), { recursive: true })
    await writeFile(path.join(clone, ".git", "FETCH_HEAD"), `0123\t\ttag 'v1.0.0' of ${url}\n`)
    await writeFile(
      path.join(clone, ".pre-commit-hooks.yaml"),
      "- id: typecheck\n  entry: typecheck\n  language: system\n  always_run: true\n  types_or: [ts, tsx]\n",
    )
    const remote = `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    hooks:\n      - id: typecheck\n`
    const [found] = await detectHooks(files({ ".pre-commit-config.yaml": remote }))
    expect(found!.types_or).toEqual(["ts", "tsx"])
    // The config's own keys win over the manifest's.
    const own = `${remote}        types: [tsx]\n`
    const [overridden] = await detectHooks(files({ ".pre-commit-config.yaml": own }))
    expect(overridden).toMatchObject({ types: ["tsx"], types_or: ["ts", "tsx"] })
  })

  test("lefthook: a job with no files template and no glob or root is noted; every glob of a list becomes files", async () => {
    const lefthook = `pre-commit:
  jobs:
    - name: mypy
      run: uv run mypy app/
    - name: typed
      glob: "*.py"
      run: uv run mypy app/
    - name: listed
      glob: ["*.py", "*.pyi"]
      run: uv run mypy app/
    - name: given
      run: ruff check {staged_files}
`
    const hooks = await detectHooks(files({ "lefthook.yml": lefthook }))
    expect(hooks.map((one) => [one.id, one.files, one.everyChange])).toEqual([
      ["hook/pre-commit-mypy", null, "its command is given no files, and it names no glob or root"],
      ["hook/pre-commit-typed", "^.*\\.py$", undefined],
      ["hook/pre-commit-listed", "^.*\\.py$|^.*\\.pyi$", undefined],
      ["hook/pre-commit-given", null, undefined],
    ])
  })

  test("lefthook: a glob list below the top drops globs for other directories, and is not offered if one can't be rebased", async () => {
    const lefthook = `pre-commit:
  jobs:
    - name: both
      glob: ["backend/*.py", "frontend/*.ts"]
      run: check
    - name: odd
      glob: ["backend/*.py", "*/x/*.py"]
      run: check
`
    const scan = await scanHooks(files({ "lefthook.yml": lefthook }), "backend")
    expect(scan.offered.map((one) => [one.id, one.files])).toEqual([["hook/pre-commit-both", "^.*\\.py$"]])
    expect(scan.skipped.map((one) => one.reason)).toEqual(["glob */x/*.py can't be rebased onto backend"])
  })
})
