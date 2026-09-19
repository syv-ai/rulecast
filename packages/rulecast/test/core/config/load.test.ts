import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  CONFIG_FILE,
  MANIFEST_FILE,
  parseConfig,
  readConfigData,
  readManifest,
  readYamlFile,
} from "../../../src/core/config/load"
import { createProject } from "../../helpers/project"

describe("readYamlFile", () => {
  test("parses YAML; a missing file and a syntax error are messages", async () => {
    const root = await createProject({ "a.yaml": "x: 1\n", "empty.yaml": "", "bad.yaml": "x: [" })
    expect(await readYamlFile(path.join(root, "a.yaml"))).toEqual({ ok: true, value: { x: 1 } })
    expect(await readYamlFile(path.join(root, "empty.yaml"))).toEqual({ ok: true, value: null })
    expect(await readYamlFile(path.join(root, "nope.yaml"))).toEqual({ ok: false, message: "nope.yaml not found" })
    const bad = await readYamlFile(path.join(root, "bad.yaml"))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toMatch(/^bad\.yaml: /)
  })
})

describe("config", () => {
  test("readConfigData reads .rulecast-config.yaml at the root", async () => {
    const root = await createProject({ [CONFIG_FILE]: "repos:\n  - repo: local\n    rules: []\n" })
    expect(await readConfigData(root)).toEqual({ ok: true, value: { repos: [{ repo: "local", rules: [] }] } })
    expect(await readConfigData(await createProject({}))).toEqual({
      ok: false,
      message: ".rulecast-config.yaml not found",
    })
  })

  test("parseConfig validates and names the file in messages", () => {
    const valid = parseConfig({ repos: [] })
    expect(valid.ok && valid.value.maxMatchesPerRule).toBe(10)
    expect(parseConfig({ repos: [], max_matches_per_rule: -1 })).toEqual({
      ok: false,
      message: expect.stringMatching(/^\.rulecast-config\.yaml: max_matches_per_rule: /),
    })
    expect(parseConfig(null)).toEqual({ ok: false, message: expect.stringMatching(/^\.rulecast-config\.yaml: /) })
  })
})

describe("readManifest", () => {
  test("reads a list of rules", async () => {
    const dir = await createProject({ [MANIFEST_FILE]: "- id: a\n  name: A\n" })
    expect(await readManifest(dir)).toEqual({ ok: true, value: [{ id: "a", name: "A" }] })
  })

  test("a missing manifest and a non-list are messages", async () => {
    expect(await readManifest(await createProject({}))).toEqual({
      ok: false,
      message: ".rulecast-rules.yaml not found",
    })
    const dir = await createProject({ [MANIFEST_FILE]: "rules: []\n" })
    expect(await readManifest(dir)).toEqual({ ok: false, message: ".rulecast-rules.yaml: must be a list of rules" })
  })
})
