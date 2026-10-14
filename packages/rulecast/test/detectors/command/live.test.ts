import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorResult, defaultDetectorSettings } from "../../../src/core/types"
import { onPath } from "../../../src/core/which"
import { commandDetector } from "../../../src/detectors/command/detector"
import { createProject, fromDisk } from "../../helpers/project"

/**
 * Plan 16's success test: every researched tool works as a `command` rule with config only. Each
 * recipe here is the one agents/reference/tool-recipes.md gives, run on a tiny fixture with a
 * seeded problem. Opt in with RULECAST_TOOLS=1; a tool the machine does not have is skipped by
 * name, as test/detectors/linter/live.test.ts does.
 */
export interface Recipe {
  name: string
  /** The binary that must be on PATH. */
  tool: string
  files: Record<string, string>
  config: Record<string, unknown>
  /** The files the rule selects. */
  select: string[]
  /** What must be among the findings: a rule id, or a message pattern. */
  expect: { file: string; ruleId?: string; message?: RegExp }
}

const PY_TYPE_ERROR = { "a.py": "x: str = 1\nprint(x)\n", "pyproject.toml": "[project]\nname = 'x'\nversion = '0'\n" }
const GO = {
  "go.mod": "module example.com/x\n\ngo 1.22\n",
  "main.go": 'package main\n\nimport "fmt"\n\nfunc unused() int { return 1 }\n\nfunc main() {\n\tfmt.Println("x")\n}\n',
}
const DUPLICATE =
  "export function f(a: number[]): number {\n  let s = 0\n  for (const v of a) {\n    if (v > 0) s += v * 2\n    else s -= v\n  }\n  return s\n}\n"

