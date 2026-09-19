# rulecast Plan 3c — Compile the new config and switch over Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile `.rulecast-config.yaml` and the manifests of its pinned rule repos into ready rules, then switch every consumer (pipeline, rule selection, `hook`, `check`, `validate`, `warm`, `init`) and every test to the new format and delete the old one.

**Architecture:** Task 9 adds the new compile beside the old one: a `RepoProvider` decides where a pinned repo's files come from (the cache only for hooks, fetch-if-missing for the CLI, a fixed directory for `try-repo`); `compileRule` turns one merged rule into a `CompiledRule` with `stages`, a regex/type file filter and references resolved against their root; `compile` walks the config's repo entries, merges overrides over manifest rules, and reports every problem as a `Diagnostic` with a level and, for missing repos, a hint. Task 10 makes the pipeline take a compiled project (the caller compiles, so hooks never fetch), selects rules by `stages`, finds the project root by `.rulecast-config.yaml`, deletes `src/core/compile/{compile,config,rules}.ts`, and migrates every test to the new format. Spec: `docs/specs/2026-09-15-rulecast-design.md` §4 (rule format, overrides, references, rule repos), §5 (compilation), §10, §12 (hook, cache), §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, zod 3, yaml 2, vitest, git.

Prerequisite: `2026-09-19-rulecast-03b-cache-repos.md` (tasks 6–8) is done. Continue with `2026-09-19-rulecast-03d-commands.md` (tasks 11–16) afterwards.

---

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME` (from Task 6 on).
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## What this part relies on from tasks 1–8

Names from `2026-09-19-rulecast-03a-monorepo-config.md` and `03b-cache-repos.md`, used here as they define them:

- `src/core/config/schema.ts`: `overrideSchema`, `ruleSchema`, `RuleEntry`, `Config` (camelCase output, including `defaultStages: Stage[] | null` and `minimumRulecastVersion: string | null`), `Stage`, `defaultConfig()`.
- `src/core/config/load.ts`: `CONFIG_FILE`, `MANIFEST_FILE`, `readConfigData(root)`, `parseConfig(data)`, `readManifest(dir)` (messages `.rulecast-config.yaml not found`, `.rulecast-rules.yaml not found`, `.rulecast-rules.yaml: must be a list of rules`).
- `src/core/files.ts`: `compileFilter`, `FileFilter`. `src/core/version.ts`: `VERSION`, `isOlder`. `src/core/git.ts`: `changedFilesSince`, `mergeBase`, `headCommit`.
- `src/core/references.ts`: `parseReference(input, defaultMode, root)`, `ReferenceRoot`, `ReferenceSpec` (project refs are repo-relative; rule repo refs are absolute, with `ref` = `<label>:<path>[#anchor]`), `ReferenceSyntaxError` including `reference "@../x.md" leaves its root`.
- `src/core/home.ts`: `cacheHome(env)`, `ensureProjectState(home, root)`, `debugLogger(stateDir)`; `sessionDir(stateDir, id)`, `detectorCacheDir(stateDir, kind)`, `WarmOptions.stateDir`, `PipelineOptions.stateDir`, `CliIo.env`.
- `src/core/repos/layout.ts`: `repoDir`, `repoLabel`. `src/core/repos/fetch.ts`: `cachedRepo`, `ensureRepo`.
- Test helpers: `test/helpers/home.ts` (`TEST_HOME`, `testEnv`, `stateDirFor`), `test/helpers/rule-repo.ts` (`createRuleRepo`), `test/helpers/cli.ts` (`runCli`/`captureIo` default to `testEnv`).

## File structure

All source and test paths are under `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/repos/provider.ts` | `RepoProvider`: cache-only (hooks), fetching (CLI), fixed directory (try-repo) |
| `src/core/compile/rule.ts` | `CompiledRule`; one merged rule → ready rule or diagnostic message |
| `src/core/compile/project.ts` | `compile` (config + manifests → rules + diagnostics), `compileManifest` |
| `src/core/compile/{compile,config,rules}.ts` | Deleted in Task 10 |
| `src/core/detection/select.ts` | Selection by `stages` (`selectDetectorRules`, `selectTouchRules`) |
| `src/core/pipeline.ts` | Takes a compiled project; only error diagnostics become warnings |
| `src/commands/project.ts` | Root = nearest `.rulecast-config.yaml` |
| `src/commands/{hook,check,validate,warm,init}.ts` | Compile with the right repo provider; `init` writes the new config |
| `src/adapters/claude-code/adapter.ts` | Block preamble names `.rulecast-config.yaml` |
| `test/helpers/{config,fixture,pipeline,rules}.ts` | New-format fixtures, `localConfig`, `compileAt`, `pipelineAt`, regex-based `rule()` |

## Decisions this part makes

- **`check` keeps working until Task 11.** It compiles with `fetchingRepos` and keeps its glob file listing; Task 11 replaces it with `run`.
- **Interim `init`.** Task 10 already changes `init`'s scaffold to the minimal `.rulecast-config.yaml` from the contract (an empty `local` repo), keeping its Claude Code settings merge; Task 13 moves the merge behind the adapter's `install` and adds `install`/`uninstall`. The example rule and `conventions/example.md` go away now, because the old format no longer compiles.
- **Hook warnings name the rule.** One config file now holds many rules, so a diagnostic warning reads `<source> (<rule>): <message> (run <hint>)`, with ` (<rule>)` left out when the diagnostic has no rule, e.g. `.rulecast-config.yaml (broken): unknown detector "nope" (run rulecast validate)` or `https://example.com/acme/rules@v1.0.0: not in the cache (run rulecast install)`.
- **`picomatch` is dropped.** Nothing uses globs after Task 10; `tinyglobby` stays for `check` until Task 11.

---

### Task 9: Compile `.rulecast-config.yaml` and rule repos

**Files:**
- Create: `src/core/repos/provider.ts`, `src/core/compile/rule.ts`, `src/core/compile/project.ts`
- Test: `test/core/repos/provider.test.ts`, `test/core/compile/project.test.ts`

The old `src/core/compile/compile.ts` stays in use until Task 10; nothing imports the new modules yet.

- [ ] **Step 1: Write the failing provider test**

`test/core/repos/provider.test.ts`:
```ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoLabel } from "../../../src/core/repos/layout"
import { cachedRepos, fetchingRepos, fixedRepo } from "../../../src/core/repos/provider"
import { TEST_HOME } from "../../helpers/home"
import { createRuleRepo } from "../../helpers/rule-repo"

describe("repo providers", () => {
  test("the cache never fetches; fetching fills the cache", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { "a.md": "# A\n" } }])
    expect(await cachedRepos(TEST_HOME).checkout(url, "v1.0.0")).toEqual({
      ok: false,
      missing: true,
      message: "not in the cache",
    })
    const fetched = await fetchingRepos(TEST_HOME).checkout(url, "v1.0.0")
    expect(fetched).toMatchObject({ ok: true, label: repoLabel(url, "v1.0.0") })
    if (!fetched.ok) return
    expect(readFileSync(path.join(fetched.dir, "a.md"), "utf8")).toBe("# A\n")
    expect(await cachedRepos(TEST_HOME).checkout(url, "v1.0.0")).toEqual(fetched)
  })

  test("a failed fetch is reported, not thrown", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { "a.md": "# A\n" } }])
    const result = await fetchingRepos(TEST_HOME).checkout(url, "v9.9.9")
    expect(result).toMatchObject({ ok: false, missing: false })
    if (!result.ok) expect(result.message).toMatch(/^fetch failed: /)
  })

  test("a fixed repo answers every url with its directory", async () => {
    const provider = fixedRepo("/work/rules", "rules@working-tree")
    expect(await provider.checkout("anything", "any")).toEqual({
      ok: true,
      dir: "/work/rules",
      label: "rules@working-tree",
    })
  })
})
```

- [ ] **Step 2: Write the failing compile test**

`test/core/compile/project.test.ts`. The fake detector declares its default stages through `events` (`slow: true` → verify only), so stage defaults are visible without real detectors:
```ts
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"
import { z } from "zod"

import { compile, compileManifest } from "../../../src/core/compile/project"
import { createRegistry } from "../../../src/core/detection/registry"
import { repoDir, repoLabel } from "../../../src/core/repos/layout"
import { cachedRepos, fetchingRepos } from "../../../src/core/repos/provider"
import type { Detector } from "../../../src/core/types"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"
import { createRuleRepo } from "../../helpers/rule-repo"

const fake: Detector<{ capture?: string; slow?: boolean }> = {
  kind: "fake",
  schema: z.object({ capture: z.string().optional(), slow: z.boolean().optional() }).strict(),
  captures: (config) => (config.capture ? [config.capture] : []),
  events: (config) => (config.slow ? ["verify"] : ["edit", "verify"]),
  run: async () => ({ findings: [], errors: [] }),
}

const registry = createRegistry([fake])

const conventions = "# API\n\n## Errors\nMap them.\n"

/** A project with `config` as its .rulecast-config.yaml. */
async function compileConfig(config: unknown, files: Record<string, string> = {}, fetch = true) {
  const root = await createProject({ "docs/api.md": conventions, ...files, ".rulecast-config.yaml": stringify(config) })
  const repos = fetch ? fetchingRepos(TEST_HOME) : cachedRepos(TEST_HOME)
  return compile({ root, registry, repos })
}

const local = (...rules: unknown[]) => ({ repos: [{ repo: "local", rules }] })

const detectRule = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Rule ${id}`,
  detect: { fake: {} },
  message: "{{file}}:{{line}}",
  ...extra,
})

