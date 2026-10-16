import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"

const fix = (cwd: string, ...argv: string[]) => runCli(cwd, ["fix", ...argv])
const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

/** print(...) → log.info(...), with an example that proves it. */
const LOGGER = {
  id: "py/logger",
  name: "Logger",
  files: "\\.py$",
  detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)", fix: "log.info({{args}})" } },
  message: "{{file}}:{{line}} uses print. Use the logger.",
  examples: { bad: [{ path: "a.py", code: 'print("hi")\n', fixed: 'log.info("hi")\n' }] },
}

/** An error rule with no fix. */
const NO_EVAL = {
  id: "py/no-eval",
  name: "No eval",
  files: "\\.py$",
  detect: { regex: { pattern: "eval\\(" } },
  message: "{{file}}:{{line}} uses eval",
}

const VIOLATIONS = 'print("a")\nx = 1\nprint(b, c)\n'

function repo(rules: Record<string, unknown>[], files: Record<string, string> = { "app.py": VIOLATIONS }) {
  return createRepo({ ".rulecast-config.yaml": localConfig(rules), ...files })
}

describe("rulecast fix", () => {
  test("--dry-run prints the diff, writes nothing and exits 0 when everything is fixable", async () => {
    const root = await repo([LOGGER])
    const result = await fix(root, "--all-files", "--dry-run")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      '--- a/app.py\n+++ b/app.py\n@@ -1,3 +1,3 @@\n-print("a")\n+log.info("a")\n x = 1\n-print(b, c)\n+log.info(b, c)\n',
    )
    expect(result.stdout).toContain("would fix 2 findings in 1 file (py/logger ×2)")
    expect(result.stdout).toContain("no findings")
    expect(await read(root, "app.py")).toBe(VIOLATIONS)
  })

  test("without --dry-run it writes, and a second run changes nothing", async () => {
    const root = await repo([LOGGER], { "app.py": 'print("a")\r\nx = 1\r\nprint(b)' })
    const first = await fix(root, "--all-files")
    expect(first.code).toBe(0)
    expect(first.stdout).toContain("fixed 2 findings in 1 file (py/logger ×2)")
    // Offset edits: the line endings and the missing final newline are left as they were.
    expect(await read(root, "app.py")).toBe('log.info("a")\r\nx = 1\r\nlog.info(b)')
    const second = await fix(root, "--all-files")
    expect(second).toMatchObject({ code: 0 })
    expect(second.stdout).toContain("nothing fixed")
    expect(await read(root, "app.py")).toBe('log.info("a")\r\nx = 1\r\nlog.info(b)')
  })

  test("findings with no fix are left and listed, and exit 1", async () => {
    const root = await repo([LOGGER, NO_EVAL], { "app.py": 'print("a")\neval("x")\n' })
    const result = await fix(root, "--all-files")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("fixed 1 finding in 1 file (py/logger ×1)")
    expect(result.stdout).toContain("app.py:2:1  error    py/no-eval")
    expect(await read(root, "app.py")).toBe('log.info("a")\neval("x")\n')
  })

  test("overlapping fixes from two rules are applied over two passes", async () => {
    const rename = {
      id: "py/rename",
      name: "Rename",
      files: "\\.py$",
      detect: { regex: { pattern: "old\\(", fix: "new(" } },
      message: "{{file}}:{{line}} old",
      examples: { bad: [{ path: "a.py", code: "old(\n", fixed: "new(\n" }] },
    }
    const argument = {
      id: "py/argument",
      name: "Argument",
      files: "\\.py$",
      detect: { regex: { pattern: "\\(x\\)", fix: "(y)" } },
      message: "{{file}}:{{line}} x",
      examples: { bad: [{ path: "a.py", code: "f(x)\n", fixed: "f(y)\n" }] },
    }
    const root = await repo([rename, argument], { "app.py": "old(x)\n" })
    const result = await fix(root, "--all-files", "--format", "json")
    expect(result.code).toBe(0)
    expect(await read(root, "app.py")).toBe("new(y)\n")
    expect(JSON.parse(result.stdout).fixed.map((site: { rule: string }) => site.rule)).toEqual([
      "py/rename",
      "py/argument",
    ])
  })

  test("a fix that writes its own violation back is reverted and reported unresolved, and exits 1", async () => {
    const shorten = {
      id: "py/shorten",
      name: "Shorten",
      files: "\\.py$",
      detect: { regex: { pattern: "ab", fix: "b" } },
      message: "{{file}}:{{line}} ab",
      examples: { bad: [{ path: "a.py", code: "ab\n", fixed: "b\n" }] },
    }
    const root = await repo([shorten], { "app.py": "aab\nab\n" })
    const result = await fix(root, "--all-files", "--format", "json")
    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.unresolved).toEqual([expect.objectContaining({ rule: "py/shorten", file: "app.py", line: 1 })])
    expect(parsed.fixed).toEqual([expect.objectContaining({ rule: "py/shorten", file: "app.py", line: 2 })])
    expect(await read(root, "app.py")).toBe("aab\nb\n")
    expect(parsed.findings.map((finding: { line: number }) => finding.line)).toEqual([1])
    // Nothing left to try: the second run is a no-op.
    expect((await fix(root, "--all-files")).stdout).toContain("nothing fixed")
    expect(await read(root, "app.py")).toBe("aab\nb\n")
  })

  test("a rulecast-ignore'd finding is not fixed", async () => {
    const source = 'print("b")\nprint("a")  # rulecast-ignore: py/logger kept for the CLI\n'
    const root = await repo([LOGGER], { "app.py": source })
    expect((await fix(root, "--all-files")).code).toBe(0)
    expect(await read(root, "app.py")).toBe(
      'log.info("b")\nprint("a")  # rulecast-ignore: py/logger kept for the CLI\n',
    )
  })

  test("a rule whose fix fails its own examples is skipped with a warning", async () => {
    const wrong = {
      ...LOGGER,
      examples: { bad: [{ path: "a.py", code: 'print("hi")\n', fixed: 'logger.info("hi")\n' }] },
    }
    const root = await repo([wrong])
    const result = await fix(root, "--all-files")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain(
      "the fix for py/logger fails its examples, so it was not applied (run rulecast test py/logger)",
    )
    expect(await read(root, "app.py")).toBe(VIOLATIONS)
  })

  test("RULE_ID fixes that rule only, and checks only it", async () => {
    const upper = {
      id: "py/upper",
      name: "Upper",
      files: "\\.py$",
      detect: { regex: { pattern: "x = 1", fix: "X = 1" } },
      message: "{{file}}:{{line}} lower",
      examples: { bad: [{ path: "a.py", code: "x = 1\n" }] },
    }
    const root = await repo([LOGGER, upper])
    expect((await fix(root, "py/upper", "--all-files")).code).toBe(0)
    expect(await read(root, "app.py")).toBe('print("a")\nX = 1\nprint(b, c)\n')
  })

  test("a RULE_ID that cannot be fixed is a usage error saying why", async () => {
    const dropped = { ...LOGGER, examples: undefined }
    const root = await repo([dropped, NO_EVAL])
    const missing = await fix(root, "py/logger", "--all-files")
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain("py/logger: fix ignored: a rule with fix needs at least one bad example")
    const none = await fix(root, "py/no-eval", "--all-files")
    expect(none.code).toBe(2)
    expect(none.stderr).toContain("py/no-eval has no fix")
  })

  test("a selection flag is required, and flags that do not apply are refused", async () => {
    const root = await repo([LOGGER])
    for (const argv of [
      [],
      ["--to-ref", "HEAD", "--from-ref", "main"],
      ["--all-files", "--format", "sarif"],
      ["--all-files", "--summary"],
    ]) {
      const result = await fix(root, ...argv)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe("")
    }
    expect((await fix(root)).stderr).toContain("fix needs --files, --all-files or --from-ref")
    expect(await read(root, "app.py")).toBe(VIOLATIONS)
  })

  test("--format json is run's document plus what was fixed", async () => {
    const root = await repo([LOGGER])
    const before = JSON.parse((await runCli(root, ["run", "--all-files", "--format", "json"])).stdout)
    expect(before.findings.every((finding: { fixable?: boolean }) => finding.fixable === true)).toBe(true)
    const dry = JSON.parse((await fix(root, "--all-files", "--dry-run", "--format", "json")).stdout)
    expect(dry).toMatchObject({
      schemaVersion: 1,
      complete: true,
      dryRun: true,
      changedFiles: ["app.py"],
      unresolved: [],
    })
    expect(dry.diff).toContain("+log.info(b, c)")
    expect(dry.findings).toEqual([])
    // The ids are the findings' before the fix: the ones `run` reported.
    expect(dry.fixed).toEqual(
      before.findings.map(({ id, line }: { id: string; line: number }) => ({
        id,
        rule: "py/logger",
        file: "app.py",
        line,
      })),
    )
    const written = JSON.parse((await fix(root, "--all-files", "--format", "json")).stdout)
    expect(written).toMatchObject({ dryRun: false, changedFiles: ["app.py"], findings: [] })
    expect(written.diff).toBeUndefined()
  })

  test("run's JSON marks a finding fixable only when rulecast fix can apply its rule's fix", async () => {
    const dropped = { ...LOGGER, id: "py/logger-unproven", examples: undefined }
    const root = await repo([LOGGER, NO_EVAL, dropped], { "app.py": 'print("a")\neval("x")\n' })
    const findings = JSON.parse((await runCli(root, ["run", "--all-files", "--format", "json"])).stdout).findings
    const byRule = Object.fromEntries(findings.map((finding: { rule: string }) => [finding.rule, finding]))
    expect(byRule["py/logger"].fixable).toBe(true)
    expect("fixable" in byRule["py/no-eval"]).toBe(false)
    expect("fixable" in byRule["py/logger-unproven"]).toBe(false)
  })

  test("--from-ref fixes the changed files only", async () => {
    const root = await repo([LOGGER], { "old.py": 'print("old")\n', "new.py": "x = 1\n" })
    await writeFile(path.join(root, "new.py"), 'x = 1\nprint("new")\n')
    const result = await fix(root, "--from-ref", "main")
    expect(result.code).toBe(0)
    expect(await read(root, "new.py")).toBe('x = 1\nlog.info("new")\n')
    expect(await read(root, "old.py")).toBe('print("old")\n')
  })

  test("an ast-grep fix is applied", async () => {
    const consoleRule = {
      id: "ts/console",
      name: "Console",
      files: "\\.ts$",
      detect: {
        "ast-grep": { language: "typescript", rule: { pattern: "console.log($$$ARGS)" }, fix: "logger.debug($$$ARGS)" },
      },
      message: "{{file}}:{{line}} console.log",
      examples: { bad: [{ path: "a.ts", code: "console.log(a, b)\n", fixed: "logger.debug(a, b)\n" }] },
    }
    const root = await repo([consoleRule], { "src/x.ts": 'const s = "é"; console.log(s, /* n */ 1)\n' })
    expect((await fix(root, "--files", "src/x.ts")).code).toBe(0)
    expect(await read(root, "src/x.ts")).toBe('const s = "é"; logger.debug(s, /* n */ 1)\n')
  })
})