export const RECIPES: Recipe[] = [
  {
    name: "ty",
    tool: "ty",
    files: PY_TYPE_ERROR,
    config: {
      run: ["ty", "check", "--output-format", "gitlab", "{{files}}"],
      output: "gitlab",
      exit_codes: { error: [2, 101] },
    },
    select: ["a.py"],
    expect: { file: "a.py", ruleId: "invalid-assignment" },
  },
  {
    name: "mypy",
    tool: "mypy",
    files: PY_TYPE_ERROR,
    config: {
      run: ["mypy", "--show-column-numbers", "--no-error-summary", "{{files}}"],
      output: { lines: "gcc" },
      exit_codes: { error: [2] },
    },
    select: ["a.py"],
    expect: { file: "a.py", ruleId: "assignment" },
  },
  {
    name: "pyright",
    tool: "pyright",
    files: PY_TYPE_ERROR,
    config: {
      run: ["pyright", "{{files}}"],
      output: {
        lines: { pattern: "^\\s+(?<file>.+?):(?<line>\\d+):(?<col>\\d+) - (?<severity>\\w+): (?<message>.*)$" },
      },
      exit_codes: { error: [2, 3, 4] },
    },
    select: ["a.py"],
    expect: { file: "a.py", message: /not assignable/ },
  },
  {
    name: "vulture",
    tool: "vulture",
    files: { "a.py": "import os\n\ndef used():\n    return 1\n\nused()\n" },
    config: { run: ["vulture", "."], output: { lines: "gcc-nocol" }, scope: "project", exit_codes: { error: [1, 2] } },
    select: ["a.py"],
    expect: { file: "a.py", message: /unused import 'os'/ },
  },
  {
    name: "tsc",
    tool: "tsc",
    files: {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true,"noEmit":true,"target":"es2022","module":"nodenext"},"include":["src"]}\n',
      "src/index.ts": 'const n: number = "x"\nconsole.log(n)\n',
    },
    config: { run: ["tsc", "--noEmit", "--pretty", "false"], output: { lines: "msbuild" }, scope: "project" },
    select: ["src/index.ts"],
    expect: { file: "src/index.ts", ruleId: "TS2322" },
  },
  {
    name: "knip",
    tool: "knip",
    files: {
      "package.json": '{"name":"x","version":"0.0.0","type":"module","main":"src/index.ts"}\n',
      "src/index.ts": 'import { used } from "./util.js"\nconsole.log(used(1))\n',
      "src/util.ts":
        "export function used(x: number): number { return x + 1 }\nexport function unusedExport(): number { return 2 }\n",
    },
    config: {
      run: ["knip", "--reporter", "sarif", "--no-progress"],
      output: "sarif",
      scope: "project",
      exit_codes: { error: [2] },
    },
    select: ["src/util.ts"],
    expect: { file: "src/util.ts", ruleId: "knip/exports" },
  },
  {
    name: "jscpd",
    tool: "jscpd",
    files: { "src/a.ts": DUPLICATE, "src/b.ts": DUPLICATE },
    config: {
      // SARIF only goes to a file; xcode prints gcc-style lines, with paths relative to the path scanned.
      run: [
        "jscpd",
        "-r",
        "xcode",
        "--no-colors",
        "--min-lines",
        "3",
        "--min-tokens",
        "20",
        "--ignore",
        "**/.git/**",
        ".",
      ],
      output: { lines: "gcc" },
      scope: "project",
    },
    select: ["src/a.ts", "src/b.ts"],
    expect: { file: "src/a.ts", message: /duplicated on file src\/b\.ts/ },
  },
  {
    name: "staticcheck",
    tool: "staticcheck",
    files: GO,
    config: { run: ["staticcheck", "-f", "sarif", "./..."], output: "sarif", scope: "project" },
    select: ["main.go"],
    expect: { file: "main.go", ruleId: "U1000" },
  },
  {
    name: "golangci-lint",
    tool: "golangci-lint",
    files: GO,
    config: {
      run: ["golangci-lint", "run", "--output.sarif.path=stdout", "--output.text.path=", "--show-stats=false", "./..."],
      output: "sarif",
      scope: "project",
      exit_codes: { error: [2, 3, 4, 5, 7] },
    },
    select: ["main.go"],
    expect: { file: "main.go", ruleId: "unused" },
  },
  {
    name: "deadcode",
    tool: "deadcode",
    files: GO,
    config: { run: ["deadcode", "."], output: { lines: "gcc" }, scope: "project" },
    select: ["main.go"],
    expect: { file: "main.go", message: /unreachable func: unused/ },
  },
  {
    name: "semgrep",
    tool: "semgrep",
    files: {
      "c.py": "eval(input())\n",
      "semgrep.yml":
        "rules:\n  - id: no-eval\n    pattern: eval(...)\n    message: avoid eval\n    languages: [python]\n    severity: ERROR\n",
    },
    // semgrep exits 0 with findings unless --error; the SARIF is the answer either way.
    config: {
      run: ["semgrep", "--sarif", "--metrics", "off", "-q", "--config", "semgrep.yml", "{{files}}"],
      output: "sarif",
    },
    select: ["c.py"],
    expect: { file: "c.py", ruleId: "no-eval" },
  },
  {
    name: "hadolint",
    tool: "hadolint",
    files: { Dockerfile: "FROM ubuntu\nRUN apt-get install -y curl\n" },
    config: { run: ["hadolint", "-f", "sarif", "{{files}}"], output: "sarif" },
    select: ["Dockerfile"],
    expect: { file: "Dockerfile", ruleId: "DL3006" },
  },
  {
    name: "tflint",
    tool: "tflint",
    files: { "main.tf": 'variable "unused" {}\n' },
    config: { run: ["tflint", "-f", "sarif"], output: "sarif", scope: "project", exit_codes: { error: [1] } },
    select: ["main.tf"],
    expect: { file: "main.tf", ruleId: "terraform_unused_declarations" },
  },
  {
    name: "shellcheck",
    tool: "shellcheck",
    files: { "s.sh": "#!/bin/bash\ncd foo\n" },
    config: { run: ["shellcheck", "-f", "checkstyle", "{{files}}"], output: "checkstyle" },
    select: ["s.sh"],
    expect: { file: "s.sh", ruleId: "SC2164" },
  },
  {
    name: "osv-scanner",
    tool: "osv-scanner",
    files: { "requirements.txt": "django==2.2.0\n" },
    config: {
      run: ["osv-scanner", "scan", "source", "-f", "sarif", "-L", "requirements.txt"],
      output: "sarif",
      scope: "project",
      exit_codes: { error: [127, 128, 129] },
    },
    select: ["requirements.txt"],
    expect: { file: "requirements.txt", message: /django/i },
  },
  {
    name: "checkov",
    tool: "checkov",
    files: { "main.tf": 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n' },
    config: {
      // checkov writes SARIF only to a file and prints its own report: a shell reads the file instead.
      run: [
        "sh",
        "-c",
        'd=$(mktemp -d) && checkov --quiet -o sarif --output-file-path "$d" -f "$@" >/dev/null; cat "$d/results_sarif.sarif"; rm -rf "$d"',
        "checkov",
        "{{files}}",
      ],
      output: "sarif",
    },
    select: ["main.tf"],
    expect: { file: "main.tf", ruleId: "CKV2_AWS_62" },
  },
]

async function runRecipe(root: string, recipe: Recipe): Promise<DetectorResult> {
  return commandDetector.run({
    event: "verify",
    rules: [
      { id: recipe.name, config: commandDetector.schema.parse(recipe.config), files: recipe.select, context: [] },
    ],
    changes: new Map(),
    read: fromDisk(root),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd: root,
    signal: AbortSignal.timeout(120_000),
    deadlineAt: Date.now() + 120_000,
  })
}

describe.runIf(process.env.RULECAST_TOOLS === "1")("live tools through command rules", () => {
  for (const recipe of RECIPES) {
    test(`${recipe.name}, config only`, async () => {
      if (!(await onPath(recipe.tool))) {
        console.log(`skipping ${recipe.name}: ${recipe.tool} is not installed`)
        return
      }
      const root = await createProject(recipe.files)
      const result = await runRecipe(root, recipe)
      expect(result.errors).toEqual([])
      const found = result.findings.map((finding) => finding.match)
      const hit = found.find(
        (match) =>
          match.file === recipe.expect.file &&
          (recipe.expect.ruleId === undefined || match.captures.ruleId === recipe.expect.ruleId) &&
          (recipe.expect.message === undefined || recipe.expect.message.test(match.captures.message!)),
      )
      expect(hit, JSON.stringify(found, null, 2)).toBeDefined()
      expect(found.every((match) => recipe.select.includes(match.file) && match.line >= 1)).toBe(true)
    }, 180_000)
  }
})