const touchRule = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Rule ${id}`,
  stages: ["touch"],
  context: ["@docs/api.md"],
  ...extra,
})

/** A rule repo whose manifest has two rules and the doc they reference. */
function packageRepo() {
  return createRuleRepo([
    {
      tag: "v1.0.0",
      files: {
        ".rulecast-rules.yaml": stringify([
          {
            id: "python/no-print",
            name: "No print",
            description: "Use the logger.",
            files: "\\.py$",
            detect: { fake: { capture: "CALL" } },
            message: "{{file}}:{{line}} {{CALL}}",
            context: ["@packages/python/logging.md#printing"],
          },
          {
            id: "generated-code",
            name: "Generated code",
            files: "\\.gen\\.ts$",
            severity: "warning",
            detect: { fake: {} },
            message: "m",
          },
        ]),
        "packages/python/logging.md": "# Logging\n\n## Printing\nUse the logger.\n",
      },
    },
  ])
}

describe("compile: local rules", () => {
  test("compiles a local rule with defaults", async () => {
    const project = await compileConfig(
      local(
        detectRule("api/a", {
          files: "^src/",
          types: ["tsx"],
          exclude: "\\.test\\.tsx$",
          detect: { fake: { capture: "NAMES" } },
          message: "{{file}}:{{line}} {{NAMES}}",
          context: ["@docs/api.md#errors", { path: "@docs/api.md", mode: "read" }],
        }),
      ),
    )
    expect(project.diagnostics).toEqual([])
    const [rule] = project.rules
    expect(rule).toMatchObject({
      id: "api/a",
      name: "Rule api/a",
      description: null,
      source: "local",
      severity: "error",
      stages: ["edit", "verify"],
      message: "{{file}}:{{line}} {{NAMES}}",
      detector: { kind: "fake", config: { capture: "NAMES" }, captures: ["NAMES"] },
      context: [
        { ref: "docs/api.md#errors", path: "docs/api.md", anchor: "errors", mode: "inject" },
        { ref: "docs/api.md", path: "docs/api.md", anchor: null, mode: "read" },
      ],
    })
    expect(rule!.matches("src/components/Card.tsx")).toBe(true)
    expect(rule!.matches("src/components/Card.test.tsx")).toBe(false)
    expect(rule!.matches("src/components/card.ts")).toBe(false)
    expect(rule!.matches("lib/Card.tsx")).toBe(false)
  })

  test("the global files and exclude apply before a rule's own", async () => {
    const project = await compileConfig({ ...local(detectRule("a")), exclude: "^vendor/" })
    expect(project.rules[0]!.matches("app/x.py")).toBe(true)
    expect(project.rules[0]!.matches("vendor/x.py")).toBe(false)
  })

  test("stages come from the rule, then default_stages, then the detector or [touch]", async () => {
    const project = await compileConfig(
      local(
        detectRule("own", { stages: ["verify"] }),
        detectRule("detector", { detect: { fake: { slow: true } } }),
        touchRule("touch", { stages: undefined }),
      ),
    )
    expect(project.diagnostics).toEqual([])
    expect(project.rules.map((rule) => [rule.id, rule.stages])).toEqual([
      ["own", ["verify"]],
      ["detector", ["verify"]],
      ["touch", ["touch"]],
    ])
    const defaults = await compileConfig({ ...local(detectRule("a"), touchRule("b")), default_stages: ["edit"] })
    expect(defaults.rules.map((rule) => [rule.id, rule.stages])).toEqual([
      ["a", ["edit"]],
      ["b", ["touch"]],
    ])
  })

  test("touch rules need context and no detector", async () => {
    const project = await compileConfig(local(touchRule("ok"), touchRule("bad", { context: undefined })))
    expect(project.rules.map((rule) => rule.id)).toEqual(["ok"])
    expect(project.rules[0]!.detector).toBeNull()
    expect(project.diagnostics).toEqual([
      { source: ".rulecast-config.yaml", rule: "bad", message: "rules without detect need context", level: "error" },
    ])
  })

  test("reports each rule problem as a diagnostic and excludes the rule", async () => {
    const project = await compileConfig(
      local(
        detectRule("no-message", { message: undefined }),
        detectRule("touch-with-detect", { stages: ["touch"] }),
        touchRule("no-detect-edit", { stages: ["edit"] }),
        touchRule("message-without-detect", { message: "m" }),
        detectRule("unknown-detector", { detect: { nope: {} } }),
        detectRule("bad-config", { detect: { fake: { colour: 1 } } }),
        detectRule("bad-variable", { message: "{{reason}}" }),
        detectRule("bad-regex", { files: "(" }),
        detectRule("bad-type", { types: ["cobol"] }),
        touchRule("missing-file", { context: ["@docs/nope.md"] }),
        touchRule("missing-anchor", { context: ["@docs/api.md#nope"] }),
        touchRule("bad-syntax", { context: ["docs/api.md"] }),
        touchRule("escapes", { context: ["@../secrets.md"] }),
        detectRule("too-new", { minimum_rulecast_version: "99.0.0" }),
        { id: "no-name", stages: ["touch"], context: ["@docs/api.md"] },
        { id: "Bad Id", name: "x" },
        "not a rule",
      ),
    )
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => [d.rule, d.message])).toEqual([
      ["no-message", "rules with detect need a message"],
      ["touch-with-detect", "stages [touch] never run the detector: add edit or verify, or remove detect"],
      ["no-detect-edit", "rules without detect need stages: [touch]"],
      ["message-without-detect", "message needs detect"],
      ["unknown-detector", 'unknown detector "nope"'],
      ["bad-config", "detect.fake: (root): Unrecognized key(s) in object: 'colour'"],
      ["bad-variable", 'unknown template variable "reason"'],
      ["bad-regex", expect.stringMatching(/^files: invalid regex: /)],
      ["bad-type", 'unknown file type "cobol"'],
      ["missing-file", "referenced file not found: docs/nope.md"],
      ["missing-anchor", 'anchor "#nope" not found in docs/api.md'],
      ["bad-syntax", 'reference "docs/api.md" must start with "@"'],
      ["escapes", 'reference "@../secrets.md" leaves its root'],
      ["too-new", "requires rulecast 99.0.0 or newer (running 0.0.0)"],
      ["no-name", "name: Required"],
      ["Bad Id", "id: must be lowercase segments separated by /"],
      [null, "(root): Expected object, received string"],
    ])
    expect(new Set(project.diagnostics.map((d) => [d.source, d.level].join(" ")))).toEqual(
      new Set([".rulecast-config.yaml error"]),
    )
  })

  test("the same identity twice excludes both", async () => {
    const project = await compileConfig(local(detectRule("dup"), detectRule("dup"), detectRule("x", { alias: "dup" })))
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => d.message)).toEqual([
      'rule "dup" is configured more than once: give one an alias',
      'rule "dup" is configured more than once: give one an alias',
      'rule "dup" is configured more than once: give one an alias',
    ])
  })
})

describe("compile: the config", () => {
  test("a missing, unparseable or invalid config disables every rule", async () => {
    const missing = await compile({ root: await createProject({}), registry, repos: cachedRepos(TEST_HOME) })
    expect(missing.diagnostics).toEqual([
      { source: ".rulecast-config.yaml", rule: null, message: ".rulecast-config.yaml not found", level: "error" },
    ])
    const broken = await compile({
      root: await createProject({ ".rulecast-config.yaml": "repos: [" }),
      registry,
      repos: cachedRepos(TEST_HOME),
    })
    expect(broken.rules).toEqual([])
    expect(broken.diagnostics.map((d) => [d.source, d.level])).toEqual([[".rulecast-config.yaml", "error"]])
    const invalid = await compileConfig({ ...local(detectRule("a")), max_matches_per_rule: -1 })
    expect(invalid.rules).toEqual([])
    expect(invalid.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("max_matches_per_rule")])
    const camel = await compileConfig({ ...local(detectRule("a")), maxMatchesPerRule: 3 })
    expect(camel.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("maxMatchesPerRule")])
  })

  test("settings are read in snake_case", async () => {
    const project = await compileConfig({
      ...local(),
      context: { mode: "read", max_bytes: 100 },
      timeouts: { edit_deadline_ms: 20 },
      stop_gate: { max_blocks: 2 },
    })
    expect(project.diagnostics).toEqual([])
    expect(project.config).toMatchObject({
      context: { mode: "read", maxBytes: 100 },
      timeouts: { editDeadlineMs: 20, verifyMs: 60000 },
      stopGate: { maxBlocks: 2 },
    })
  })

  test("a config newer than rulecast, or a bad global regex, disables every rule", async () => {
    const tooNew = await compileConfig({ ...local(detectRule("a")), minimum_rulecast_version: "99.0.0" })
    expect(tooNew.rules).toEqual([])
    expect(tooNew.diagnostics.map((d) => d.message)).toEqual(["requires rulecast 99.0.0 or newer (running 0.0.0)"])
    const badRegex = await compileConfig({ ...local(detectRule("a")), files: "(" })
    expect(badRegex.rules).toEqual([])
    expect(badRegex.diagnostics.map((d) => d.message)).toEqual([expect.stringMatching(/^files: invalid regex: /)])
  })

  test("config data replaces the project's config file", async () => {
    const root = await createProject({ "docs/api.md": conventions })
    const project = await compile({
      root,
      registry,
      repos: cachedRepos(TEST_HOME),
      configData: local(touchRule("from-data")),
    })
    expect(project.diagnostics).toEqual([])
    expect(project.rules.map((rule) => rule.id)).toEqual(["from-data"])
  })
})

describe("compile: rule repos", () => {
  test("selects manifest rules; references resolve in the repo and carry its label", async () => {
    const url = await packageRepo()
    const project = await compileConfig({ repos: [{ repo: url, rev: "v1.0.0", rules: [{ id: "python/no-print" }] }] })
    expect(project.diagnostics).toEqual([])
    const label = repoLabel(url, "v1.0.0")
    const [rule] = project.rules
    expect(rule).toMatchObject({
      id: "python/no-print",
      name: "No print",
      description: "Use the logger.",
      source: label,
      detector: { kind: "fake", config: { capture: "CALL" }, captures: ["CALL"] },
      context: [
        {
          ref: `${label}:packages/python/logging.md#printing`,
          path: path.join(repoDir(TEST_HOME, url, "v1.0.0"), "packages/python/logging.md"),
          anchor: "printing",
          mode: "inject",
        },
      ],
    })
    expect(rule!.matches("app/x.py")).toBe(true)
  })

  test("overrides replace keys shallowly; an overridden context resolves in the project", async () => {
    const url = await packageRepo()
    const project = await compileConfig({
      repos: [
        {
          repo: url,
          rev: "v1.0.0",
          rules: [
            { id: "python/no-print", files: "^app/services/", severity: "warning", context: ["@docs/api.md#errors"] },
          ],
        },
      ],
    })
    expect(project.diagnostics).toEqual([])
    const [rule] = project.rules
    expect(rule).toMatchObject({
      severity: "warning",
      context: [{ ref: "docs/api.md#errors", path: "docs/api.md", anchor: "errors", mode: "inject" }],
    })
    expect(rule!.matches("app/services/x.py")).toBe(true)
    expect(rule!.matches("app/routes/x.py")).toBe(false)
  })

  test("an alias selects the same rule twice", async () => {
    const url = await packageRepo()
    const project = await compileConfig({
      repos: [
        {
          repo: url,
          rev: "v1.0.0",
          rules: [
            { id: "generated-code" },
            { id: "generated-code", alias: "generated-client", files: "^frontend/src/client/" },
          ],
        },
      ],
    })
    expect(project.diagnostics).toEqual([])
    expect(project.rules.map((rule) => rule.id)).toEqual(["generated-code", "generated-client"])
    expect(project.rules[1]!.matches("frontend/src/client/api.ts")).toBe(true)
    expect(project.rules[1]!.matches("src/routeTree.gen.ts")).toBe(false)
  })

  test("a repo missing from the cache disables only its rules, with a hint to install", async () => {
    const url = await packageRepo()
    const project = await compileConfig(
      { repos: [{ repo: url, rev: "v1.0.0", rules: [{ id: "python/no-print" }] }, ...local(touchRule("mine")).repos] },
      {},
      false,
    )
    expect(project.rules.map((rule) => rule.id)).toEqual(["mine"])
    expect(project.diagnostics).toEqual([
      { source: `${url}@v1.0.0`, rule: null, message: "not in the cache", level: "error", hint: "rulecast install" },
    ])
  })

  test("repo entry problems are diagnostics naming the repo and rev", async () => {
    const url = await packageRepo()
    const bare = await createRuleRepo([{ tag: "v1.0.0", files: { "README.md": "no manifest\n" } }])
    const project = await compileConfig({
      repos: [
        { repo: "local", rev: "v1", rules: [touchRule("skipped")] },
        { repo: url, rules: [{ id: "python/no-print" }] },
        {
          repo: url,
          rev: "v1.0.0",
          rules: [{ id: "python/nope" }, { id: "python/no-print", colour: "red" }, { id: "generated-code" }],
        },
        { repo: bare, rev: "v1.0.0", rules: [{ id: "x" }] },
        { repo: url, rev: "v9.9.9", rules: [{ id: "python/no-print" }] },
      ],
    })
    expect(project.rules.map((rule) => rule.id)).toEqual(["generated-code"])
    expect(project.diagnostics.map((d) => [d.source, d.rule, d.message])).toEqual([
      [".rulecast-config.yaml", null, "repos[0]: local repos take no rev"],
      [".rulecast-config.yaml", null, `repos[1] ${url}: rev is required`],
      [`${url}@v1.0.0`, "python/nope", "not in the manifest"],
      [".rulecast-config.yaml", "python/no-print", "(root): Unrecognized key(s) in object: 'colour'"],
      [`${bare}@v1.0.0`, null, ".rulecast-rules.yaml not found"],
      [`${url}@v9.9.9`, null, expect.stringMatching(/^fetch failed: /)],
    ])
    expect(project.diagnostics.every((d) => d.hint === undefined)).toBe(true)
  })

  test("a branch-like rev is a warning, not an error", async () => {
    const url = await packageRepo()
    const project = await compileConfig({ repos: [{ repo: url, rev: "main", rules: [{ id: "generated-code" }] }] })
    expect(project.rules.map((rule) => rule.id)).toEqual(["generated-code"])
    expect(project.diagnostics).toEqual([
      {
        source: `${url}@main`,
        rule: null,
        message: 'rev "main" looks like a branch: pin a tag or a full commit SHA',
        level: "warning",
      },
    ])
  })
})

