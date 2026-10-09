import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"

import { resolveTool } from "../../../src/detectors/linter/resolve"
import type { ToolName } from "../../../src/detectors/linter/schema"
import { TOOLS } from "../../../src/detectors/linter/tools"
import { linkTool, realTool } from "../../helpers/linters"
import { createProject } from "../../helpers/project"

const exec = promisify(execFile)

interface Live {
  tool: ToolName
  files: Record<string, string>
  file: string
  /** A rule id the tool must report, so a silent "no findings" cannot pass. */
  ruleId: string
}

const LIVE: Live[] = [
  {
    tool: "ruff",
    files: {
      "app/a.py": "import os\nprint('x')\n",
      "pyproject.toml": "[project]\nname = 'x'\nversion = '0'\n\n[tool.ruff.lint]\nselect = ['F', 'T20']\n",
    },
    file: "app/a.py",
    ruleId: "F401",
  },
  { tool: "oxlint", files: { "src/a.js": "debugger\n" }, file: "src/a.js", ruleId: "no-debugger" },
  {
    tool: "eslint",
    files: {
      "src/a.js": 'console.log("x")\n',
      "eslint.config.js": 'export default [{ rules: { "no-console": "error" } }]\n',
    },
    file: "src/a.js",
    ruleId: "no-console",
  },
]

/**
 * Opt in with RULECAST_LINTERS=1. ruff and eslint are replayed from test/payloads/linter/ in the
 * normal suite because they cannot be workspace devDependencies (plan 5b, Decision 1); this is
 * where those recordings are checked against the real tools. A tool the machine does not have is
 * skipped by name rather than silently passing.
 */
describe.runIf(process.env.RULECAST_LINTERS === "1")("live linters", () => {
  for (const live of LIVE) {
    test(`${live.tool} reports ${live.ruleId} and parses`, async () => {
      const root = await createProject(live.files)
      if (realTool(live.tool) !== null) await linkTool(root, live.tool)
      const resolved = await resolveTool(live.tool, root)
      const installed = await exec(resolved.command, [...resolved.prefix, "--version"], { cwd: root })
        .then(() => true)
        .catch(() => false)
      if (!installed) {
        console.log(`skipping ${live.tool}: not installed`)
        return
      }
      const args = [...resolved.prefix, ...TOOLS[live.tool].args([live.file])]
      const { stdout } = await exec(resolved.command, args, { cwd: root }).catch(
        (error: { stdout?: string }) => error as { stdout: string },
      )
      const findings = TOOLS[live.tool].parse(stdout, root)
      expect(findings.map((finding) => finding.ruleId)).toContain(live.ruleId)
      expect(findings.every((finding) => finding.file === live.file)).toBe(true)
      expect(findings.every((finding) => finding.line >= 1 && finding.column >= 1)).toBe(true)
    }, 60_000)
  }

  /**
   * Plan 10 Decision 3: content that is not on disk (a staged run) goes in on stdin under the real
   * path, so configuration keyed on that path applies. A scratch copy would break exactly this.
   */
  const PATH_KEYED: { tool: ToolName; files: Record<string, string>; file: string }[] = [
    {
      tool: "ruff",
      files: {
        "tests/t.py": "print('x')\n",
        "app/a.py": "print('x')\n",
        "pyproject.toml":
          "[project]\nname = 'x'\nversion = '0'\n\n[tool.ruff.lint]\nselect = ['T20']\n\n[tool.ruff.lint.per-file-ignores]\n'tests/*' = ['T201']\n",
      },
      file: "tests/t.py",
    },
    {
      tool: "eslint",
      files: {
        "src/a.js": 'console.log("x")\n',
        "other/b.js": 'console.log("x")\n',
        "eslint.config.js": 'export default [{ files: ["src/**"], rules: { "no-console": "error" } }]\n',
      },
      file: "src/a.js",
    },
  ]
  for (const keyed of PATH_KEYED) {
    test(`${keyed.tool} on stdin honours path-keyed configuration`, async () => {
      const root = await createProject(keyed.files)
      if (realTool(keyed.tool) !== null) await linkTool(root, keyed.tool)
      const resolved = await resolveTool(keyed.tool, root)
      const installed = await exec(resolved.command, [...resolved.prefix, "--version"], { cwd: root })
        .then(() => true)
        .catch(() => false)
      if (!installed) {
        console.log(`skipping ${keyed.tool}: not installed`)
        return
      }
      const onDisk = async (file: string) => {
        const args = [...resolved.prefix, ...TOOLS[keyed.tool].args([file])]
        const { stdout } = await exec(resolved.command, args, { cwd: root }).catch(
          (error: { stdout?: string }) => error as { stdout: string },
        )
        return TOOLS[keyed.tool].parse(stdout, root).map((finding) => finding.ruleId)
      }
      const onStdin = async (file: string) => {
        const args = [...resolved.prefix, ...TOOLS[keyed.tool].stdinArgs!(file)]
        const child = exec(resolved.command, args, { cwd: root })
        child.child.stdin?.end(keyed.files[file])
        const { stdout } = await child.catch((error: { stdout?: string }) => error as { stdout: string })
        return TOOLS[keyed.tool].parse(stdout, root).map((finding) => finding.ruleId)
      }
      const sources = Object.keys(keyed.files).filter((name) => /\.(py|js)$/.test(name) && !name.startsWith("eslint"))
      const seen: string[] = []
      for (const file of sources) {
        const expected = await onDisk(file)
        expect(await onStdin(file), file).toEqual(expected)
        seen.push(...expected)
      }
      // One file is covered by the path-keyed rule and one is not: equal and empty would prove nothing.
      expect(seen.length).toBeGreaterThan(0)
      expect(await onDisk(keyed.file)).toEqual(keyed.tool === "ruff" ? [] : ["no-console"])
    }, 60_000)
  }
})
