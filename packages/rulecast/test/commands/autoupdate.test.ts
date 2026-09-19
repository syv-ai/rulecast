import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { git } from "../helpers/git"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

const MANIFEST = { ".rulecast-rules.yaml": "[]\n" }

const configFor = (urls: string[]) =>
  [
    "# pinned rule repos",
    "repos:",
    ...urls.flatMap((url) => [`  - repo: ${url}`, "    rev: v1.0.0 # the catalog", "    rules: []"]),
    "  - repo: local",
    "    rules: []",
    "",
  ].join("\n")

const read = (root: string) => readFile(path.join(root, ".rulecast-config.yaml"), "utf8")

async function twoVersions(): Promise<string> {
  return createRuleRepo([
    { tag: "v1.0.0", files: MANIFEST },
    { tag: "v1.1.0", files: { ...MANIFEST, "CHANGELOG.md": "1.1\n" } },
  ])
}

describe("rulecast autoupdate", () => {
  test("moves each rev to the latest tag and keeps the rest of the file", async () => {
    const url = await twoVersions()
    const config = configFor([url])
    const root = await createProject({ ".rulecast-config.yaml": config })

    const first = await runCli(root, ["autoupdate"])
    expect(first).toMatchObject({ code: 0, stdout: `${url}: updating v1.0.0 -> v1.1.0\n` })
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", "rev: v1.1.0 # the catalog"))

    expect(await runCli(root, ["autoupdate"])).toMatchObject({ code: 0, stdout: `${url}: already up to date\n` })
  })

  test("--freeze pins the tag's commit and a plain run turns it back into the tag", async () => {
    const url = await twoVersions()
    const config = configFor([url])
    const root = await createProject({ ".rulecast-config.yaml": config })
    const sha = await git(url, "rev-parse", "v1.1.0^{commit}")

    expect((await runCli(root, ["autoupdate", "--freeze"])).stdout).toBe(
      `${url}: updating v1.0.0 -> ${sha} (frozen: v1.1.0)\n`,
    )
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", `rev: ${sha}  # frozen: v1.1.0`))
    expect((await runCli(root, ["autoupdate", "--freeze"])).stdout).toBe(`${url}: already up to date\n`)

    await runCli(root, ["autoupdate"])
    expect(await read(root)).toBe(config.replace("rev: v1.0.0 # the catalog", "rev: v1.1.0"))
  })

  test("--repo limits the update to the named repos", async () => {
    const first = await twoVersions()
    const second = await twoVersions()
    const config = configFor([first, second])
    const root = await createProject({ ".rulecast-config.yaml": config })
    expect((await runCli(root, ["autoupdate", "--repo", second])).stdout).toBe(`${second}: updating v1.0.0 -> v1.1.0\n`)
    const lines = (await read(root)).split("\n")
    expect(lines[3]).toBe("    rev: v1.0.0 # the catalog")
    expect(lines[6]).toBe("    rev: v1.1.0 # the catalog")

    const unknown = await runCli(root, ["autoupdate", "--repo", "https://example.com/nope"])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('no repo "https://example.com/nope" in .rulecast-config.yaml')
  })

  test("repos without version tags are left alone; unreachable repos fail the run", async () => {
    const untagged = await createRuleRepo([{ tag: "stable", files: MANIFEST }])
    const url = await twoVersions()
    const root = await createProject({
      ".rulecast-config.yaml": configFor(["/nonexistent/rules.git", untagged, url]),
    })
    const result = await runCli(root, ["autoupdate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("rulecast: /nonexistent/rules.git:")
    expect(result.stdout).toBe(`${untagged}: no version tags\n${url}: updating v1.0.0 -> v1.1.0\n`)
    expect(await read(root)).toContain("    rev: v1.1.0 # the catalog")
  })

  test("needs a valid config", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: nope\n" })
    const result = await runCli(root, ["autoupdate"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".rulecast-config.yaml: repos")
  })
})