describe("compileManifest", () => {
  test("compiles a manifest with references against its own directory", async () => {
    const dir = await createProject({
      ".rulecast-rules.yaml": stringify([
        touchRule("ok"),
        touchRule("ok"),
        detectRule("bad", { detect: { nope: {} } }),
      ]),
      "docs/api.md": conventions,
    })
    const { rules, diagnostics } = await compileManifest(dir, registry)
    expect(rules).toEqual([])
    expect(diagnostics.map((d) => [d.source, d.rule, d.message])).toEqual([
      [".rulecast-rules.yaml", "bad", 'unknown detector "nope"'],
      [".rulecast-rules.yaml", "ok", 'rule "ok" is defined more than once'],
      [".rulecast-rules.yaml", "ok", 'rule "ok" is defined more than once'],
    ])
  })

  test("a missing or malformed manifest is one diagnostic", async () => {
    expect((await compileManifest(await createProject({}), registry)).diagnostics).toEqual([
      { source: ".rulecast-rules.yaml", rule: null, message: ".rulecast-rules.yaml not found", level: "error" },
    ])
    const notList = await createProject({ ".rulecast-rules.yaml": "id: x\n" })
    expect((await compileManifest(notList, registry)).diagnostics[0]!.message).toBe(
      ".rulecast-rules.yaml: must be a list of rules",
    )
  })

  test("a valid manifest compiles every rule", async () => {
    const dir = await createProject({
      ".rulecast-rules.yaml": stringify([touchRule("a"), detectRule("b")]),
      "docs/api.md": conventions,
    })
    const { rules, diagnostics } = await compileManifest(dir, registry)
    expect(diagnostics).toEqual([])
    expect(rules.map((rule) => [rule.id, rule.source, rule.context.map((spec) => spec.path)])).toEqual([
      ["a", "local", ["docs/api.md"]],
      ["b", "local", []],
    ])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run test/core/repos/provider.test.ts test/core/compile/project.test.ts`
Expected: FAIL: cannot find module `../../../src/core/repos/provider` (and `../../../src/core/compile/project`).

- [ ] **Step 4: Implement the repo providers**

`src/core/repos/provider.ts`:
```ts
import { errorMessage } from "../errors"
import { cachedRepo, ensureRepo } from "./fetch"
import { repoLabel } from "./layout"

export type Checkout = { ok: true; dir: string; label: string } | { ok: false; message: string; missing: boolean }

/** Where compile finds a pinned rule repo's files. */
export interface RepoProvider {
  checkout(url: string, rev: string): Promise<Checkout>
}

/** For hooks, which never fetch (spec §4): a repo missing from the cache is reported, not fetched. */
export function cachedRepos(home: string): RepoProvider {
  return {
    async checkout(url, rev) {
      const dir = cachedRepo(home, url, rev)
      if (dir === null) return { ok: false, missing: true, message: "not in the cache" }
      return { ok: true, dir, label: repoLabel(url, rev) }
    },
  }
}

/** For the CLI: fetches repos missing from the cache. */
export function fetchingRepos(home: string): RepoProvider {
  return {
    async checkout(url, rev) {
      try {
        return { ok: true, dir: await ensureRepo(home, url, rev), label: repoLabel(url, rev) }
      } catch (error) {
        return { ok: false, missing: false, message: `fetch failed: ${errorMessage(error)}` }
      }
    },
  }
}

/** For try-repo: every repo is `dir`. */
export function fixedRepo(dir: string, label: string): RepoProvider {
  return {
    async checkout() {
      return { ok: true, dir, label }
    },
  }
}
```

- [ ] **Step 5: Implement rule compilation**

`src/core/compile/rule.ts`:
```ts
import path from "node:path"

import { sectionRange } from "../anchors"
import type { Config, RuleEntry, Stage } from "../config/schema"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError } from "../errors"
import { compileFilter, type FileFilter } from "../files"
import { parseReference, type ReferenceRoot, type ReferenceSpec, ReferenceSyntaxError } from "../references"
import { CORE_VARIABLES, templateVariables } from "../template"
import type { Severity } from "../types"
import { isOlder, VERSION } from "../version"

export interface CompiledDetector {
  kind: string
  config: unknown
  captures: string[]
}

export interface CompiledRule {
  /** alias when set, else id: the name findings, dedupe and session state use. */
  id: string
  name: string
  description: string | null
  /** "local", or the rule repo label ("syv-ai/rulecast@v0.2.0"). */
  source: string
  severity: Severity
  stages: Stage[]
  matches(file: string): boolean
  detector: CompiledDetector | null
  message: string | null
  context: ReferenceSpec[]
}

export interface RuleInput {
  /** A local rule, or a manifest rule with the config's override merged over it. */
  data: RuleEntry & { name: string }
  source: string
  /** Where `context` resolves: the project, unless the context came from a manifest. */
  contextRoot: ReferenceRoot
}

export interface RuleContext {
  config: Config
  registry: DetectorRegistry
  /** The config's global files/exclude, applied before every rule's own. */
  global: FileFilter
  /** Reads an absolute path once per compile; null when missing. */
  read(file: string): Promise<string | null>
}

/** A reference's ref without its anchor, for messages. */
function fileOf(spec: ReferenceSpec): string {
  return spec.anchor === null ? spec.ref : spec.ref.slice(0, spec.ref.length - spec.anchor.length - 1)
}

/** A ready rule, or the diagnostic message that disables it. */
export async function compileRule(input: RuleInput, context: RuleContext): Promise<CompiledRule | string> {
  const { data } = input
  const minimum = data.minimum_rulecast_version
  if (minimum !== undefined && isOlder(VERSION, minimum)) {
    return `requires rulecast ${minimum} or newer (running ${VERSION})`
  }

  let detector: CompiledDetector | null = null
  let defaultStages: Stage[] = ["touch"]
  if (data.detect) {
    const [kind, rawConfig] = Object.entries(data.detect)[0]!
    const implementation = context.registry.get(kind)
    if (!implementation) return `unknown detector "${kind}"`
    const parsed = implementation.schema.safeParse(rawConfig ?? {})
    if (!parsed.success) return `detect.${kind}: ${formatZodError(parsed.error)}`
    detector = { kind, config: parsed.data, captures: implementation.captures(parsed.data) }
    defaultStages = implementation.events(parsed.data)
  }
  const stages: Stage[] = data.stages ?? context.config.defaultStages ?? defaultStages

  if (detector) {
    if (data.message === undefined) return "rules with detect need a message"
    if (!stages.includes("edit") && !stages.includes("verify")) {
      return "stages [touch] never run the detector: add edit or verify, or remove detect"
    }
    const known = new Set<string>([...CORE_VARIABLES, ...detector.captures])
    const unknown = templateVariables(data.message).find((name) => !known.has(name))
    if (unknown) return `unknown template variable "${unknown}"`
  } else {
    if (stages.some((stage) => stage !== "touch")) return "rules without detect need stages: [touch]"
    if (data.message !== undefined) return "message needs detect"
    if (!data.context?.length) return "rules without detect need context"
  }

  const filter = compileFilter({
    files: data.files ?? "",
    exclude: data.exclude ?? "^$",
    types: data.types ?? ["file"],
    typesOr: data.types_or ?? [],
    excludeTypes: data.exclude_types ?? [],
  })
  if (typeof filter === "string") return filter

  const references: ReferenceSpec[] = []
  for (const reference of data.context ?? []) {
    let spec: ReferenceSpec
    try {
      spec = parseReference(reference, context.config.context.mode, input.contextRoot)
    } catch (error) {
      if (error instanceof ReferenceSyntaxError) return error.message
      throw error
    }
    const text = await context.read(path.resolve(input.contextRoot.dir, spec.path))
    if (text === null) return `referenced file not found: ${fileOf(spec)}`
    if (spec.anchor !== null && !sectionRange(text, spec.anchor)) {
      return `anchor "#${spec.anchor}" not found in ${fileOf(spec)}`
    }
    references.push(spec)
  }

  const { global } = context
  return {
    id: data.alias ?? data.id,
    name: data.name,
    description: data.description ?? null,
    source: input.source,
    severity: data.severity ?? "error",
    stages,
    matches: (file) => global(file) && filter(file),
    detector,
    message: data.message ?? null,
    context: references,
  }
}
```

- [ ] **Step 6: Implement project compilation**

`src/core/compile/project.ts`:
```ts
import { readFile } from "node:fs/promises"

import { CONFIG_FILE, MANIFEST_FILE, parseConfig, readConfigData, readManifest } from "../config/load"
import { type Config, defaultConfig, overrideSchema, ruleSchema } from "../config/schema"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError, isNotFound } from "../errors"
import { compileFilter } from "../files"
import type { ReferenceRoot } from "../references"
import type { RepoProvider } from "../repos/provider"
import { isOlder, VERSION } from "../version"
import { type CompiledRule, compileRule, type RuleContext, type RuleInput } from "./rule"

export interface Diagnostic {
  /** ".rulecast-config.yaml", ".rulecast-rules.yaml", or "<repo url>@<rev>" for a rule repo. */
  source: string
  rule: string | null
  message: string
  level: "error" | "warning"
  /** What a hook tells the developer to run; default "rulecast validate". Missing repos: "rulecast install". */
  hint?: string
}

export interface CompiledProject {
  root: string
  config: Config
  rules: CompiledRule[]
  diagnostics: Diagnostic[]
}

export interface CompileOptions {
  root: string
  registry: DetectorRegistry
  repos: RepoProvider
  /** Config data to compile instead of the project's .rulecast-config.yaml (try-repo). */
  configData?: unknown
}

/** Reads each absolute path at most once per compile; null when missing. */
function createReader(): (file: string) => Promise<string | null> {
  const texts = new Map<string, Promise<string | null>>()
  return (file) => {
    let text = texts.get(file)
    if (!text) {
      text = readFile(file, "utf8").catch((error: unknown) => {
        if (isNotFound(error)) return null
        throw error
      })
      texts.set(file, text)
    }
    return text
  }
}

function idOf(raw: unknown): string | null {
  const id = (raw as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

/** pre-commit's heuristic: a rev with no "." that is not hex is probably a branch. */
function isBranchLike(rev: string): boolean {
  return !rev.includes(".") && !/^[0-9a-f]+$/i.test(rev)
}

type Compiled = { rule: CompiledRule; source: string }

/** Drops every rule whose identity occurs more than once, with a diagnostic for each. */
function uniqueRules(compiled: Compiled[], diagnostics: Diagnostic[], message: (id: string) => string): CompiledRule[] {
  const counts = new Map<string, number>()
  for (const { rule } of compiled) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
  const rules: CompiledRule[] = []
  for (const { rule, source } of compiled) {
    if (counts.get(rule.id) === 1) rules.push(rule)
    else diagnostics.push({ source, rule: rule.id, message: message(rule.id), level: "error" })
  }
  return rules
}

/** The project config and the manifests of its pinned repos → ready rules plus diagnostics (spec §5). */
export async function compile(options: CompileOptions): Promise<CompiledProject> {
  const { root } = options
  const configFailure = (message: string, config = defaultConfig()): CompiledProject => ({
    root,
    config,
    rules: [],
    diagnostics: [{ source: CONFIG_FILE, rule: null, message, level: "error" }],
  })

  const data =
    options.configData !== undefined ? { ok: true as const, value: options.configData } : await readConfigData(root)
  if (!data.ok) return configFailure(data.message)
  const parsed = parseConfig(data.value)
  if (!parsed.ok) return configFailure(parsed.message)
  const config = parsed.value
  if (config.minimumRulecastVersion !== null && isOlder(VERSION, config.minimumRulecastVersion)) {
    return configFailure(`requires rulecast ${config.minimumRulecastVersion} or newer (running ${VERSION})`, config)
  }
  const global = compileFilter({
    files: config.files,
    exclude: config.exclude,
    types: [],
    typesOr: [],
    excludeTypes: [],
  })
  if (typeof global === "string") return configFailure(global, config)

  const diagnostics: Diagnostic[] = []
  const compiled: Compiled[] = []
  const context: RuleContext = { config, registry: options.registry, global, read: createReader() }
  const project: ReferenceRoot = { dir: root, label: null }
  const error = (source: string, rule: string | null, message: string, hint?: string) =>
    diagnostics.push({ source, rule, message, level: "error", ...(hint === undefined ? {} : { hint }) })
  const add = async (input: RuleInput, source: string) => {
    const result = await compileRule(input, context)
    if (typeof result === "string") error(source, input.data.alias ?? input.data.id, result)
    else compiled.push({ rule: result, source })
  }

  for (const [index, entry] of config.repos.entries()) {
    if (entry.repo === "local") {
      if (entry.rev !== undefined) {
        error(CONFIG_FILE, null, `repos[${index}]: local repos take no rev`)
        continue
      }
      for (const raw of entry.rules) {
        const rule = ruleSchema.safeParse(raw)
        if (!rule.success) error(CONFIG_FILE, idOf(raw), formatZodError(rule.error))
        else await add({ data: rule.data, source: "local", contextRoot: project }, CONFIG_FILE)
      }
      continue
    }

    if (entry.rev === undefined) {
      error(CONFIG_FILE, null, `repos[${index}] ${entry.repo}: rev is required`)
      continue
    }
    const source = `${entry.repo}@${entry.rev}`
    if (isBranchLike(entry.rev)) {
      diagnostics.push({
        source,
        rule: null,
        message: `rev "${entry.rev}" looks like a branch: pin a tag or a full commit SHA`,
        level: "warning",
      })
    }
    const checkout = await options.repos.checkout(entry.repo, entry.rev)
    if (!checkout.ok) {
      error(source, null, checkout.message, checkout.missing ? "rulecast install" : undefined)
      continue
    }
    const manifest = await readManifest(checkout.dir)
    if (!manifest.ok) {
      error(source, null, manifest.message)
      continue
    }
    const byId = new Map<string, unknown[]>()
    for (const raw of manifest.value) {
      const id = idOf(raw)
      if (id !== null) byId.set(id, [...(byId.get(id) ?? []), raw])
    }
    const repoRoot: ReferenceRoot = { dir: checkout.dir, label: checkout.label }
    for (const raw of entry.rules) {
      const override = overrideSchema.safeParse(raw)
      if (!override.success) {
        error(CONFIG_FILE, idOf(raw), formatZodError(override.error))
        continue
      }
      const { id } = override.data
      const candidates = byId.get(id) ?? []
      if (candidates.length !== 1) {
        error(source, id, candidates.length === 0 ? "not in the manifest" : "defined more than once in the manifest")
        continue
      }
      const base = ruleSchema.safeParse(candidates[0])
      if (!base.success) {
        error(source, id, `manifest: ${formatZodError(base.error)}`)
        continue
      }
      // Shallow merge (spec §4); an overridden context is written in the project, so it resolves there.
      const data = { ...base.data, ...override.data }
      const contextRoot = "context" in override.data ? project : repoRoot
      await add({ data, source: checkout.label, contextRoot }, source)
    }
  }

  const rules = uniqueRules(
    compiled,
    diagnostics,
    (id) => `rule "${id}" is configured more than once: give one an alias`,
  )
  return { root, config, rules, diagnostics }
}

/** A manifest on its own (validate, the init catalog): references resolve against `dir`. */
export async function compileManifest(
  dir: string,
  registry: DetectorRegistry,
): Promise<{ rules: CompiledRule[]; diagnostics: Diagnostic[] }> {
  const manifest = await readManifest(dir)
  if (!manifest.ok) {
    return {
      rules: [],
      diagnostics: [{ source: MANIFEST_FILE, rule: null, message: manifest.message, level: "error" }],
    }
  }
  const diagnostics: Diagnostic[] = []
  const compiled: Compiled[] = []
  const context: RuleContext = { config: defaultConfig(), registry, global: () => true, read: createReader() }
  for (const raw of manifest.value) {
    const rule = ruleSchema.safeParse(raw)
    if (!rule.success) {
      diagnostics.push({ source: MANIFEST_FILE, rule: idOf(raw), message: formatZodError(rule.error), level: "error" })
      continue
    }
    const result = await compileRule({ data: rule.data, source: "local", contextRoot: { dir, label: null } }, context)
    if (typeof result === "string") {
      diagnostics.push({
        source: MANIFEST_FILE,
        rule: rule.data.alias ?? rule.data.id,
        message: result,
        level: "error",
      })
    } else compiled.push({ rule: result, source: MANIFEST_FILE })
  }
  const rules = uniqueRules(compiled, diagnostics, (id) => `rule "${id}" is defined more than once`)
  return { rules, diagnostics }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/repos/provider.test.ts test/core/compile/project.test.ts`
Expected: PASS (3 + 19 tests). The exact zod texts (`name: Required`, `(root): Unrecognized key(s) in object: 'colour'`, `(root): Expected object, received string`) come from zod 3 and `formatZodError`; the id message comes from `RULE_ID`'s message in `src/core/config/schema.ts` (Task 4). If Task 4 worded it differently, update that one expectation to Task 4's wording rather than changing the schema.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/rulecast/src/core/repos/provider.ts packages/rulecast/src/core/compile/rule.ts packages/rulecast/src/core/compile/project.ts packages/rulecast/test/core/repos/provider.test.ts packages/rulecast/test/core/compile/project.test.ts
git commit -m "feat: compile .rulecast-config.yaml and pinned rule repos

Claude goes brr.. via Dash"
```

---

### Task 10: Switch to the new config format

**Files:**
- Create: `test/helpers/config.ts`, `test/helpers/pipeline.ts`
- Modify: `src/core/detection/select.ts`, `src/core/pipeline.ts`, `src/core/detection/warm.ts:3`, `src/core/session/decide.ts:1`, `src/core/detection/run.ts:1`, `src/core/types.ts:6`, `src/commands/project.ts`, `src/commands/hook.ts`, `src/commands/check.ts`, `src/commands/validate.ts`, `src/commands/warm.ts`, `src/commands/init.ts`, `src/adapters/claude-code/adapter.ts:11-12`, `src/index.ts`, `package.json` (dependencies)
- Delete: `src/core/compile/compile.ts`, `src/core/compile/config.ts`, `src/core/compile/rules.ts`, `test/core/compile/compile.test.ts`, `test/core/compile/config.test.ts`, `test/core/compile/rules.test.ts`
- Test (migrated): `test/helpers/fixture.ts`, `test/helpers/rules.ts`, `test/core/detection/select.test.ts`, `test/core/detection/run.test.ts`, `test/core/session/decide-references.test.ts`, `test/core/detection/warm.test.ts`, `test/core/pipeline-cli.test.ts`, `test/core/pipeline-deadline.test.ts`, `test/core/pipeline-session.test.ts`, `test/commands/hook.test.ts`, `test/commands/project.test.ts`, `test/commands/warm.test.ts`, `test/commands/init.test.ts`, `test/commands/main.test.ts`, `test/build.test.ts`, `test/perf/edit-hook.test.ts`

This task is one atomic switch: the on-disk format changes, so every fixture changes with it. The steps migrate the tests first (they fail), then the code.

Before starting, list what still uses the old format, so nothing is missed:

Run: `grep -rln "\.rulecast/\|compile/compile\|compile/config\|compile/rules\|selectViolationRules\|on: \[\|events: \[\"edit\"" packages/rulecast/src packages/rulecast/test`
Expected: only files named in the **Files** list above (the list also has files this grep cannot see, such as `test/core/pipeline-session.test.ts` and `test/build.test.ts`). Anything else it finds must be migrated the same way.

- [ ] **Step 1: New-format test helpers**

`test/helpers/config.ts`:
```ts
import { stringify } from "yaml"

/** A .rulecast-config.yaml with one local repo holding `rules`, plus top-level `settings` (snake_case). */
export function localConfig(rules: Record<string, unknown>[], settings: Record<string, unknown> = {}): string {
  return stringify({ ...settings, repos: [{ repo: "local", rules }] })
}
```

Replace `test/helpers/fixture.ts` with (same three rules, same ids, same conventions file, now in `.rulecast-config.yaml` with regex `files`; `fixtureRules` is exported so tests can extend the config):
```ts
import { type CompiledProject, compile } from "../../src/core/compile/project"
import { createRegistry } from "../../src/core/detection/registry"
import { cachedRepos } from "../../src/core/repos/provider"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "./config"
import { createRepo } from "./git"
import { TEST_HOME } from "./home"

export const registry = createRegistry([...builtinDetectors])

export const backendConventions = [
  "# Backend",
  "## Services",
  "Business logic lives in services.",
  "## Errors",
  "Services raise domain exceptions.",
  "",
].join("\n")

export const fixtureRules: Record<string, unknown>[] = [
  {
    id: "backend/no-httpexception",
    name: "No HTTPException in services",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "raise HTTPException\\((?<args>[^)]*)\\)" } },
    message: "{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.",
    context: ["@conventions/backend.md#errors"],
  },
  {
    id: "backend/services",
    name: "Service conventions",
    files: "^app/services/.*\\.py$",
    stages: ["touch"],
    context: ["@conventions/backend.md#services"],
  },
  {
    id: "frontend/no-generated-edits",
    name: "Generated client",
    files: "^src/client/",
    severity: "warning",
    detect: { path: {} },
    message: "{{file}} is generated. Regenerate it instead of editing.",
  },
]

export const fixtureFiles: Record<string, string> = {
  ".rulecast-config.yaml": localConfig(fixtureRules),
  "conventions/backend.md": backendConventions,
  "app/services/users.py": "def get():\n    raise HTTPException(404)\n",
  "src/client/api.ts": "export const api = 1\n",
}

/** A committed git repository containing the fixture project. */
export function createFixture(): Promise<string> {
  return createRepo(fixtureFiles)
}

/** Compiles a project the way hooks do: rule repos only from the test cache. */
export function compileAt(root: string): Promise<CompiledProject> {
  return compile({ root, registry, repos: cachedRepos(TEST_HOME) })
}
```

`test/helpers/pipeline.ts`:
```ts
import { compile } from "../../src/core/compile/project"
import type { DetectorRegistry } from "../../src/core/detection/registry"
import { type PipelineOptions, type PipelineResult, runPipeline } from "../../src/core/pipeline"
import { cachedRepos } from "../../src/core/repos/provider"
import type { Event } from "../../src/core/types"
import { registry as fixtureRegistry } from "./fixture"
import { stateDirFor, TEST_HOME } from "./home"

/** Compiles the project at `root` and runs one event through the pipeline with the test cache home. */
export async function pipelineAt(
  root: string,
  event: Event,
  options: Partial<Omit<PipelineOptions, "project" | "stateDir" | "event">> = {},
): Promise<PipelineResult> {
  const registry: DetectorRegistry = options.registry ?? fixtureRegistry
  const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
  return runPipeline({ maxContextChars: null, ...options, registry, project, stateDir: stateDirFor(root), event })
}
```

Replace `test/helpers/rules.ts` with (`files` is a regex now, default `""`; `stages` replaces `on`; detectors no longer carry `events`):
```ts
import type { CompiledRule } from "../../src/core/compile/rule"

/** Builds a CompiledRule for tests without going through compile(). `files` is a regex, searched like compile's. */
export function rule(overrides: Partial<Omit<CompiledRule, "matches">> & { id: string; files?: string }): CompiledRule {
  const { files = "", ...rest } = overrides
  const include = new RegExp(files)
  return {
    name: overrides.id,
    description: null,
    source: "local",
    severity: "error",
    stages: ["edit", "verify"],
    detector: { kind: "regex", config: { pattern: "x", flags: "" }, captures: [] },
    message: "{{file}}:{{line}}",
    context: [],
    matches: (file) => include.test(file),
    ...rest,
  }
}
```

- [ ] **Step 2: Migrate the unit tests**

Replace `test/core/detection/select.test.ts` with:
```ts
import { describe, expect, test } from "vitest"

import { selectDetectorRules, selectTouchRules } from "../../../src/core/detection/select"
import { rule } from "../../helpers/rules"

const tsx = rule({ id: "tsx", files: "^src/.*\\.tsx$" })
const verifyOnly = rule({ id: "verify-only", files: "^src/.*\\.tsx$", stages: ["verify"] })
const touchOnly = rule({ id: "touch-only", files: "^src/", stages: ["touch"], detector: null, message: null })
const both = rule({ id: "both", files: "^backend/", stages: ["touch", "edit", "verify"] })

describe("selectDetectorRules", () => {
  test("keeps rules whose stages include the event, with their matching files", () => {
    const files = ["src/a.tsx", "src/b.ts", "backend/x.py"]
    expect(selectDetectorRules([tsx, verifyOnly, touchOnly, both], "edit", files, new Set())).toEqual([
      { rule: tsx, files: ["src/a.tsx"] },
      { rule: both, files: ["backend/x.py"] },
    ])
    expect(selectDetectorRules([tsx, verifyOnly], "verify", files, new Set(["tsx"]))).toEqual([
      { rule: verifyOnly, files: ["src/a.tsx"] },
    ])
  })

  test("drops rules with no matching files", () => {
    expect(selectDetectorRules([tsx], "edit", ["README.md"], new Set())).toEqual([])
  })
})

describe("selectTouchRules", () => {
  test("keeps touch rules matching a file that have not fired and are not disabled", () => {
    expect(selectTouchRules([tsx, touchOnly, both], ["src/a.tsx"], new Set(), new Set())).toEqual([touchOnly])
    expect(
      selectTouchRules([touchOnly, both], ["src/a.tsx", "backend/x.py"], new Set(["touch-only"]), new Set()),
    ).toEqual([both])
    expect(selectTouchRules([touchOnly], ["src/a.tsx"], new Set(), new Set(["touch-only"]))).toEqual([])
  })
})
```

In `test/core/detection/run.test.ts`, replace:
```ts
  rule({ id, detector: { kind, config: { id }, captures, events: ["edit", "verify"] } })
```
with:
```ts
  rule({ id, detector: { kind, config: { id }, captures } })
```

In `test/core/session/decide-references.test.ts` (test "a complete read by the agent covers later references to that file"), replace:
```ts
            on: ["touch"],
```
with:
```ts
            stages: ["touch"],
```

Replace `test/core/detection/warm.test.ts` with:
```ts
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/project"
import { createRegistry } from "../../../src/core/detection/registry"
import { warmableKinds, warmDetectors } from "../../../src/core/detection/warm"
import { cachedRepos } from "../../../src/core/repos/provider"
import type { Detector, DetectorWarm } from "../../../src/core/types"
import { builtinDetectors } from "../../../src/detectors"
import { localConfig } from "../../helpers/config"
import { stateDirFor, TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

const schema = z.object({ size: z.number() }).strict()
type Config = z.infer<typeof schema>

function warmy(calls: DetectorWarm<Config>[], fail: boolean): Detector<Config> {
  return {
    kind: "warmy",
    schema,
    captures: () => [],
    events: () => ["verify"],
    run: async () => ({ findings: [], errors: [] }),
    warm: async (input) => {
      calls.push(input)
      if (fail) throw new Error("model build failed")
    },
  }
}

async function setup(fail = false) {
  const calls: DetectorWarm<Config>[] = []
  const registry = createRegistry([...builtinDetectors, warmy(calls, fail)])
  const root = await createProject({
    ".rulecast-config.yaml": localConfig([
      { id: "warm/a", name: "Warm", files: "\\.ts$", detect: { warmy: { size: 2 } }, message: "m" },
      { id: "plain/b", name: "Plain", files: "\\.ts$", detect: { regex: { pattern: "x" } }, message: "m" },
    ]),
  })
  const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
  expect(project.diagnostics).toEqual([])
  const stateDir = stateDirFor(root)
  const warm = (kinds: string[] | null = null) =>
    warmDetectors({ root, stateDir, project, registry, kinds, timeoutMs: 5000 })
  return { root, stateDir, project, registry, calls, warm }
}

describe("detector warm-up", () => {
  test("warmable kinds are the project's detector kinds that have warm-up work", async () => {
    const { project, registry } = await setup()
    expect(warmableKinds(project, registry)).toEqual(["warmy"])
  })

  test("warms each kind once with all of its rules", async () => {
    const { root, calls, warm } = await setup()
    expect(await warm()).toEqual({ warmed: ["warmy"], skipped: [], errors: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules).toEqual([{ id: "warm/a", config: { size: 2 } }])
    expect(calls[0]!.cwd).toBe(root)
  })

  test("only the requested kinds are warmed", async () => {
    const { calls, warm } = await setup()
    expect(await warm(["regex"])).toEqual({ warmed: [], skipped: [], errors: [] })
    expect(calls).toEqual([])
  })

  test("a kind already warming elsewhere is skipped", async () => {
    const { stateDir, calls, warm } = await setup()
    await mkdir(path.join(stateDir, "warm/warmy/.lock"), { recursive: true })
    expect(await warm()).toEqual({ warmed: [], skipped: ["warmy"], errors: [] })
    expect(calls).toEqual([])
  })

  test("a failing warm-up is reported and releases its lock", async () => {
    const { stateDir, warm } = await setup(true)
    expect(await warm()).toEqual({
      warmed: [],
      skipped: [],
      errors: [{ kind: "warmy", message: "model build failed" }],
    })
    expect(existsSync(path.join(stateDir, "warm/warmy/.lock"))).toBe(false)
  })
})
```

- [ ] **Step 3: Migrate the pipeline tests**

Replace `test/core/pipeline-cli.test.ts` with (the diagnostics test now edits the config, and a new test covers a pinned repo missing from the cache):
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { git } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"

describe("pipeline without a session", () => {
  test("verify on explicit files: everything is new, references are full, no stop decision", async () => {
    const root = await createFixture()
    const { delivery, failed } = await pipelineAt(root, {
      kind: "verify",
      files: [USERS, "src/client/api.ts", "README.md"],
      cwd: root,
    })
    expect(failed).toBe(false)
    expect(delivery.stop).toBeNull()
    expect(delivery.findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ["backend/no-httpexception", "error", 2],
      ["frontend/no-generated-edits", "warning", 1],
    ])
    expect(delivery.references.map((reference) => [reference.ref, reference.state])).toEqual([
      ["conventions/backend.md#errors", "full"],
    ])
  })

  test("verify with a base ref classifies against the merge base", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const { delivery } = await pipelineAt(root, { kind: "verify", files: [USERS], baseRef: "main", cwd: root })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
  })

  test("skipped detector kinds do not run", async () => {
    const root = await createFixture()
    const { delivery } = await pipelineAt(
      root,
      { kind: "verify", files: [USERS], cwd: root },
      { skipDetectorKinds: new Set(["regex"]) },
    )
    expect(delivery.findings).toEqual([])
  })

  test("compile errors are warnings and mark the run failed; compile warnings are not", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([...fixtureRules, { id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    )
    const { delivery, failed } = await pipelineAt(root, { kind: "verify", files: [USERS], cwd: root })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual([
      '.rulecast-config.yaml (broken): unknown detector "nope" (run rulecast validate)',
    ])
    expect(delivery.findings).toHaveLength(1)
  })

  test("a rule repo missing from the cache names rulecast install", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      stringify({
        repos: [
          { repo: "local", rules: fixtureRules },
          { repo: "https://example.com/acme/rules", rev: "v1.0.0", rules: [{ id: "x" }] },
        ],
      }),
    )
    const { delivery, failed } = await pipelineAt(root, { kind: "verify", files: [USERS], cwd: root })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual([
      "https://example.com/acme/rules@v1.0.0: not in the cache (run rulecast install)",
    ])
    expect(delivery.findings).toHaveLength(1)
  })
})
```

Replace `test/core/pipeline-deadline.test.ts` with:
```ts
import { expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

const schema = z.object({}).strict()

/** Never finishes, so it always misses the deadline. */
const slowDetector: Detector<z.infer<typeof schema>> = {
  kind: "slow",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: () => new Promise(() => {}),
}

test("an edit names the detector kinds whose results were dropped at the deadline", async () => {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig(
      [{ id: "slow/rule", name: "Slow", files: "^app/.*\\.py$", detect: { slow: {} }, message: "m" }],
      { timeouts: { edit_deadline_ms: 20 } },
    ),
    "app/a.py": "x = 1\n",
  })
  const result = await pipelineAt(
    root,
    { kind: "edit", files: ["app/a.py"], cwd: root, session: { id: "s1" } },
    { registry: createRegistry([...builtinDetectors, slowDetector]) },
  )
  expect(result.deadlineMissed).toEqual(["slow"])
  expect(result.failed).toBe(false)
})
```

Replace `test/core/pipeline-session.test.ts` with (only the imports and `scenario()` change: `pipelineAt` compiles and supplies the state directory):
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { Event } from "../../src/core/types"
import { createFixture } from "../helpers/fixture"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"

async function scenario() {
  const root = await createFixture()
  const send = async (event: Omit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const result = await pipelineAt(root, { ...rest, cwd: root, session: { id: "s1", agentId } })
    return result.delivery
  }
  const write = (content: string) => writeFile(path.join(root, USERS), content)
  return { root, send, write }
}

const refStates = (delivery: { references: { ref: string; state: string }[] }) =>
  delivery.references.map((reference) => `${reference.ref}:${reference.state}`)

describe("pipeline with a session", () => {
  test("touch delivers touch conventions once per context", async () => {
    const { send } = await scenario()
    const first = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(first.touches).toEqual(["backend/services"])
    expect(first.references).toEqual([
      {
        ref: "conventions/backend.md#services",
        state: "full",
        content: "## Services\nBusiness logic lives in services.",
      },
    ])
    const second = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(second.touches).toEqual([])
    expect(second.references).toEqual([])
  })

  test("edit reports new findings, summarises pre-existing ones and dedupes references", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")

    const first = await send({ kind: "edit", files: [USERS] })
    expect(first.findings.map((finding) => [finding.line, finding.message])).toEqual([
      [3, "app/services/users.py:3 raises HTTPException(500). Raise a domain exception."],
    ])
    expect(first.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
    expect(refStates(first)).toEqual(["conventions/backend.md#errors:full"])

    const second = await send({ kind: "edit", files: [USERS] })
    expect(second.findings).toHaveLength(1)
    expect(second.preexistingSummary).toEqual([])
    expect(refStates(second)).toEqual(["conventions/backend.md#errors:pointer"])
  })

  test("stop gate blocks up to the cap per prompt and allows once fixed", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })

    const stops = []
    for (let i = 0; i < 3; i++) stops.push((await send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "capReached", "capReached"])

    await send({ kind: "prompt", files: [] })
    expect((await send({ kind: "verify", files: [] })).stop).toBe("block")

    await write("def get():\n    raise HTTPException(404)\n    raise NotFound()\n")
    const fixed = await send({ kind: "verify", files: [] })
    expect(fixed.stop).toBe("allow")
    expect(fixed.findings).toEqual([])
  })

  test("reset clears delivered references; subagents have their own context", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual(["conventions/backend.md#errors:pointer"])

    // A subagent has seen nothing: the touch convention and the errors section both arrive in full.
    expect(refStates(await send({ kind: "edit", files: [USERS], agentId: "sub1" }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])

    await send({ kind: "reset", files: [] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])
  })

  test("edits of files never read fall back to the session-start commit", async () => {
    const { send, write } = await scenario()
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const delivery = await send({ kind: "edit", files: [USERS] })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.touches).toEqual(["backend/services"])
  })
})
```

- [ ] **Step 4: Migrate the command tests**

Replace `test/commands/project.test.ts` with:
```ts
import path from "node:path"
import { describe, expect, test } from "vitest"

import { findRoot, hasProject, toProjectPath } from "../../src/commands/project"
import { createProject } from "../helpers/project"

describe("project paths", () => {
  test("findRoot walks up to the nearest directory containing .rulecast-config.yaml", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\n", "app/deep/x.py": "" })
    expect(findRoot(path.join(root, "app/deep"))).toBe(root)
    const bare = await createProject({ "x.py": "" })
    expect(findRoot(bare)).toBe(bare)
  })

  test("hasProject is true only where .rulecast-config.yaml exists", async () => {
    expect(hasProject(await createProject({ ".rulecast-config.yaml": "repos: []\n" }))).toBe(true)
    expect(hasProject(await createProject({ ".rulecast/config.yml": "" }))).toBe(false)
    expect(hasProject(await createProject({ "x.py": "" }))).toBe(false)
  })

  test("toProjectPath makes paths repo-relative and rejects paths outside the root", () => {
    expect(toProjectPath("/repo", "/repo/src", "a.ts")).toBe("src/a.ts")
    expect(toProjectPath("/repo", "/anywhere", "/repo/app/x.py")).toBe("app/x.py")
    expect(toProjectPath("/repo", "/repo", "..config/x")).toBe("..config/x")
    expect(toProjectPath("/repo", "/repo", "/elsewhere/x.py")).toBeNull()
    expect(toProjectPath("/repo", "/repo/src", "../..")).toBeNull()
    expect(toProjectPath("/repo", "/repo", "/repo")).toBeNull()
  })
})
```

Replace `test/commands/warm.test.ts` with:
```ts
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"

describe("rulecast warm", () => {
  test("with no detector warm-up work there is nothing to warm", async () => {
    const root = await createFixture()
    expect(await runCli(root, ["warm"])).toMatchObject({ code: 0, stdout: "rulecast: nothing to warm\n" })
  })

  test("outside a rulecast project it fails", async () => {
    const result = await runCli(await createProject({}), ["warm"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast-config.yaml")
  })
})
```

Replace `test/commands/hook.test.ts` with (the state assertions are Task 6's: the project's state directory in the test cache home has a `root` file, and nothing is created outside a project):
```ts
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { hookCommand } from "../../src/commands/hook"
import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { captureIo, runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const additionalContext = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext

describe("rulecast hook claude-code", () => {
  test("a read delivers the conventions for the file", async () => {
    const root = await createFixture()
    const result = await hook(root, "post-tool-use.read.complete", USERS)
    expect(result.code).toBe(0)
    expect(additionalContext(result.stdout)).toContain("--- conventions/backend.md#services ---")
    expect(readFileSync(path.join(stateDirFor(root), "root"), "utf8")).toBe(`${realpathSync(root)}\n`)
  })

  test("an edit reports the new violation and Stop blocks on it", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    await writeFile(path.join(root, USERS), VIOLATION)
    expect(additionalContext((await hook(root, "post-tool-use.edit", USERS)).stdout)).toContain(
      "raises HTTPException(500)",
    )
    const stop = JSON.parse((await hook(root, "stop")).stdout)
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain("raises HTTPException(500)")
  })

  test("the compaction summariser's SubagentStop is not verified", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), VIOLATION)
    await hook(root, "post-tool-use.edit", USERS)
    expect(await hook(root, "subagent-stop.compaction")).toMatchObject({ code: 0, stdout: "" })
  })

  test("outside a rulecast project the hook does nothing and creates no state", async () => {
    const root = await createProject({ [USERS]: VIOLATION })
    expect(await hook(root, "post-tool-use.edit", USERS)).toMatchObject({ code: 0, stdout: "", stderr: "" })
    expect(existsSync(stateDirFor(root))).toBe(false)
  })

  test("files outside the project are ignored", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("post-tool-use.edit", { root, sessionId: "s1" })
    payload.tool_input = { file_path: "/elsewhere/app/services/users.py" }
    expect(await runCli(root, ["hook", "claude-code"], JSON.stringify(payload))).toMatchObject({ code: 0, stdout: "" })
  })

  test("bad input and unknown adapters fail open", async () => {
    const root = await createFixture()
    const garbage = await runCli(root, ["hook", "claude-code"], "not json")
    expect(garbage.code).toBe(0)
    expect(garbage.stderr).toContain("could not read hook input")
    const unknown = await runCli(root, ["hook", "cursor"], "{}")
    expect(unknown.code).toBe(0)
    expect(unknown.stderr).toContain('unknown hook adapter "cursor"')
  })
})

describe("rulecast hook warm-up", () => {
  const schema = z.object({}).strict()
  /** Never finishes a run, and has warm-up work. */
  const slow: Detector<z.infer<typeof schema>> = {
    kind: "slow",
    schema,
    captures: () => [],
    events: () => ["edit", "verify"],
    run: () => new Promise(() => {}),
    warm: async () => {},
  }
  const registry = createRegistry([...builtinDetectors, slow])
  const slowProject = () =>
    createRepo({
      ...fixtureFiles,
      ".rulecast-config.yaml": localConfig(
        [
          ...fixtureRules,
          { id: "slow/rule", name: "Slow", files: "^app/.*\\.py$", detect: { slow: {} }, message: "m" },
        ],
        { timeouts: { edit_deadline_ms: 20 } },
      ),
    })

  async function run(root: string, name: string, withRegistry = registry, file?: string) {
    const { io, output } = captureIo(root, JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })))
    expect(await hookCommand(["claude-code"], withRegistry, io)).toBe(0)
    return output
  }

  test("session start warms detectors that have warm-up work", async () => {
    const root = await slowProject()
    expect((await run(root, "session-start.startup")).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("a detector that missed the edit deadline is warmed in the background", async () => {
    const root = await slowProject()
    expect((await run(root, "post-tool-use.edit", registry, USERS)).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("without warm-up work nothing is started", async () => {
    const root = await createFixture()
    expect((await run(root, "session-start.startup", createRegistry([...builtinDetectors]))).warmed).toEqual([])
  })
})
```

Replace `test/commands/init.test.ts` with (interim `init`: an empty local repo plus the Claude Code hooks; Task 12 updates its `validate` line and Task 13 adds one test):
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { parseConfig, readConfigData } from "../../src/core/config/load"
import { defaultConfig } from "../../src/core/config/schema"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

describe("rulecast init", () => {
  test("writes a config with an empty local repo and installs the hooks", async () => {
    const root = await createProject({})
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("created  .rulecast-config.yaml")
    expect(result.stdout).toContain("installed Claude Code hooks in .claude/settings.json")
    expect(result.stdout).toContain("next: add rules to .rulecast-config.yaml, then run rulecast validate")
    expect(await runCli(root, ["validate"])).toMatchObject({ code: 0, stdout: "rulecast: 0 rules valid\n" })
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
    ])
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "rulecast hook claude-code",
      timeout: 70,
    })
  })

  test("the written config holds an empty local repo and default settings", async () => {
    const root = await createProject({})
    await runCli(root, ["init"])
    const data = await readConfigData(root)
    expect(data.ok && parseConfig(data.value)).toEqual({
      ok: true,
      value: { ...defaultConfig(), repos: [{ repo: "local", rules: [] }] },
    })
  })

  test("keeps existing files and settings, and a second run changes nothing", async () => {
    const dash = { type: "command", command: "dash-hook stop" }
    const config = "repos: []\ntimeouts:\n  verify_ms: 20000\n"
    const root = await createProject({
      ".rulecast-config.yaml": config,
      ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [dash] }] } }),
    })
    const first = await runCli(root, ["init"])
    expect(first.stdout).toContain("exists   .rulecast-config.yaml")
    expect(await read(root, ".rulecast-config.yaml")).toBe(config)
    const installed = await read(root, ".claude/settings.json")
    expect(JSON.parse(installed).hooks.Stop).toEqual([
      { hooks: [dash] },
      { hooks: [{ type: "command", command: "rulecast hook claude-code", timeout: 30 }] },
    ])

    const second = await runCli(root, ["init"])
    expect(second.stdout).toContain("Claude Code hooks already installed in .claude/settings.json")
    expect(await read(root, ".claude/settings.json")).toBe(installed)
  })

  test("an invalid config is reported and nothing is installed", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\nmaxMatchesPerRule: 3\n" })
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".rulecast-config.yaml: ")
    expect(result.stderr).toContain("(fix it, then run rulecast init again)")
  })

  test("uses the project's own rulecast when it is installed", async () => {
    const root = await createProject({ "node_modules/.bin/rulecast": "" })
    await runCli(root, ["init"])
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code',
    )
  })

  test("leaves unparseable settings alone", async () => {
    const root = await createProject({ ".claude/settings.json": "{ nope" })
    const result = await runCli(root, ["init"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".claude/settings.json:")
    expect(await read(root, ".claude/settings.json")).toBe("{ nope")
  })
})
```

Replace `test/commands/main.test.ts` with:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { git } from "../helpers/git"

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

  test("check without arguments checks every file matched by a rule", async () => {
    const root = await createFixture()
    const result = await run(root, "check")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("app/services/users.py:2:5  error    backend/no-httpexception")
    expect(result.stdout).toContain("src/client/api.ts:1:1  warning  frontend/no-generated-edits")
    expect(result.stdout.trimEnd().endsWith("1 error, 1 warning")).toBe(true)
  })

  test("check with files resolves them relative to cwd", async () => {
    const root = await createFixture()
    const result = await run(path.join(root, "src"), "check", "client/api.ts", "--format", "json")
    // cwd is a subdirectory, but the project root is found by walking up to .rulecast-config.yaml.
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "frontend/no-generated-edits",
    ])
  })

  test("check --base only checks changed files and only new findings count", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    expect((await run(root, "check", "--base", "main")).stdout.trim()).toBe("no findings")
    await writeFile(path.join(root, "app/services/users.py"), "def get():\n    raise HTTPException(404)\n    x = 1\n")
    const result = await run(root, "check", "--base", "main")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("pre-existing (not blocking): backend/no-httpexception ×1 in app/services/users.py")
  })

  test("usage errors exit 2", async () => {
    const root = await createFixture()
    expect((await run(root, "frobnicate")).code).toBe(2)
    expect((await run(root, "check", "--format", "xml")).stderr).toContain('unknown format "xml"')
    expect((await run(root, "check", "--base", "nope")).stderr).toContain("cannot find merge base with nope")
  })
})
```

