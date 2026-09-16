import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/compile"
import { createRegistry } from "../../../src/core/detection/registry"
import type { Detector } from "../../../src/core/types"
import { createProject } from "../../helpers/project"

const fake: Detector<{ capture?: string }> = {
  kind: "fake",
  schema: z.object({ capture: z.string().optional() }).strict(),
  captures: (config) => (config.capture ? [config.capture] : []),
  events: () => ["edit", "verify"],
  run: async () => ({ findings: [], errors: [] }),
}

const registry = createRegistry([fake])

const conventions = "# API\n\n## Errors\nMap them.\n"

async function compileRules(rules: Record<string, string>, extra: Record<string, string> = {}) {
  const root = await createProject({ "conventions/api.md": conventions, ...extra, ...rules })
  return compile(root, registry)
}

describe("compile", () => {
  test("compiles a valid rule", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": [
        "id: api/a",
        "files: src/**/*.tsx",
        "ignore: ['**/*.test.tsx']",
        "detect: { fake: { capture: NAMES } }",
        "message: '{{file}}:{{line}} {{NAMES}}'",
        "context: ['@conventions/api.md#errors', { path: '@conventions/api.md', mode: read }]",
      ].join("\n"),
    })
    expect(project.diagnostics).toEqual([])
    const [rule] = project.rules
    expect(rule).toMatchObject({
      id: "api/a",
      source: ".rulecast/rules/a.yml",
      severity: "error",
      on: ["violation"],
      message: "{{file}}:{{line}} {{NAMES}}",
      detector: { kind: "fake", config: { capture: "NAMES" }, captures: ["NAMES"], events: ["edit", "verify"] },
      context: [
        { ref: "conventions/api.md#errors", path: "conventions/api.md", anchor: "errors", mode: "inject" },
        { ref: "conventions/api.md", path: "conventions/api.md", anchor: null, mode: "read" },
      ],
    })
    expect(rule!.matches("src/components/Card.tsx")).toBe(true)
    expect(rule!.matches("src/components/Card.test.tsx")).toBe(false)
    expect(rule!.matches("backend/app.py")).toBe(false)
  })

  test("a rule's events override the detector's", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": "id: a\nfiles: '**'\ndetect: { fake: {} }\nmessage: m\nevents: [verify]",
    })
    expect(project.rules[0]!.detector!.events).toEqual(["verify"])
  })

  test("touch-only rules need context but no detector", async () => {
    const project = await compileRules({
      ".rulecast/rules/ok.yml": "id: ok\nfiles: '**'\non: [touch]\ncontext: ['@conventions/api.md']",
      ".rulecast/rules/bad.yml": "id: bad\nfiles: '**'\non: [touch]",
    })
    expect(project.rules.map((rule) => rule.id)).toEqual(["ok"])
    expect(project.rules[0]!.detector).toBeNull()
    expect(project.diagnostics).toEqual([
      { source: ".rulecast/rules/bad.yml", rule: "bad", message: "rules with on: [touch] only need context" },
    ])
  })

  test("reports each problem as a diagnostic and excludes the rule", async () => {
    const project = await compileRules({
      ".rulecast/rules/1.yml": "id: no-detect\nfiles: '**'\nmessage: m",
      ".rulecast/rules/2.yml": "id: no-message\nfiles: '**'\ndetect: { fake: {} }",
      ".rulecast/rules/3.yml": "id: unknown-detector\nfiles: '**'\ndetect: { nope: {} }\nmessage: m",
      ".rulecast/rules/4.yml": "id: bad-config\nfiles: '**'\ndetect: { fake: { colour: 1 } }\nmessage: m",
      ".rulecast/rules/5.yml": "id: bad-variable\nfiles: '**'\ndetect: { fake: {} }\nmessage: '{{reason}}'",
      ".rulecast/rules/6.yml": "id: missing-file\nfiles: '**'\non: [touch]\ncontext: ['@conventions/nope.md']",
      ".rulecast/rules/7.yml": "id: missing-anchor\nfiles: '**'\non: [touch]\ncontext: ['@conventions/api.md#nope']",
      ".rulecast/rules/8.yml": "id: bad-syntax\nfiles: '**'\non: [touch]\ncontext: ['conventions/api.md']",
      ".rulecast/rules/9.yml": "id: [",
      ".rulecast/rules/10.yml": "files: '**'",
    })
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => [d.source, d.rule, d.message])).toEqual([
      [".rulecast/rules/1.yml", "no-detect", "rules with on: violation need detect and message"],
      [".rulecast/rules/10.yml", null, "id: Required"],
      [".rulecast/rules/2.yml", "no-message", "rules with on: violation need detect and message"],
      [".rulecast/rules/3.yml", "unknown-detector", 'unknown detector "nope"'],
      [".rulecast/rules/4.yml", "bad-config", "detect.fake: (root): Unrecognized key(s) in object: 'colour'"],
      [".rulecast/rules/5.yml", "bad-variable", 'unknown template variable "reason"'],
      [".rulecast/rules/6.yml", "missing-file", "referenced file not found: conventions/nope.md"],
      [".rulecast/rules/7.yml", "missing-anchor", 'anchor "#nope" not found in conventions/api.md'],
      [".rulecast/rules/8.yml", "bad-syntax", 'reference "conventions/api.md" must start with "@"'],
      [".rulecast/rules/9.yml", null, expect.stringContaining("")],
    ])
  })

  test("duplicate ids exclude every rule with that id", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": "id: dup\nfiles: '**'\ndetect: { fake: {} }\nmessage: m",
      ".rulecast/rules/b.yml": "id: dup\nfiles: '**'\ndetect: { fake: {} }\nmessage: m",
    })
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => d.message)).toEqual([
      'duplicate rule id "dup" (also in .rulecast/rules/b.yml)',
      'duplicate rule id "dup" (also in .rulecast/rules/a.yml)',
    ])
  })

  test("an invalid config disables all rules", async () => {
    const project = await compileRules(
      { ".rulecast/rules/a.yml": "id: a\nfiles: '**'\ndetect: { fake: {} }\nmessage: m" },
      { ".rulecast/config.yml": "maxMatchesPerRule: -1" },
    )
    expect(project.rules).toEqual([])
    expect(project.diagnostics).toEqual([
      { source: ".rulecast/config.yml", rule: null, message: expect.stringContaining("maxMatchesPerRule") },
    ])
  })
})
