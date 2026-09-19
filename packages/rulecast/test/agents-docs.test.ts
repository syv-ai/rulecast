import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { sectionRange } from "../src/core/anchors"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const DOCS = [
  "agents/SETUP.md",
  "agents/DRAFT-RULES.md",
  "agents/reference/rule-format.md",
  "agents/reference/detectors.md",
]

const FENCE = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const REPOSITORY_URL =
  /https:\/\/(?:raw\.githubusercontent\.com\/syv-ai\/rulecast|github\.com\/syv-ai\/rulecast\/blob)\/[^/\s]+\/([^\s)"'`#>]+)/g

/** Repository paths that rulecast's raw and blob URLs in `text` point at; the ref segment can be anything, such as a template placeholder. */
function repositoryPaths(text: string): string[] {
  return [...text.matchAll(REPOSITORY_URL)].map((match) => match[1]!)
}

async function filesUnder(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(path.join(repoRoot, dir), { recursive: true })
  return entries
    .filter((entry) => entry.endsWith(extension))
    .map((entry) => path.join(repoRoot, dir, entry))
    .sort()
}

describe("agent docs", () => {
  test("exist", () => {
    for (const doc of DOCS) expect(existsSync(path.join(repoRoot, doc)), doc).toBe(true)
  })

  test("relative links resolve to files and headings in the repository", async () => {
    const failures: string[] = []
    let checked = 0
    for (const file of await filesUnder("agents", ".md")) {
      const text = (await readFile(file, "utf8")).replace(FENCE, "")
      for (const [, href] of text.matchAll(LINK)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href!)) continue
        checked++
        const [target = "", anchor] = href!.split("#")
        const resolved = target === "" ? file : path.resolve(path.dirname(file), target)
        const where = `${path.relative(repoRoot, file)} → ${href}`
        if (!resolved.startsWith(repoRoot) || !existsSync(resolved)) {
          failures.push(`${where}: no such file`)
        } else if (anchor && /\.mdx?$/.test(resolved) && !sectionRange(await readFile(resolved, "utf8"), anchor)) {
          failures.push(`${where}: no such heading`)
        }
      }
    }
    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test("repositoryPaths finds raw and blob URLs", () => {
    const text = [
      "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md and",
      "https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md#regex, not",
      "https://github.com/syv-ai/rulecast or `https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/SETUP.md`.",
    ].join("\n")
    expect(repositoryPaths(text)).toEqual(["agents/DRAFT-RULES.md", "agents/reference/detectors.md", "agents/SETUP.md"])
  })

  test("every rulecast repository URL in agents/ and src/ points at a file in the repository", async () => {
    const files = [...(await filesUnder("agents", ".md")), ...(await filesUnder("packages/rulecast/src", ".ts"))]
    const failures: string[] = []
    for (const file of files) {
      for (const target of repositoryPaths(await readFile(file, "utf8"))) {
        if (!existsSync(path.join(repoRoot, target))) failures.push(`${path.relative(repoRoot, file)} → ${target}`)
      }
    }
    expect(failures).toEqual([])
  })
})