- [ ] **Step 5: Migrate the built-CLI and perf tests**

Replace `test/build.test.ts` with (spawned CLIs get the test cache home through `RULECAST_HOME`, as Task 6 set up):
```ts
import { execFile, spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createFixture } from "./helpers/fixture"
import { TEST_HOME } from "./helpers/home"
import { claudeCodePayload } from "./helpers/payloads"

const exec = promisify(execFile)
const cli = path.resolve("dist/cli.js")
const env = { ...process.env, RULECAST_HOME: TEST_HOME }

beforeAll(async () => {
  await exec("pnpm", ["build"])
}, 60_000)

test("built CLI runs check in a project", async () => {
  const root = await createFixture()
  const failure = await exec("node", [cli, "check", "--format", "agent"], { cwd: root, env }).catch((error) => error)
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("rulecast: 2 rules violated")
  expect(failure.stdout).toContain("--- conventions/backend.md#errors ---")
}, 30_000)

test("built CLI answers a Claude Code edit hook", async () => {
  const root = await createFixture()
  await writeFile(
    path.join(root, "app/services/users.py"),
    "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n",
  )
  const payload = claudeCodePayload("post-tool-use.edit", { root, file: "app/services/users.py", sessionId: "s1" })
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain("raises HTTPException(500)")
}, 30_000)
```

