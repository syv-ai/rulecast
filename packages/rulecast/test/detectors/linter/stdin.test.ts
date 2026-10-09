import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { LinterConfig } from "../../../src/detectors/linter/schema"
import { stubArgv, stubStdin, stubTool } from "../../helpers/linters"
import { createProject } from "../../helpers/project"

const ruleFor = (config: unknown, files: string[]): DetectorRuleInput<LinterConfig> => ({
  id: "r",
  config: linterDetector.schema.parse(config),
  files,
  context: [],
})

/** A run whose content is not on disk: the index, say. */
const runOnContent = (cwd: string, rules: DetectorRuleInput<LinterConfig>[], content: Record<string, string>) =>
  linterDetector.run({
    event: "verify",
    rules,
    changes: new Map(),
    read: async (file) => content[file] ?? null,
    fromDisk: false,
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  })

describe("linter on content that is not on disk", () => {
  test("ruff and eslint take content, oxlint does not", () => {
    const takes = (tool: string) => linterDetector.takesContent!(linterDetector.schema.parse({ tool }))
    expect(takes("ruff")).toBe(true)
    expect(takes("eslint")).toBe(true)
    expect(takes("oxlint")).toBe(false)
  })

  test("ruff is handed the content on stdin under the file's real path", async () => {
    const root = await createProject({ "app/a.py": "on disk\n" })
    await stubTool(root, "ruff")
    const result = await runOnContent(root, [ruleFor({ tool: "ruff" }, ["app/a.py"])], {
      "app/a.py": "import os\nprint('x')\n",
    })
    expect(await stubArgv(root, "ruff")).toBe("check --output-format json --force-exclude --stdin-filename app/a.py -")
    expect(await stubStdin(root, "ruff")).toBe("import os\nprint('x')\n")
    // Findings carry the real path, and {{text}} quotes the content that was judged.
    expect(result.findings.map((finding) => finding.match.file)).toContain("app/a.py")
    const f401 = result.findings.find((finding) => finding.match.captures.ruleId === "F401")
    expect(f401?.match.text).toBe("os")
  })

  test("eslint is handed the content on stdin under the file's real path", async () => {
    const root = await createProject({ "src/a.js": "on disk\n" })
    await stubTool(root, "eslint")
    await runOnContent(root, [ruleFor({ tool: "eslint" }, ["src/a.js"])], { "src/a.js": 'console.log("x")\n' })
    expect(await stubArgv(root, "eslint")).toBe("--format=json --stdin --stdin-filename src/a.js")
    expect(await stubStdin(root, "eslint")).toBe('console.log("x")\n')
  })

  test("a file absent from the content is skipped", async () => {
    const root = await createProject({})
    await stubTool(root, "ruff")
    const result = await runOnContent(root, [ruleFor({ tool: "ruff" }, ["gone.py"])], {})
    expect(result).toEqual({ findings: [], errors: [] })
  })
})
