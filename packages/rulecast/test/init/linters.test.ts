import { existsSync } from "node:fs"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { scanHeadings } from "../../src/core/anchors"
import { readSourceFile } from "../../src/core/detection/per-rule"
import type { DetectedDoc } from "../../src/init/detect"
import { detectLinters, linterRule, parseRuffSettings, sectionsNaming } from "../../src/init/linters"
import { brokenTool, stubTool } from "../helpers/linters"
import { createProject } from "../helpers/project"

/** Nothing is on PATH: only what a test puts in node_modules/.bin is found. */
const nowhere = async () => false

async function detect(files: Record<string, string>, stub?: { tool: string; output?: string; broken?: boolean }) {
  const root = await createProject(files)
  if (stub?.broken) await brokenTool(root, stub.tool)
  else if (stub !== undefined) {
    await stubTool(root, stub.tool)
    if (stub.output !== undefined) {
      await writeFile(path.join(root, "node_modules", ".bin", `${stub.tool}.recording.json`), stub.output)
    }
  }
  return detectLinters(root, Object.keys(files), {
    read: (file) => readSourceFile(root, file),
    available: nowhere,
  })
}

const ESLINT = { "eslint.config.mjs": "export default []\n", "src/a.js": "x\n" }

const RUFF_SETTINGS = [
  "linter.exclude = []",
  "linter.rules.enabled = [",
  "\tmutable-argument-default (B006),",
  "\tunused-import (F401),",
  "]",
  "linter.rules.should_fix = [",
  "\tunused-import (F401),",
  "]",
  "",
].join("\n")

const doc = (file: string, text: string): [DetectedDoc, string] => [
  { file, headings: scanHeadings(text), importedBy: null },
  text,
]
const naming = (entries: [DetectedDoc, string][], ids: string[], names?: Record<string, string>) =>
  sectionsNaming(
    entries.map(([one]) => one),
    new Map(entries.map(([one, text]) => [one.file, text])),
    ids,
    names,
  )

describe("detectLinters", () => {
  test("detects eslint from its flat config, and not without the binary", async () => {
    const found = await detect(ESLINT, { tool: "eslint", output: '{"rules":{}}' })
    expect(found.map((linter) => [linter.id, linter.config])).toEqual([["linter/eslint", "eslint.config.mjs"]])
    expect(await detect(ESLINT)).toEqual([])
  })

  test("a pyproject.toml without a ruff table is not ruff", async () => {
    const files = { "pyproject.toml": "[project]\nname = 'x'\n", "app/a.py": "x = 1\n" }
    expect(await detect(files, { tool: "ruff", output: RUFF_SETTINGS })).toEqual([])
    const ruff = { ...files, "pyproject.toml": "[project]\nname = 'x'\n\n[tool.ruff.lint]\nselect = ['F', 'B']\n" }
    expect((await detect(ruff, { tool: "ruff", output: RUFF_SETTINGS })).map((linter) => linter.id)).toEqual([
      "linter/ruff",
    ])
  })

  test("lists eslint's error rules from print-config and counts its warnings", async () => {
    const [eslint] = await detect(ESLINT, {
      tool: "eslint",
      output: '{"rules":{"eqeqeq":[2],"no-console":[1],"no-var":[0],"semi":"error"}}',
    })
    expect(eslint).toMatchObject({ errorRules: ["eqeqeq", "semi"], warningRules: 1 })
    expect(eslint!.note).toBeUndefined()
  })

  test("lists oxlint's denied rules by the id its findings carry", async () => {
    const [oxlint] = await detect(
      { ".oxlintrc.json": "{}\n", "src/a.ts": "x\n" },
      {
        tool: "oxlint",
        output: '{"rules":{"no-debugger":"deny","typescript/no-explicit-any":"error","no-eval":"warn"}}',
      },
    )
    expect(oxlint).toMatchObject({ errorRules: ["no-debugger", "no-explicit-any"], warningRules: 1 })
  })

  test("parses ruff's enabled rules with their names", () => {
    expect(parseRuffSettings(RUFF_SETTINGS)).toEqual({
      errorRules: ["B006", "F401"],
      warningRules: 0,
      names: { B006: "mutable-argument-default", F401: "unused-import" },
    })
  })

  test("a listing that fails leaves errorRules null and says why", async () => {
    const [eslint] = await detect(ESLINT, { tool: "eslint", broken: true })
    expect(eslint).toMatchObject({ id: "linter/eslint", errorRules: null, warningRules: null })
    expect(eslint!.note).toBe(
      "linter/eslint: could not list the rules its config makes errors (eslint printed no config).",
    )
  })

  test("listing never runs uv: it would sync the project's environment during a dry run", async () => {
    const files = {
      "pyproject.toml": "[project]\nname = 'x'\n\n[tool.ruff.lint]\nselect = ['F']\n",
      "uv.lock": "",
      "app/a.py": "x = 1\n",
    }
    const root = await createProject(files)
    // The only tool on the PATH is a uv that records being run.
    const bin = path.join(root, "fake-bin")
    await mkdir(bin)
    await writeFile(path.join(bin, "uv"), `#!/bin/sh\ntouch "${path.join(root, "uv-ran")}"\n`)
    await chmod(path.join(bin, "uv"), 0o755)
    const saved = process.env.PATH
    process.env.PATH = `${bin}:/usr/bin:/bin`
    try {
      const [ruff] = await detectLinters(root, Object.keys(files), {
        read: (file) => readSourceFile(root, file),
        available: async (command) => command === "uv",
      })
      // Detected (uv would run it), but its rules are not listed through uv.
      expect(ruff).toMatchObject({ id: "linter/ruff", errorRules: null })
      expect(ruff!.note).toBe("linter/ruff: could not list the rules its config makes errors (ruff is not installed).")
    } finally {
      process.env.PATH = saved
    }
    expect(existsSync(path.join(root, "uv-ran"))).toBe(false)
  })

  test("gitleaks lists no rules: every finding counts", async () => {
    const [gitleaks] = await detect({ ".gitleaks.toml": "" }, { tool: "gitleaks" })
    expect(gitleaks).toMatchObject({ id: "linter/gitleaks", errorRules: null, warningRules: null })
    expect(gitleaks!.note).toBeUndefined()
  })
})