Replace `test/perf/edit-hook.test.ts` with (the same 25 regex and 5 path rules, now in `.rulecast-config.yaml`):
```ts
import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"

const cli = path.resolve("dist/cli.js")
const FILE = "src/feature/orders.ts"
const RULES = 25

/** 25 regex rules and 5 path rules. Plan 5 adds ast-grep, ruff and command rules (spec §13). */
function perfProject(): Record<string, string> {
  const topics = Array.from({ length: RULES }, (_, i) => `## Topic ${i}\n\nGuidance for topic ${i}.\n`)
  const rules: Record<string, unknown>[] = []
  for (let i = 0; i < RULES; i++) {
    rules.push({
      id: `perf/regex-${i}`,
      name: `Regex ${i}`,
      files: "^src/.*\\.ts$",
      detect: { regex: { pattern: `forbidden${i}\\((?<arg>[^)]*)\\)` } },
      message: `{{file}}:{{line}} calls forbidden${i}({{arg}}).`,
      context: [`@conventions/code.md#topic-${i}`],
    })
  }
  for (let i = 0; i < 5; i++) {
    rules.push({
      id: `perf/path-${i}`,
      name: `Path ${i}`,
      files: "^generated/",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
    })
  }
  return {
    ".rulecast-config.yaml": localConfig(rules),
    "conventions/code.md": ["# Code", "", ...topics].join("\n"),
    [FILE]: `${Array.from({ length: 300 }, (_, i) => `export const value${i} = compute(${i})`).join("\n")}\n`,
    "generated/client.ts": "export const client = 1\n",
  }
}

