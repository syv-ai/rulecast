import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"

const NO_TODO = {
  id: "no-todo",
  name: "No TODO",
  stages: ["verify"],
  detect: { regex: { pattern: "TODO" } },
  message: "{{file}}: TODO",
}

const NO_AI_TRAILERS = {
  id: "commits/no-ai-trailers",
  name: "No AI co-sign trailers",
  stages: ["commit-msg"],
  detect: { regex: { pattern: "^co-authored-by:.*\\bclaude\\b.*$", flags: "im" } },
  message: "{{file}}:{{line}}: AI co-sign trailer",
}

/** The git hooks run `rulecast run --quiet`: a clean commit says nothing, anything else is said as without it. */
describe("rulecast run --quiet", () => {
  const stage = async (root: string, file: string, text: string) => {
    await writeFile(path.join(root, file), text)
    await git(root, "add", file)
  }

  test("a clean staged run prints nothing; without --quiet it says what it checked", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([NO_TODO]) })
    await stage(root, "a.txt", "fine\n")
    const quiet = await runCli(root, ["run", "--quiet"])
    expect(quiet.code).toBe(0)
    expect(quiet.stdout).toBe("")
    expect((await runCli(root, ["run"])).stdout).toContain("no findings")
  })

  test("findings, warnings included, and an incomplete run are printed as without it", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        NO_TODO,
        { ...NO_TODO, id: "no-fixme", severity: "warning", detect: { regex: { pattern: "FIXME" } } },
      ]),
    })
    await stage(root, "a.txt", "TODO\n")
    const error = await runCli(root, ["run", "--quiet"])
    expect(error.code).toBe(1)
    expect(error.stdout).toContain("no-todo")
    await stage(root, "a.txt", "FIXME\n")
    const warning = await runCli(root, ["run", "--quiet"])
    expect(warning.code).toBe(0)
    expect(warning.stdout).toContain("no-fixme")

    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([{ ...NO_TODO, detect: { regex: { pattern: "(?i)x" } } }]),
    )
    const incomplete = await runCli(root, ["run", "--quiet"])
    expect(incomplete.code).toBe(3)
    expect(incomplete.stdout).not.toBe("")
  })

  test("--commit-msg --quiet: a clean message prints nothing, a finding is printed", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([NO_AI_TRAILERS]) })
    await writeFile(path.join(root, "msg.txt"), "fix\n")
    expect((await runCli(root, ["run", "--commit-msg", "msg.txt", "--quiet"])).stdout).toBe("")
    await writeFile(path.join(root, "msg.txt"), "fix\n\nCo-Authored-By: Claude\n")
    const bad = await runCli(root, ["run", "--commit-msg", "msg.txt", "--quiet"])
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain("commits/no-ai-trailers")
  })

  test("is for the terminal and agent formats: a machine format is never empty", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([NO_TODO]) })
    for (const format of ["json", "sarif"]) {
      const result = await runCli(root, ["run", "--quiet", "--format", format])
      expect(result.code, format).toBe(2)
      expect(result.stderr, format).toContain("--quiet")
    }
  })

  test("fix and try-repo refuse it rather than ignore it", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([NO_TODO]) })
    for (const args of [
      ["fix", "--all-files", "--quiet"],
      ["try-repo", ".", "--quiet"],
    ]) {
      const result = await runCli(root, args)
      expect(result.code, args[0]).toBe(2)
      expect(result.stderr, args[0]).toContain("--quiet")
    }
  })
})
