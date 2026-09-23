import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"
import { z } from "zod"
import { compile, compileManifest } from "../../../src/core/compile/project"
import { createRegistry } from "../../../src/core/detection/registry"
import { repoDir, repoLabel } from "../../../src/core/repos/layout"
import { cachedRepos, fetchingRepos } from "../../../src/core/repos/provider"
import type { Detector } from "../../../src/core/types"
import { VERSION } from "../../../src/core/version"
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

/** Like `fake`, but able to judge a file it is handed: enough for refuse_write to be allowed. */
const guarding: Detector<Record<string, never>> = {
  kind: "guarding",
  schema: z.object({}).strict(),
  captures: () => [],
  events: () => ["edit", "verify"],
  guards: true,
  run: async () => ({ findings: [], errors: [] }),
}

const registry = createRegistry([fake, guarding])

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
        detectRule("refuse-unguardable", { detect: { fake: {} }, refuse_write: true }),
        detectRule("refuse-verify-only", { detect: { guarding: {} }, refuse_write: true, stages: ["verify"] }),
        touchRule("refuse-without-detect", { refuse_write: true }),
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
      ["refuse-unguardable", "refuse_write needs a detector that can judge a file before it is written; fake cannot"],
      ["refuse-verify-only", "refuse_write needs edit among the rule's stages"],
      ["refuse-without-detect", "refuse_write needs detect: there is nothing to refuse a write for"],
      ["bad-regex", expect.stringMatching(/^files: invalid regex: /)],
      ["bad-type", 'unknown file type "cobol"'],
      ["missing-file", "referenced file not found: docs/nope.md"],
      ["missing-anchor", 'anchor "#nope" not found in docs/api.md'],
      ["bad-syntax", 'reference "docs/api.md" must start with "@"'],
      ["escapes", 'reference "@../secrets.md" leaves its root'],
      ["too-new", `requires rulecast 99.0.0 or newer (running ${VERSION})`],
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

  test("awaits a detector schema with an async refinement", async () => {
    const asyncProbe: Detector<{ value: string }> = {
      kind: "async-probe",
      schema: z
        .object({ value: z.string() })
        .strict()
        .superRefine(async (config, ctx) => {
          await Promise.resolve()
          if (config.value === "bad") ctx.addIssue({ code: "custom", path: ["value"], message: "value is bad" })
        }),
      captures: () => [],
      events: () => ["edit", "verify"],
      run: async () => ({ findings: [], errors: [] }),
    }
    const root = await createProject({
      ".rulecast-config.yaml": stringify(
        local(
          { id: "ok", name: "Ok", detect: { "async-probe": { value: "fine" } }, message: "{{file}}" },
          { id: "nope", name: "Nope", detect: { "async-probe": { value: "bad" } }, message: "{{file}}" },
        ),
      ),
    })
    const project = await compile({
      root,
      registry: createRegistry([asyncProbe]),
      repos: cachedRepos(TEST_HOME),
    })
    expect(project.rules.map((rule) => rule.id)).toEqual(["ok"])
    expect(project.diagnostics.map((d) => d.message)).toEqual(["detect.async-probe: value: value is bad"])
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
    expect(tooNew.diagnostics.map((d) => d.message)).toEqual([
      // Not the literal version: `changeset version` bumps it, and a literal here fails the
      // suite inside the release job and blocks the version commit from being pushed.
      `requires rulecast 99.0.0 or newer (running ${VERSION})`,
    ])
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