/** Wall time from process start to exit, as Claude Code experiences it. */
function runHook(root: string, payload: unknown): { ms: number; stdout: string } {
  const started = performance.now()
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env: { ...process.env, RULECAST_HOME: TEST_HOME },
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  const ms = performance.now() - started
  if (result.status !== 0) throw new Error(`hook exited ${result.status}: ${result.stderr}`)
  return { ms, stdout: result.stdout }
}

describe.runIf(process.env.RULECAST_PERF === "1")("edit hook performance", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["build"])
  }, 60_000)

  test("p95 of 50 edit events stays under 500 ms", async () => {
    const root = await createRepo(perfProject())
    const payload = (name: string) => claudeCodePayload(name, { root, file: FILE, sessionId: "perf" })
    runHook(root, payload("post-tool-use.read.complete"))
    for (let i = 0; i < 3; i++) runHook(root, payload("post-tool-use.edit"))

    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      appendFileSync(path.join(root, FILE), `export const added${i} = forbidden${i % RULES}(${i})\n`)
      const { ms, stdout } = runHook(root, payload("post-tool-use.edit"))
      expect(stdout).toContain(`forbidden${i % RULES}(${i})`)
      times.push(ms)
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.ceil(times.length * 0.5) - 1]!
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!
    console.log(`edit hook: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`)
    expect(p95).toBeLessThan(500)
  }, 120_000)
})
```

- [ ] **Step 6: Run the migrated tests to verify they fail**

Run: `pnpm vitest run test/core/detection/select.test.ts test/commands/project.test.ts test/core/pipeline-cli.test.ts test/commands/main.test.ts`
Expected: FAIL: `selectDetectorRules is not a function`, `findRoot` returns the bare directory instead of the project root, and the pipeline and CLI tests fail because `runPipeline` still compiles `.rulecast/` itself (for example `TypeError: Cannot destructure property 'root' of 'project'` or "3 rules valid" not found).

- [ ] **Step 7: Select rules by stages**

Replace `src/core/detection/select.ts` with:
```ts
import type { CompiledRule } from "../compile/rule"
import type { DetectorEvent } from "../types"

