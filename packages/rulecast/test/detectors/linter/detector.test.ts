import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { LinterConfig } from "../../../src/detectors/linter/schema"
import { linkTool, stubArgv, stubTool } from "../../helpers/linters"
import { createProject } from "../../helpers/project"

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
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
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
    const root = await createProject({ "src/a.js": JS, "src/b.js": "debugger\n" })
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
    // "everything" has no rules list, so it gets every diagnostic oxlint reported — but only for
    // the one file it selects. Asserted as a superset rather than a count: oxlint's default rule
    // set changes between releases, and this test is not about which rules it ships.
    const all = result.findings.filter((finding) => finding.rule === "everything")
    expect(all.every((finding) => finding.match.file === "src/a.js")).toBe(true)
    // More than the filtered rule's one id, which is the whole point of omitting `rules`.
    const allIds = all.map((finding) => finding.match.captures.ruleId)
    expect(allIds).toContain("no-debugger")
    expect(allIds).toContain("no-unused-vars")
  })

  test("passes the union of files to the tool exactly once", async () => {
    const root = await createProject({ "app/a.py": PY, "app/b.py": PY })
    await stubTool(root, "ruff")
    await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py", "app/b.py"]),
      ruleFor("imports", { tool: "ruff", rules: ["F401"] }, ["app/a.py"]),
    ])
    expect(await stubArgv(root, "ruff")).toBe("check --output-format json --force-exclude -- app/a.py app/b.py")
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

  test("tools run independently: a missing one fails only its own rules", async () => {
    const root = await createProject({ "src/a.js": JS, "app/a.py": PY })
    await linkTool(root, "oxlint")
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
    expect(await stubArgv(root, "eslint")).toBe("--format=json --no-error-on-unmatched-pattern -- src/a.js")
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
