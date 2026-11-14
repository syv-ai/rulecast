import { realpathSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { findingIds } from "../../../src/core/finding-id"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { LinterConfig } from "../../../src/detectors/linter/schema"
import { ruleSelects } from "../../../src/detectors/linter/schema"
import { brokenTool, linkTool, stubArgv, stubCalls, stubCwds, stubTool } from "../../helpers/linters"
import { createProject, fromDisk } from "../../helpers/project"

const ruleFor = (id: string, config: unknown, files: string[]): DetectorRuleInput<LinterConfig> => ({
  id,
  config: linterDetector.schema.parse(config),
  files,
  context: [],
})

const run = (cwd: string, rules: DetectorRuleInput<LinterConfig>[], event: "edit" | "verify" = "verify") =>
  linterDetector.run({
    event,
    rules,
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  })

const JS = 'console.log("hi")\nconst unused = 1\ndebugger\n'
const PY = "import os\nprint('x')\n"

describe("linter detector", () => {
  test("declares captures and per-tool events", () => {
    expect(linterDetector.kind).toBe("linter")
    expect(linterDetector.captures(linterDetector.schema.parse({ tool: "ruff" }))).toEqual(["message", "ruleId"])
    expect(linterDetector.events(linterDetector.schema.parse({ tool: "eslint" }))).toEqual(["verify"])
    expect(linterDetector.events(linterDetector.schema.parse({ tool: "oxlint" }))).toEqual(["edit", "verify"])
  })

  test("runs the real oxlint once over the union of its rules' files", async () => {
    // The config makes no-debugger an error and leaves the rest of oxlint's defaults at warn.
    const root = await createProject({
      "src/a.js": JS,
      "src/b.js": "debugger\n",
      ".oxlintrc.json": '{ "rules": { "no-debugger": "error" } }\n',
    })
    await linkTool(root, "oxlint")
    const result = await run(root, [
      ruleFor("no-debugger", { tool: "oxlint", rules: ["no-debugger"] }, ["src/a.js", "src/b.js"]),
      ruleFor("everything", { tool: "oxlint" }, ["src/a.js"]),
    ])
    expect(result.errors).toEqual([])
    const debuggerFindings = result.findings.filter((finding) => finding.rule === "no-debugger")
    // oxlint lints files on several threads, so it gives no order across files: sort to compare.
    expect(debuggerFindings.map((finding) => [finding.match.file, finding.match.line]).sort()).toEqual([
      ["src/a.js", 3],
      ["src/b.js", 1],
    ])
    const inA = debuggerFindings.find((finding) => finding.match.file === "src/a.js")!
    expect(inA.match.captures).toEqual({ ruleId: "no-debugger", message: "`debugger` statement is not allowed" })
    expect(inA.match.text).toBe("debugger")
    // "everything" has no rules list, so it gets what the project's config makes an error, and
    // only for the one file it selects. no-unused-vars fires at oxlint's default level, warn.
    const all = result.findings.filter((finding) => finding.rule === "everything")
    expect(all.map((finding) => [finding.match.file, finding.match.captures.ruleId])).toEqual([
      ["src/a.js", "no-debugger"],
    ])
    expect(inA.match.docs).toMatch(/^https:\/\/oxc\.rs\//)
  })

  test("biome: a rule named without its group is refused, since Biome reports group/rule and it would never match", () => {
    const parsed = linterDetector.schema.safeParse({ tool: "biome", rules: ["suspicious/noDebugger", "noConsole"] })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      "noConsole: biome reports rules as group/rule, such as suspicious/noDebugger",
    ])
    expect(linterDetector.schema.safeParse({ tool: "biome", rules: ["a11y/useAltText"] }).success).toBe(true)
  })

  test("biome: its rdjson, rule ids as biome.json writes them, levels from the project's config (#75)", async () => {
    // Recorded with style/useConst at warn and the recommended rules' own levels.
    const root = await createProject({ "src/a.js": "debugger;\nlet a = 1;\nif (a == 2) { console.log(a) }\n" })
    // Not biome.json: Biome would read a file of that name in this repository as its own config.
    await stubTool(root, "biome", { recording: "biome-rdjson" })
    const result = await run(root, [
      ruleFor("errors", { tool: "biome" }, ["src/a.js"]),
      ruleFor("const", { tool: "biome", rules: ["style/useConst"] }, ["src/a.js"]),
    ])
    expect(result.errors).toEqual([])
    const of = (rule: string) =>
      result.findings
        .filter((finding) => finding.rule === rule)
        .map((finding) => [finding.match.line, finding.match.captures.ruleId])
    expect(of("errors")).toEqual([
      [1, "suspicious/noDebugger"],
      [3, "suspicious/noDoubleEquals"],
    ])
    expect(of("const")).toEqual([[2, "style/useConst"]])
    expect(result.findings.find((finding) => finding.rule === "errors")!.match.docs).toBe(
      "https://biomejs.dev/linter/rules/no-debugger",
    )
  })

  test("a rule without rules takes only the findings the project's config makes errors", async () => {
    // The recording has no-console at error and no-debugger at warn.
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const result = await run(root, [ruleFor("all", { tool: "eslint" }, ["src/a.js"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => finding.match.captures.ruleId)).toEqual(["no-console"])
  })

  test("a named rule still gets its rules whatever level the config gives them", async () => {
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const result = await run(root, [ruleFor("named", { tool: "eslint", rules: ["no-debugger"] }, ["src/a.js"])])
    expect(result.findings.map((finding) => finding.match.captures.ruleId)).toEqual(["no-debugger"])
  })

  test("eslint's ignored-file notice is never a finding", async () => {
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const notice = {
      results: [
        {
          filePath: path.join(root, "src/a.js"),
          messages: [
            {
              ruleId: null,
              fatal: false,
              severity: 1,
              message: "File ignored because no matching configuration was supplied.",
            },
          ],
        },
      ],
      metadata: { rulesMeta: {} },
    }
    await writeFile(path.join(root, "node_modules", ".bin", "eslint.recording.json"), JSON.stringify(notice))
    const result = await run(root, [ruleFor("all", { tool: "eslint" }, ["src/a.js"])])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("a match carries the tool's doc url, and its id does not depend on it", async () => {
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const result = await run(root, [ruleFor("all", { tool: "eslint" }, ["src/a.js"])])
    const match = result.findings[0]!.match
    expect(match.docs).toBe("https://eslint.org/docs/latest/rules/no-console")
    expect(match.captures).toEqual({ message: "Unexpected console statement.", ruleId: "no-console" })
    const rule = { id: "all", detector: { kind: "linter" } }
    const idOf = async (one: typeof match) =>
      (
        await findingIds(
          [{ rule, match: one }],
          () => ({}),
          async () => null,
        )
      )[0]
    expect(await idOf({ ...match, docs: "https://example.com/elsewhere" })).toBe(await idOf(match))
  })

  test("passes the union of files to the tool exactly once", async () => {
    const root = await createProject({ "app/a.py": PY, "app/b.py": PY })
    await stubTool(root, "ruff")
    await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py", "app/b.py"]),
      ruleFor("imports", { tool: "ruff", rules: ["F401"] }, ["app/a.py"]),
    ])
    expect(await stubArgv(root, "ruff")).toBe(
      "check --output-format json --force-exclude --extend-select F401,T201 -- app/a.py app/b.py",
    )
  })

  test("rules that take every finding run apart from rules that name theirs", async () => {
    // Turning named rules on must not hand extra findings to a rule that asked for whatever the
    // project's own config reports: the two kinds get a run each.
    const root = await createProject({ "app/a.py": PY, "app/b.py": PY })
    await stubTool(root, "ruff")
    await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py"]),
      ruleFor("everything", { tool: "ruff" }, ["app/b.py"]),
    ])
    expect((await stubCalls(root, "ruff")).sort()).toEqual([
      "check --output-format json --force-exclude -- app/b.py",
      "check --output-format json --force-exclude --extend-select T201 -- app/a.py",
    ])
  })

  test("a gitleaks finding never carries the secret it found", async () => {
    const root = await createProject({ "app/conf.py": 'API_KEY = "x8Fq2LmN9pRt6VwXy1Zb3Cd5Ef7Gh"\nTIMEOUT = 30\n' })
    await stubTool(root, "gitleaks")
    const result = await run(root, [ruleFor("secrets", { tool: "gitleaks" }, ["app/conf.py"])], "edit")
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.match).toMatchObject({
      file: "app/conf.py",
      line: 1,
      text: "[redacted]",
      // So its id does not hash the line the secret is on either.
      redacted: true,
    })
    expect(result.findings[0]!.match.captures.ruleId).toBe("generic-api-key")
  })

  test("a finding from a stdin run that names no file belongs to the file that was piped in", async () => {
    const root = await createProject({ "app/conf.py": "TIMEOUT = 30\n" })
    await stubTool(root, "gitleaks", { recording: "gitleaks-stdin" })
    const staged = new Map([["app/conf.py", 'API_KEY = "x8Fq2LmN9pRt6VwXy1Zb3Cd5Ef7Gh"\n']])
    const result = await linterDetector.run({
      event: "verify",
      rules: [ruleFor("secrets", { tool: "gitleaks" }, ["app/conf.py"])],
      changes: new Map(),
      read: async (file) => staged.get(file) ?? null,
      fromDisk: false,
      cache: memoryCache(),
      settings: defaultDetectorSettings(),
      cwd: root,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    })
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => [finding.rule, finding.match.file, finding.match.text])).toEqual([
      ["secrets", "app/conf.py", "[redacted]"],
    ])
  })

  test("a rule the project's config leaves off still fires; an inline suppression still holds", async () => {
    const root = await createProject({
      "src/a.js": "try { f() } catch (e) {}\n",
      "src/b.js": "// oxlint-disable-next-line no-empty\ntry { f() } catch (e) {}\n",
      ".oxlintrc.json": '{ "rules": { "no-empty": "off" } }\n',
    })
    await linkTool(root, "oxlint")
    const result = await run(root, [
      ruleFor("empty", { tool: "oxlint", rules: ["no-empty"] }, ["src/a.js", "src/b.js"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => [finding.match.file, finding.match.captures.ruleId])).toEqual([
      ["src/a.js", "no-empty"],
    ])
  })

  test("attributes a finding to every rule that asked for its rule id", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubTool(root, "ruff")
    const result = await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py"]),
      ruleFor("imports", { tool: "ruff", rules: ["F401"] }, ["app/a.py"]),
      ruleFor("both", { tool: "ruff", rules: ["T201", "F401"] }, ["app/a.py"]),
      ruleFor("other-file", { tool: "ruff" }, ["app/elsewhere.py"]),
    ])
    expect(result.errors).toEqual([])
    const byRule = (id: string) =>
      result.findings.filter((finding) => finding.rule === id).map((finding) => finding.match.captures.ruleId)
    expect(byRule("print")).toEqual(["T201"])
    expect(byRule("imports")).toEqual(["F401"])
    expect(byRule("both").sort()).toEqual(["F401", "T201"])
    expect(byRule("other-file")).toEqual([])
  })

  test("a ruff rule that names a selector takes the findings it selects: T takes T201, F4 takes F401", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubTool(root, "ruff")
    const result = await run(root, [
      ruleFor("linter", { tool: "ruff", rules: ["T"] }, ["app/a.py"]),
      ruleFor("group", { tool: "ruff", rules: ["F4"] }, ["app/a.py"]),
      ruleFor("other", { tool: "ruff", rules: ["F5", "TRY"] }, ["app/a.py"]),
      ruleFor("all", { tool: "ruff", rules: ["ALL"] }, ["app/a.py"]),
    ])
    expect(result.errors).toEqual([])
    const byRule = (id: string) =>
      result.findings.filter((finding) => finding.rule === id).map((finding) => finding.match.captures.ruleId)
    expect(byRule("linter")).toEqual(["T201"])
    expect(byRule("group")).toEqual(["F401"])
    expect(byRule("other")).toEqual([])
    expect(byRule("all").sort()).toEqual(["F401", "T201"])
  })

  test.each([
    ["B", "B006", true],
    ["B0", "B006", true],
    ["B006", "B006", true],
    ["B1", "B006", false],
    ["B", "BLE001", false],
    ["E", "ERA001", false],
    ["E5", "E501", true],
    ["C", "C901", true],
    ["C4", "C901", false],
    ["PL", "PLR0913", true],
    ["PLR", "PLR0913", true],
    ["PLR09", "PLR0913", true],
    ["PLC", "PLR0913", false],
    ["ALL", "RUF100", true],
    // Renamed selectors still pass ruff, which reports the new code: TCH is TC, TRIO is ASYNC.
    ["TCH", "TC001", true],
    ["TCH001", "TC001", true],
    ["TCH006", "TC010", true],
    ["TCH001", "TC002", false],
    ["TRIO", "ASYNC100", true],
    ["TRIO", "ASYNC210", false],
    ["PDV", "PD011", true],
    ["U", "UP006", true],
    ["U00", "UP006", true],
    ["R", "RET505", true],
    ["IC", "ICN001", true],
    ["IC003", "ICN001", true],
    ["I25", "TID252", true],
    ["C9", "C901", true],
    ["T1", "T100", true],
    ["T2", "T201", true],
    ["M", "RUF100", true],
    ["T001", "FIX001", true],
    ["TRY200", "B904", true],
    ["PLW0117", "PLW0177", true],
    ["C901", "C901", true],
  ])("ruff selector %s selects %s: %s", (selector, code, selects) => {
    expect(ruleSelects("ruff", selector, code)).toBe(selects)
  })

  test("other tools' rule ids match exactly", () => {
    expect(ruleSelects("eslint", "no-console", "no-console")).toBe(true)
    expect(ruleSelects("eslint", "no", "no-console")).toBe(false)
    expect(ruleSelects("biome", "suspicious/noDebugger", "suspicious/noDebugger")).toBe(true)
  })

  test("tools run independently: a failing one fails only its own rules", async () => {
    const root = await createProject({ "src/a.js": JS, "app/a.py": PY })
    await linkTool(root, "oxlint")
    // A ruff that answers with garbage, so the test doesn't depend on ruff being absent from PATH.
    await brokenTool(root, "ruff")
    const result = await run(root, [
      ruleFor("js", { tool: "oxlint", rules: ["no-debugger"] }, ["src/a.js"]),
      ruleFor("py", { tool: "ruff" }, ["app/a.py"]),
    ])
    expect(result.findings.map((finding) => finding.rule)).toEqual(["js"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.rule).toBe("py")
    expect(result.errors[0]!.message).toContain("ruff")
    // Never a whole-run error: that would take oxlint down with it.
    expect(result.errors.every((error) => error.rule !== null)).toBe(true)
  })

  test("eslint runs on a verify event and its findings carry the source they point at", async () => {
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const result = await run(root, [ruleFor("js", { tool: "eslint", rules: ["no-console"] }, ["src/a.js"])])
    expect(await stubArgv(root, "eslint")).toBe(
      "--format=json-with-metadata --no-error-on-unmatched-pattern --rule no-console: error -- src/a.js",
    )
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.match).toMatchObject({
      file: "src/a.js",
      line: 1,
      column: 1,
      // eslint reported columns 1-12 (endColumn is exclusive), so the excerpt is "console.log".
      text: "console.log",
      captures: { ruleId: "no-console", message: "Unexpected console statement." },
    })
  })

  test("{{text}} is the source line even on a last line with no trailing newline", async () => {
    // oxlint never reports an end column, so the excerpt runs to the end of the line. A file whose
    // last line has no newline has no next line to stop at, which used to leave {{text}} empty.
    const root = await createProject({ "src/a.js": "const x = 1\ndebugger" })
    await linkTool(root, "oxlint")
    const result = await run(root, [ruleFor("r", { tool: "oxlint", rules: ["no-debugger"] }, ["src/a.js"])])
    expect(result.errors).toEqual([])
    expect(result.findings[0]!.match.text).toBe("debugger")
  })

  test("unreadable tool output fails that tool's rules", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubTool(root, "ruff")
    await writeFile(path.join(root, "node_modules", ".bin", "ruff.recording.json"), "not json")
    const result = await run(root, [ruleFor("py", { tool: "ruff" }, ["app/a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors[0]!.message).toContain("ruff output is not JSON")
  })

  test("an unreadable file fails that tool's rules, not the whole run", async () => {
    // The eslint stub reports src/a.js, which is a directory here, so reading it for {{text}}
    // throws EISDIR. readSourceFile only swallows ENOENT, and a throw out of run() would be a
    // whole-run error disabling every tool in the run rather than just eslint's rules.
    const root = await createProject({ "src/other.js": JS })
    await mkdir(path.join(root, "src/a.js"), { recursive: true })
    await stubTool(root, "eslint")
    await linkTool(root, "oxlint")
    const result = await run(root, [
      ruleFor("es", { tool: "eslint" }, ["src/a.js"]),
      ruleFor("js", { tool: "oxlint", rules: ["no-debugger"] }, ["src/other.js"]),
    ])
    expect(result.errors.map((error) => error.rule)).toEqual(["es"])
    expect(result.errors[0]!.message).toContain("EISDIR")
    // oxlint ran beside it and is unaffected.
    expect(result.findings.map((finding) => finding.rule)).toEqual(["js"])
  })

  test("a tool whose rules select no files does not run", async () => {
    const root = await createProject({})
    await stubTool(root, "ruff")
    expect(await run(root, [ruleFor("py", { tool: "ruff" }, [])])).toEqual({ findings: [], errors: [] })
  })

  test("no rules is an empty result", async () => {
    expect(await run(await createProject({}), [])).toEqual({ findings: [], errors: [] })
  })
})

describe("where a linter runs", () => {
  test("a package's own eslint config: eslint runs there, and its finding comes back from the root", async () => {
    const root = await createProject({ "frontend/eslint.config.js": "export default []\n", "frontend/src/a.js": JS })
    // The tool sits in the root's node_modules/.bin: it is looked for from frontend/ upward.
    await stubTool(root, "eslint", { ranIn: path.join(root, "frontend") })
    const result = await run(root, [ruleFor("js", { tool: "eslint", rules: ["no-console"] }, ["frontend/src/a.js"])])
    expect(await stubCalls(root, "eslint")).toEqual([
      "--format=json-with-metadata --no-error-on-unmatched-pattern --rule no-console: error -- src/a.js",
    ])
    expect(await stubCwds(root, "eslint")).toEqual([realpathSync(path.join(root, "frontend"))])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => [finding.match.file, finding.match.text])).toEqual([
      ["frontend/src/a.js", "console.log"],
    ])
  })

  test("two packages with their own pyproject.toml: one ruff run in each", async () => {
    const root = await createProject({
      "api/pyproject.toml": "[project]\nname = 'api'\n",
      "api/app/a.py": PY,
      "worker/pyproject.toml": "[project]\nname = 'worker'\n",
      "worker/app/a.py": PY,
    })
    await stubTool(root, "ruff", { ranIn: path.join(root, "api") })
    const result = await run(root, [ruleFor("py", { tool: "ruff" }, ["api/app/a.py", "worker/app/a.py"])])
    expect(await stubCalls(root, "ruff")).toEqual([
      "check --output-format json --force-exclude -- app/a.py",
      "check --output-format json --force-exclude -- app/a.py",
    ])
    expect((await stubCwds(root, "ruff")).sort()).toEqual(
      [path.join(root, "api"), path.join(root, "worker")].map((dir) => realpathSync(dir)),
    )
    expect(result.errors).toEqual([])
    expect(new Set(result.findings.map((finding) => finding.match.file))).toEqual(new Set(["api/app/a.py"]))
  })

  test("a project with its config at the root: one run from the root, its arguments as ever", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n", "app/a.py": PY, "lib/b.py": PY })
    await stubTool(root, "ruff")
    await run(root, [ruleFor("py", { tool: "ruff" }, ["app/a.py", "lib/b.py"])])
    expect(await stubCalls(root, "ruff")).toEqual(["check --output-format json --force-exclude -- app/a.py lib/b.py"])
    expect(await stubCwds(root, "ruff")).toEqual([realpathSync(root)])
  })

  test("content that is not on disk is piped in under its path from the package", async () => {
    const root = await createProject({ "api/ruff.toml": "", "api/app/a.py": "on disk\n" })
    await stubTool(root, "ruff", { ranIn: path.join(root, "api") })
    const result = await linterDetector.run({
      event: "verify",
      rules: [ruleFor("py", { tool: "ruff" }, ["api/app/a.py"])],
      changes: new Map(),
      read: async (file) => (file === "api/app/a.py" ? PY : null),
      fromDisk: false,
      cache: memoryCache(),
      settings: defaultDetectorSettings(),
      cwd: root,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    })
    expect(await stubArgv(root, "ruff")).toBe("check --output-format json --force-exclude --stdin-filename app/a.py -")
    expect(await stubCwds(root, "ruff")).toEqual([realpathSync(path.join(root, "api"))])
    expect(result.findings.map((finding) => finding.match.file)).toContain("api/app/a.py")
  })
})