export interface Selection {
  rule: CompiledRule
  files: string[]
}

/** Rules whose detector runs on this event (their stages include it), with the files each applies to. */
export function selectDetectorRules(
  rules: readonly CompiledRule[],
  event: DetectorEvent,
  files: readonly string[],
  disabled: ReadonlySet<string>,
): Selection[] {
  return rules
    .filter((rule) => rule.detector !== null && rule.stages.includes(event) && !disabled.has(rule.id))
    .map((rule) => ({ rule, files: files.filter((file) => rule.matches(file)) }))
    .filter((selection) => selection.files.length > 0)
}

/** Rules with stage touch that apply to one of the files and have not fired in this agent context. */
export function selectTouchRules(
  rules: readonly CompiledRule[],
  files: readonly string[],
  touched: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
): CompiledRule[] {
  return rules.filter(
    (rule) =>
      rule.stages.includes("touch") &&
      !touched.has(rule.id) &&
      !disabled.has(rule.id) &&
      files.some((file) => rule.matches(file)),
  )
}
```

- [ ] **Step 8: The pipeline takes a compiled project**

Replace `src/core/pipeline.ts` with the file below. Compared with Task 6's version it drops the internal `compile` call and `PipelineResult.project`, takes `project`, turns only `level: "error"` diagnostics into warnings (naming the rule and the hint), and calls `selectDetectorRules`:
```ts
import { computeChanges, isNew } from "./baseline/baseline"
import { type Snapshot, snapshotOf } from "./baseline/hash"
import { appendBaseline, type BaselineState, readBaseline, snapshotRecord, startRecord } from "./baseline/store"
import type { CompiledProject } from "./compile/project"
import type { CompiledRule } from "./compile/rule"
import { createReferenceResolver } from "./delivery/resolve"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { readSourceFile } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectDetectorRules, selectTouchRules } from "./detection/select"
import { headCommit, mergeBase } from "./git"
import { type ClassifiedFinding, type DecideInput, decide } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { appendContext, appendWork, commitSession, openSession, type SessionView, sessionDir } from "./session/session"
import { emptyContext, emptyWork, type WorkRecord } from "./session/state"
import { type Delivery, type Event, emptyDelivery, type ResolvedReference } from "./types"

export interface PipelineOptions {
  /** Compiled by the caller: hooks never fetch rule repos, the CLI does (spec §4). */
  project: CompiledProject
  /** The project's directory in the cache (spec §12): sessions and detector caches. */
  stateDir: string
  event: Event
  registry: DetectorRegistry
  /** From the adapter; null = unlimited. */
  maxContextChars: number | null
  /** Detector kinds to skip entirely (check --no-llm). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Debug log sink. */
  log?: (line: string) => void
}

export interface PipelineResult {
  delivery: Delivery
  /** rulecast itself failed: compile diagnostics, detector errors or verify timeouts. */
  failed: boolean
  /** Detector kinds whose results were dropped at the edit deadline (§13). */
  deadlineMissed: string[]
}

type Warning = { key: string; text: string }

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { project, stateDir, event, registry } = options
  const { root, config } = project
  const log = options.log ?? (() => {})
  // Warnings (a branch-like rev) are for rulecast validate; only errors disable rules.
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const warnings: Warning[] = errors.map((diagnostic) => ({
    key: `diagnostic:${diagnostic.source}:${diagnostic.rule ?? ""}:${diagnostic.message}`,
    text: `${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message} (run ${diagnostic.hint ?? "rulecast validate"})`,
  }))
  let failed = errors.length > 0
  const deadlineMissed: string[] = []
  const session = event.session
    ? { dir: sessionDir(stateDir, event.session.id), agent: event.session.agentId ?? "main" }
    : null

  if (event.kind === "prompt" || event.kind === "reset") {
    if (session && event.kind === "prompt") await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    if (session && event.kind === "reset") await appendContext(session.dir, session.agent, [{ t: "reset" }])
    return { delivery: emptyDelivery(), failed, deadlineMissed }
  }

  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  if (session) {
    baseline = await readBaseline(session.dir)
    if (!baseline.started) {
      await appendBaseline(session.dir, [startRecord(await headCommit(root))])
      // Re-read: with concurrent first events, the first start record wins.
      baseline = await readBaseline(session.dir)
    }
  }

  const view: SessionView = session
    ? await openSession(session.dir, session.agent)
    : { work: emptyWork(), context: emptyContext() }
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  const workRecords: WorkRecord[] = []
  const relevant = (files: readonly string[]) =>
    files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let agentRead: string | null = null

  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
  }

  if (event.kind === "touch") {
    if (event.completeRead) agentRead = event.files[0] ?? null
    if (session) {
      const records = []
      for (const file of relevant(event.files)) {
        if (baseline.snapshots.has(file)) continue
        const text = await readSourceFile(root, file)
        if (text !== null) records.push(snapshotRecord(file, snapshotOf(text)))
      }
      await appendBaseline(session.dir, records)
    }
  }

  if (event.kind === "edit" || event.kind === "verify") {
    let files = relevant(event.files)
    let snapshots: ReadonlyMap<string, Snapshot> = session ? baseline.snapshots : new Map()
    let fallbackCommit = session ? baseline.startCommit : null

    if (event.kind === "edit" && session) {
      await appendWork(
        session.dir,
        files.map((file) => ({ t: "edited" as const, file })),
      )
    }
    if (event.kind === "verify") {
      if (event.baseRef) {
        fallbackCommit = await mergeBase(root, event.baseRef)
        snapshots = new Map()
      }
      if (event.files.length === 0 && session) files = relevant(view.work.edited)
    }

    const changes = await computeChanges(root, files, { snapshots, fallbackCommit })
    if (event.kind === "verify" && session && !event.baseRef) {
      // Files edited but back to their snapshot content have nothing new.
      files = files.filter((file) => changes.get(file)?.changedLines.length !== 0)
    }

    const skip = options.skipDetectorKinds ?? new Set<string>()
    const selections = selectDetectorRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector!.kind),
    )
    const output = await runDetection({
      root,
      event: event.kind,
      selections,
      changes,
      registry,
      cacheFor: (kind) => diskCache(detectorCacheDir(stateDir, kind)),
      contextFor: async (rule) => {
        const references: ResolvedReference[] = []
        for (const spec of rule.context) {
          const resolved = await resolver.resolve(spec)
          if (resolved.found) references.push({ ref: spec.ref, content: resolved.content })
        }
        return references
      },
      timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : config.timeouts.verifyMs,
    })

    findings = output.findings.map(({ rule, match }) => ({
      rule,
      match,
      status: isNew(match, changes) ? "new" : "preexisting",
    }))
    for (const error of output.errors) {
      failed = true
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
      warnings.push({
        key: `detector:${error.kind}:${error.rules.join(",")}:${error.message}`,
        text: `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. Disabled for this session.`,
      })
    }
    for (const timeout of output.timedOut) {
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
        deadlineMissed.push(timeout.kind)
      } else {
        failed = true
        warnings.push({
          key: `timeout:${timeout.kind}:${timeout.rules.join(",")}`,
          text: `${timeout.kind} detector timed out for ${timeout.rules.join(", ")}`,
        })
      }
    }
  }

  const inputFor = (state: SessionView): DecideInput => ({
    agent: session?.agent ?? "main",
    findings,
    touches: touches.filter((rule) => !state.context.touched.has(rule.id)),
    agentRead,
    warnings,
    work: state.work,
    context: state.context,
    resolver,
    maxBytes: config.context.maxBytes,
    maxBlocks: config.stopGate.maxBlocks,
    maxContextChars: options.maxContextChars,
    stopGate: event.kind === "verify" && session !== null,
  })

  if (!session) return { delivery: (await decide(inputFor(view))).delivery, failed, deadlineMissed }

  await appendWork(session.dir, workRecords)
  try {
    const delivery = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
    return { delivery, failed, deadlineMissed }
  } catch (error) {
    if (!(error instanceof LockTimeoutError)) throw error
    warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    const delivery = (await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false }))
      .delivery
    return { delivery, failed, deadlineMissed }
  }
}
```

- [ ] **Step 9: Point the remaining core imports at the new modules**

In `src/core/session/decide.ts` and `src/core/detection/run.ts`, replace:
```ts
import type { CompiledRule } from "../compile/compile"
```
with:
```ts
import type { CompiledRule } from "../compile/rule"
```

In `src/core/detection/warm.ts`, replace:
```ts
import type { CompiledProject } from "../compile/compile"
```
with:
```ts
import type { CompiledProject } from "../compile/project"
```

In `src/core/types.ts`, delete the line (the `on:` triggers are gone; `stages` replaced them):
```ts
export type Trigger = "touch" | "violation"
```

- [ ] **Step 10: Commands find and compile the new config**

Replace `src/commands/project.ts` with:
```ts
import { existsSync } from "node:fs"
import path from "node:path"

import { CONFIG_FILE } from "../core/config/load"

/** Nearest ancestor of cwd containing .rulecast-config.yaml, or cwd itself. */
export function findRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

export function hasProject(root: string): boolean {
  return existsSync(path.join(root, CONFIG_FILE))
}

/** A file as a repo-relative path with forward slashes, or null when it is not inside root. */
export function toProjectPath(root: string, cwd: string, file: string): string | null {
  const relative = path.relative(root, path.resolve(cwd, file))
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return relative.split(path.sep).join("/")
}
```

Replace `src/commands/hook.ts` with (hooks compile with `cachedRepos`: they never fetch):
```ts
import { claudeCodeAdapter } from "../adapters/claude-code/adapter"
import { compile } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmableKinds } from "../core/detection/warm"
import { errorMessage } from "../core/errors"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import { cachedRepos } from "../core/repos/provider"
import type { Adapter, Event } from "../core/types"
import type { CliIo } from "./main"
import { findRoot, hasProject, toProjectPath } from "./project"

const ADAPTERS: Readonly<Record<string, Adapter>> = { "claude-code": claudeCodeAdapter }

/** Hooks fail open (§14): every path exits 0; problems go to stderr and the debug log. */
export async function hookCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const name = args[0] ?? ""
  const adapter = ADAPTERS[name]
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${Object.keys(ADAPTERS).join(", ")})\n`)
    return 0
  }
  let input: unknown
  try {
    input = JSON.parse(await io.readStdin())
  } catch (error) {
    io.stderr(`rulecast: could not read hook input: ${errorMessage(error)}\n`)
    return 0
  }
  const parsed = adapter.parse(input)
  if (!parsed || (!parsed.event && !parsed.warmup)) return 0
  const root = findRoot(parsed.cwd)
  if (!hasProject(root)) return 0
  const home = cacheHome(io.env)
  const stateDir = ensureProjectState(home, root)
  const log = debugLogger(stateDir)
  try {
    // Hooks never fetch: a pinned repo missing from the cache disables its rules with a warning (spec §4).
    const compileProject = () => compile({ root, registry, repos: cachedRepos(home) })
    if (parsed.warmup) {
      const kinds = warmableKinds(await compileProject(), registry)
      if (kinds.length > 0) io.startWarm(root, kinds)
    }
    if (parsed.event) {
      await handleEvent({
        root,
        stateDir,
        cwd: parsed.cwd,
        event: parsed.event,
        adapter,
        registry,
        io,
        log,
        compileProject,
      })
    }
  } catch (error) {
    log(`hook ${adapter.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
  }
  return 0
}