describe("sectionsNaming", () => {
  test("finds the section that names a rule, not one that names a longer rule", () => {
    const text = "# Style\n\n## Logging\nWe ban no-console-log.\n\n### Console\nSee `no-console`.\n\n## Other\n"
    expect(naming([doc("docs/style.md", text)], ["no-console"])).toEqual([
      { ruleId: "no-console", ref: "@docs/style.md#console" },
    ])
    // A scoped rule is its own token, not the bare one.
    expect(naming([doc("a.md", "# A\n@typescript-eslint/no-console\n")], ["no-console"])).toEqual([])
  })

  test("ignores a rule id inside a fenced block", () => {
    const text = "# Rules\n\n```js\n// eslint-disable-next-line eqeqeq\n```\n\n## Comparisons\nUse eqeqeq.\n"
    expect(naming([doc("docs/c.md", text)], ["eqeqeq"])).toEqual([{ ruleId: "eqeqeq", ref: "@docs/c.md#comparisons" }])
  })

  test("matches a ruff rule by its name too, and returns the code", () => {
    const text = "Intro mentions F401.\n\n# Python\n\n## Defaults\nNo mutable-argument-default, ever.\n"
    expect(naming([doc("AGENTS.md", text)], ["B006", "F401"], { B006: "mutable-argument-default" })).toEqual([
      { ruleId: "F401", ref: "@AGENTS.md" },
      { ruleId: "B006", ref: "@AGENTS.md#defaults" },
    ])
  })
})

describe("linterRule", () => {
  test("one rule per tool, with its file types and no rules list", () => {
    expect(linterRule({ tool: "eslint", id: "linter/eslint", config: "x", errorRules: [], warningRules: 0 })).toEqual({
      id: "linter/eslint",
      name: "ESLint errors",
      types_or: ["javascript", "jsx", "ts", "tsx"],
      detect: { linter: { tool: "eslint" } },
      message: "{{message}} ({{ruleId}})",
      context: [],
    })
    expect(
      linterRule({ tool: "gitleaks", id: "linter/gitleaks", config: "x", errorRules: null, warningRules: null }),
    ).not.toHaveProperty("types_or")
  })
})
