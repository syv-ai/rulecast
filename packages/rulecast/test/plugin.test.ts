import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { VERSION } from "../src/core/version"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8")
const json = (file: string) => JSON.parse(read(file)) as Record<string, unknown>

const SKILL = "plugins/rulecast/skills/add-rule/SKILL.md"
const frontmatter = (file: string) => {
  const [, head = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(read(file)) ?? []
  return { meta: parse(head) as Record<string, string>, body }
}
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

  test("the skill takes the developer's words as its argument, and the model may start it", () => {
    const skill = read(SKILL)
    expect(skill).toContain("$ARGUMENTS")
    // The model may suggest a rule; changing one is the developer's call, which the skill asks for.
    expect(skill).not.toMatch(/^disable-model-invocation: true$/m)
  })

  test("the skill's listing fits Claude Code's cap", () => {
    const { meta } = frontmatter(SKILL)
    // Claude Code keeps description + when_to_use in context and truncates them at 1,536 characters.
    expect(meta.description!.length + meta.when_to_use!.length).toBeLessThanOrEqual(1536)
  })

  test("after a correction the agent offers, and starts the skill only on a yes", () => {
    const { when_to_use } = frontmatter(SKILL).meta
    expect(when_to_use).toMatch(/do not start this skill/)
    expect(when_to_use).toMatch(/only after a yes/)
    expect(when_to_use).toMatch(/never again after a no/)
    expect(when_to_use).toMatch(/at most once per reply/)
  })

  test("a yes to an offer is not asked again", () => {
    const { body } = frontmatter(SKILL)
    expect(body).toContain("## If you were not asked")
    expect(body).toMatch(/Do not ask again whether they want a rule/)
  })
})