interface EventContext {
  root: string
  stateDir: string
  cwd: string
  event: Event
  adapter: Adapter
  registry: DetectorRegistry
  io: CliIo
  log: (line: string) => void
  compileProject: () => ReturnType<typeof compile>
}

async function handleEvent(context: EventContext): Promise<void> {
  const { root, stateDir, cwd, event, adapter, registry, io, log } = context
  const files = event.files
    .map((file) => toProjectPath(root, cwd, file))
    .filter((file): file is string => file !== null)
  if ((event.kind === "touch" || event.kind === "edit") && files.length === 0) return
  const projectEvent: Event = { ...event, files, cwd: root }
  const project = await context.compileProject()
  const result = await runPipeline({
    project,
    stateDir,
    event: projectEvent,
    registry,
    maxContextChars: adapter.maxContextChars,
    log,
  })
  const output = adapter.format(result.delivery, projectEvent, { maxMatchesPerRule: project.config.maxMatchesPerRule })
  if (output.stdout !== "") io.stdout(output.stdout)
  const missed = result.deadlineMissed.filter((kind) => registry.get(kind)?.warm !== undefined)
  if (missed.length > 0) io.startWarm(root, missed)
}
```

Replace `src/commands/check.ts` with (compiles with `fetchingRepos`; otherwise unchanged until Task 11 replaces it):
```ts
import { parseArgs } from "node:util"
import { glob } from "tinyglobby"

import { CLI_FORMATS, type CliFormat, exitCodeFor, formatDelivery } from "../adapters/cli/format"
import { compile } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { changedFilesSince, mergeBase } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"

export class UsageError extends Error {}

export async function checkCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
    },
  })
  const format = values.format as CliFormat
  if (!CLI_FORMATS.includes(format))
    throw new UsageError(`unknown format "${values.format}" (use ${CLI_FORMATS.join(", ")})`)
  if (!hasProject(root)) throw new Error(`no .rulecast-config.yaml in ${io.cwd} or its parents`)

  let files: string[]
  if (positionals.length > 0) {
    files = positionals.map((file) => toProjectPath(root, io.cwd, file)).filter((file): file is string => file !== null)
  } else if (values.base) {
    files = await changedFilesSince(root, await mergeBase(root, values.base))
  } else {
    files = (await glob(["**/*"], { cwd: root, dot: true, ignore: ["**/node_modules/**", "**/.git/**"] })).sort()
  }

  const home = cacheHome(io.env)
  const project = await compile({ root, registry, repos: fetchingRepos(home) })
  const result = await runPipeline({
    project,
    stateDir: ensureProjectState(home, root),
    event: {
      kind: "verify",
      files,
      baseRef: values.base,
      session: values.session ? { id: values.session } : undefined,
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: values["no-llm"] ? new Set(["llm"]) : undefined,
  })
  const text = formatDelivery(result.delivery, format, { maxMatchesPerRule: project.config.maxMatchesPerRule })
  if (text) io.stdout(`${text}\n`)
  return exitCodeFor(result.delivery, result.failed)
}
```

Replace `src/commands/validate.ts` with (warnings are printed but do not fail; Task 12 adds file arguments):
```ts
import { compile, type Diagnostic } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"

const line = (diagnostic: Diagnostic) =>
  `${diagnostic.level === "warning" ? "warning: " : ""}${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}\n`

export async function validateCommand(root: string, registry: DetectorRegistry, io: CliIo): Promise<number> {
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  for (const diagnostic of project.diagnostics) io.stdout(line(diagnostic))
  if (project.diagnostics.some((diagnostic) => diagnostic.level === "error")) return 2
  io.stdout(`rulecast: ${project.rules.length} ${project.rules.length === 1 ? "rule" : "rules"} valid\n`)
  return 0
}
```

Replace `src/commands/warm.ts` with (the detached warm-up never fetches, like the hook that starts it):
```ts
import { parseArgs } from "node:util"

import { compile } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmDetectors } from "../core/detection/warm"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
import { cachedRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/** Warm-ups run detached and nobody waits for them; this only bounds a stuck one. */
const WARM_TIMEOUT_MS = 5 * 60_000

export async function warmCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({ args, options: { detector: { type: "string", multiple: true } } })
  if (!hasProject(root)) throw new Error(`no .rulecast-config.yaml in ${root} or its parents (run rulecast init)`)
  const home = cacheHome(io.env)
  const stateDir = ensureProjectState(home, root)
  const log = debugLogger(stateDir)
  const result = await warmDetectors({
    root,
    stateDir,
    // Hooks start warm-ups detached, so like hooks it never fetches rule repos.
    project: await compile({ root, registry, repos: cachedRepos(home) }),
    registry,
    kinds: values.detector ?? null,
    timeoutMs: WARM_TIMEOUT_MS,
  })
  if (result.warmed.length > 0) io.stdout(`rulecast: warmed ${result.warmed.join(", ")}\n`)
  if (result.skipped.length > 0) io.stdout(`rulecast: already warming ${result.skipped.join(", ")}\n`)
  for (const error of result.errors) {
    log(`warm ${error.kind} failed: ${error.message}`)
    io.stderr(`rulecast: warm ${error.kind} failed: ${error.message}\n`)
  }
  if (result.warmed.length + result.skipped.length + result.errors.length === 0) {
    io.stdout("rulecast: nothing to warm\n")
  }
  return result.errors.length > 0 ? 2 : 0
}
```

Replace `src/commands/init.ts` with:
```ts
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { mergeHooks } from "../adapters/claude-code/settings"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import { errorMessage, isNotFound } from "../core/errors"
import type { CliIo } from "./main"

const SETTINGS = ".claude/settings.json"

const SCAFFOLD = [
  "# rulecast config: https://github.com/syv-ai/rulecast",
  "# Add rules under repo: local, or select rules from a rule repo by repo and rev.",
  "repos:",
  "  - repo: local",
  "    rules: []",
  "",
].join("\n")

export async function initCommand(root: string, io: CliIo): Promise<number> {
  const configFile = path.join(root, CONFIG_FILE)
  if (existsSync(configFile)) {
    io.stdout(`exists   ${CONFIG_FILE}\n`)
  } else {
    await writeFile(configFile, SCAFFOLD)
    io.stdout(`created  ${CONFIG_FILE}\n`)
  }

  const data = await readConfigData(root)
  const config = data.ok ? parseConfig(data.value) : data
  if (!config.ok) throw new Error(`${config.message} (fix it, then run rulecast init again)`)

  const settingsFile = path.join(root, SETTINGS)
  let current: unknown = {}
  try {
    current = JSON.parse(await readFile(settingsFile, "utf8"))
  } catch (error) {
    if (!isNotFound(error)) throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  const command = existsSync(path.join(root, "node_modules", ".bin", "rulecast"))
    ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    : "rulecast hook claude-code"
  let merged: ReturnType<typeof mergeHooks>
  try {
    merged = mergeHooks(current, command, config.value.timeouts.verifyMs)
  } catch (error) {
    throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  if (merged.added.length === 0) {
    io.stdout(`Claude Code hooks already installed in ${SETTINGS}\n`)
  } else {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, `${JSON.stringify(merged.settings, null, 2)}\n`)
    io.stdout(`installed Claude Code hooks in ${SETTINGS}: ${merged.added.join(", ")}\n`)
  }
  io.stdout(`\nnext: add rules to ${CONFIG_FILE}, then run rulecast validate\n`)
  return 0
}
```

- [ ] **Step 11: Adapter text and package exports**

In `src/adapters/claude-code/adapter.ts`, replace:
```ts
const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast/rules) found problems in code changed in this session. Fix them before you finish."
```
with:
```ts
const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish."
```

In `src/index.ts`, replace:
```ts
export { type CompiledProject, type CompiledRule, compile, type Diagnostic } from "./core/compile/compile"
```
with:
```ts
export {
  type CompiledProject,
  type CompileOptions,
  compile,
  compileManifest,
  type Diagnostic,
} from "./core/compile/project"
export type { CompiledRule } from "./core/compile/rule"
```
and after the `runPipeline` export line add:
```ts
export { cachedRepos, fetchingRepos, fixedRepo, type RepoProvider } from "./core/repos/provider"
```

- [ ] **Step 12: Delete the old format**

```bash
git rm packages/rulecast/src/core/compile/compile.ts packages/rulecast/src/core/compile/config.ts packages/rulecast/src/core/compile/rules.ts packages/rulecast/test/core/compile/compile.test.ts packages/rulecast/test/core/compile/config.test.ts packages/rulecast/test/core/compile/rules.test.ts
pnpm --filter @syv-ai/rulecast remove picomatch @types/picomatch
```

Run: `grep -rn "picomatch\|compile/compile\|compile/config\|compile/rules\|\.rulecast/" packages/rulecast/src packages/rulecast/test`
Expected: one line, `test/commands/project.test.ts`'s check that an old `.rulecast/config.yml` is not a project.

- [ ] **Step 13: Run everything**

Run: `pnpm vitest run test/core/detection/select.test.ts test/commands/project.test.ts test/core/pipeline-cli.test.ts test/commands/main.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm test`
Expected: PASS, with the perf suite skipped. `test/build.test.ts` builds `dist/` and runs `check` and a hook through it.

Run: `pnpm test:perf`
Expected: PASS, printing `edit hook: p50 … ms, p95 … ms` (a scratch run of this task's code measured p50 89 ms, p95 114 ms). If p95 is 500 ms or more, stop and use the systematic-debugging skill: time compile on its own before changing anything.

Run: `ls ~/.cache/rulecast 2>/dev/null; echo "exit $?"`
Expected: `exit 1` unless you use rulecast yourself: no test wrote to the real cache home. If the directory appeared during this task, a test is missing `testEnv`/`RULECAST_HOME`; find it before committing.

- [ ] **Step 14: Commit**

```bash
git add packages/rulecast/src/core/detection/select.ts packages/rulecast/src/core/pipeline.ts packages/rulecast/src/core/detection/warm.ts packages/rulecast/src/core/session/decide.ts packages/rulecast/src/core/detection/run.ts packages/rulecast/src/core/types.ts packages/rulecast/src/commands/project.ts packages/rulecast/src/commands/hook.ts packages/rulecast/src/commands/check.ts packages/rulecast/src/commands/validate.ts packages/rulecast/src/commands/warm.ts packages/rulecast/src/commands/init.ts packages/rulecast/src/adapters/claude-code/adapter.ts packages/rulecast/src/index.ts packages/rulecast/package.json pnpm-lock.yaml packages/rulecast/test/helpers/config.ts packages/rulecast/test/helpers/fixture.ts packages/rulecast/test/helpers/pipeline.ts packages/rulecast/test/helpers/rules.ts packages/rulecast/test/core/detection/select.test.ts packages/rulecast/test/core/detection/run.test.ts packages/rulecast/test/core/session/decide-references.test.ts packages/rulecast/test/core/detection/warm.test.ts packages/rulecast/test/core/pipeline-cli.test.ts packages/rulecast/test/core/pipeline-deadline.test.ts packages/rulecast/test/core/pipeline-session.test.ts packages/rulecast/test/commands/hook.test.ts packages/rulecast/test/commands/project.test.ts packages/rulecast/test/commands/warm.test.ts packages/rulecast/test/commands/init.test.ts packages/rulecast/test/commands/main.test.ts packages/rulecast/test/build.test.ts packages/rulecast/test/perf/edit-hook.test.ts
git status --short
git commit -m "feat: switch to .rulecast-config.yaml and delete the .rulecast/ format

Claude goes brr.. via Dash"
```

`git status --short` before the commit must show the six `git rm` deletions as staged (`D `) and no unstaged changes in `packages/rulecast/`.

The old format is gone. Continue with `2026-09-19-rulecast-03d-commands.md` (Task 11: `run` replaces `check`).
