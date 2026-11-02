import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { VERSION } from "../src/core/version"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8")
const json = (file: string) => JSON.parse(read(file)) as Record<string, unknown>

const SKILL = "plugins/rulecast/skills/add-rule/SKILL.md"
const LINK = /https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/([^/\s]+)\/([^\s)"'`#>]+)/g

describe("the Claude Code plugin", () => {
  test("the marketplace lists the plugin at a directory that exists", () => {
    const marketplace = json(".claude-plugin/marketplace.json") as { plugins: { name: string; source: string }[] }
    const entry = marketplace.plugins.find((plugin) => plugin.name === "rulecast")
    expect(entry).toBeDefined()
    expect(existsSync(path.join(repoRoot, entry!.source, ".claude-plugin/plugin.json"))).toBe(true)
  })

  test("the plugin's version is the CLI's, so the marketplace offers an update with each release", () => {
    expect(json("plugins/rulecast/.claude-plugin/plugin.json").version).toBe(VERSION)
  })

  test("the skill links to agent docs at this version's tag, and the docs exist", () => {
    const links = [...read(SKILL).matchAll(LINK)]
    expect(links.length).toBeGreaterThan(0)
    for (const [url, ref, file] of links) {
      expect(ref, url).toBe(`v${VERSION}`)
      expect(existsSync(path.join(repoRoot, file!)), url).toBe(true)
    }
  })

  test("the skill takes the developer's words as its argument and is only run when asked for", () => {
    const skill = read(SKILL)
    expect(skill).toContain("$ARGUMENTS")
    expect(skill).toMatch(/^disable-model-invocation: true$/m)
  })
})
