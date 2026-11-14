import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { sectionRange } from "../src/core/anchors"
import { gitHookCommand, INSTALL_COMMAND } from "../src/core/binary-home"

describe("the install docs", () => {
  test("README and SETUP.md show the install command", async () => {
    for (const file of ["README.md", "agents/SETUP.md"]) {
      expect(await readFile(path.join(repoRoot, file), "utf8"), file).toContain(INSTALL_COMMAND)
    }
  })

  test("no doc points at the old install: the cache home's bin, or rulecast binary", async () => {
    const files = [
      path.join(repoRoot, "README.md"),
      ...(await filesUnder("guides", ".md")),
      ...(await filesUnder("agents", ".md")).filter((file) => !file.includes(`${path.sep}lenses${path.sep}`)),
      ...(await filesUnder("agents", ".html")),
      ...(await filesUnder("plugins", ".md")),
    ]
    const stale: string[] = []
    for (const file of files) {
      const text = await readFile(file, "utf8")
      for (const old of [".cache/rulecast/bin", "rulecast binary", "binary install"]) {
        if (text.includes(old)) stale.push(`${path.relative(repoRoot, file)}: ${old}`)
      }
    }
    expect(stale).toEqual([])
  })

  test("the Git hooks guide's lefthook snippet runs rulecast as the agent hooks find it", async () => {
    const readme = await readFile(path.join(repoRoot, "guides/git-hooks-ci.md"), "utf8")
    const lefthook = readme.slice(readme.indexOf("## lefthook"), readme.indexOf("## GitHub Actions"))
    expect(lefthook).toContain(`run: ${gitHookCommand("run --quiet")}\n`)
    expect(lefthook).toContain(
      `run: ${gitHookCommand('run --quiet --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD')}\n`,
    )
    expect(readme).not.toContain("npx --no-install")
  })
})

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const DOCS = [
  "agents/SETUP.md",
  "agents/CONVENTIONS.md",
  "agents/DRAFT-RULES.md",
  "agents/reference/rule-format.md",
  "agents/reference/detectors.md",
  "agents/reference/tool-recipes.md",
  "agents/reference/output.md",
  "agents/reference/stats.md",
  "agents/reference/loops.md",
]

const FENCE = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const REPOSITORY_URL =
  /https:\/\/(?:raw\.githubusercontent\.com\/syv-ai\/rulecast|github\.com\/syv-ai\/rulecast\/blob)\/[^/\s]+\/([^\s)"'`#>]+)/g

/** Repository paths that rulecast's raw and blob URLs in `text` point at; the ref segment can be anything, such as a template placeholder. */
function repositoryPaths(text: string): string[] {
  return [...text.matchAll(REPOSITORY_URL)].map((match) => match[1]!)
}

const REPOSITORY_REF =
  /https:\/\/(?:raw\.githubusercontent\.com\/syv-ai\/rulecast|github\.com\/syv-ai\/rulecast\/blob)\/([^/\s]+)\//g

/** The ref segment of every rulecast raw or blob URL in `text`. */
function repositoryRefs(text: string): string[] {
  return [...text.matchAll(REPOSITORY_REF)].map((match) => match[1]!)
}

/** A tag, or a placeholder something fills in at run time. Not a branch. */
const PINNABLE = /^(v\d+\.\d+\.\d+|<[a-z]+>|\$\{[A-Za-z_$][\w$]*\}|%s)$/

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

  test("SETUP.md, CONVENTIONS.md and both pages tell the agent to write < as the literal escape \\u003c", async () => {
    // An edit that decodes the escape leaves "write every < as <", which tells the agent nothing.
    for (const file of [
      "agents/SETUP.md",
      "agents/setup-page.html",
      "agents/CONVENTIONS.md",
      "agents/conventions-review.html",
    ]) {
      const text = await readFile(path.join(repoRoot, file), "utf8")
      expect(text, file).toContain("\\u003c")
    }
  })

  test("repositoryPaths finds raw and blob URLs", () => {
    const text = [
      "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md and",
      "https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md#regex, not",
      "https://github.com/syv-ai/rulecast or `https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/SETUP.md`.",
    ].join("\n")
    expect(repositoryPaths(text)).toEqual(["agents/DRAFT-RULES.md", "agents/reference/detectors.md", "agents/SETUP.md"])
  })

  test("no rulecast repository URL is pinned to a branch", async () => {
    // A URL on `main` resolves only as long as main still has that file; a tag resolves forever,
    // and the agent docs are versioned by tag (spec §12). Placeholders are fine — whatever fills
    // them in supplies the tag.
    // README.md and the plugin's skills too: any repository URL it hands developers must be pinned. (Its paste-this prompt
    // names the docs site's copy of agents/SETUP.md instead, which the site builds from the latest
    // release tag — packages/site/scripts/content-from.ts.) Only the root one — the package copy's relative links are rewritten to
    // blob/main/ by pnpm readme, which is a different thing and not a doc reference.
    const files = [
      path.join(repoRoot, "README.md"),
      ...(await filesUnder("guides", ".md")),
      ...(await filesUnder("agents", ".md")),
      ...(await filesUnder("plugins", ".md")),
      ...(await filesUnder("packages/rulecast/src", ".ts")),
    ]
    const failures: string[] = []
    let checked = 0
    for (const file of files) {
      for (const ref of repositoryRefs(await readFile(file, "utf8"))) {
        checked++
        if (!PINNABLE.test(ref)) failures.push(`${path.relative(repoRoot, file)} → pinned to "${ref}"`)
      }
    }
    expect(failures).toEqual([])
    expect(checked, "no rulecast URL found at all — has the regex drifted?").toBeGreaterThan(0)
  })

  test("repositoryRefs reads the ref segment, and only a tag or a placeholder passes", () => {
    const text = [
      "https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md",
      `https://raw.githubusercontent.com/syv-ai/rulecast/\${tag}/agents/SETUP.md`,
      "https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md",
    ].join("\n")
    expect(repositoryRefs(text)).toEqual(["v0.2.0", `\${tag}`, "main"])
    expect(repositoryRefs(text).filter((ref) => !PINNABLE.test(ref))).toEqual(["main"])
  })

  test("every rulecast repository URL in agents/ and src/ points at a file in the repository", async () => {
    const files = [
      ...(await filesUnder("agents", ".md")),
      ...(await filesUnder("plugins", ".md")),
      ...(await filesUnder("packages/rulecast/src", ".ts")),
    ]
    const failures: string[] = []
    for (const file of files) {
      for (const target of repositoryPaths(await readFile(file, "utf8"))) {
        if (!existsSync(path.join(repoRoot, target))) failures.push(`${path.relative(repoRoot, file)} → ${target}`)
      }
    }
    expect(failures).toEqual([])
  })
})
