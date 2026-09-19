import { existsSync, mkdtempSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { projectStateDir } from "../../src/core/home"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { createProject } from "../helpers/project"

/** A home of its own: cleaning must not remove the test file's shared home. */
function freshHome(): { home: string; env: { RULECAST_HOME: string } } {
  const home = mkdtempSync(path.join(tmpdir(), "rulecast-clean-"))
  return { home, env: { RULECAST_HOME: home } }
}

describe("rulecast clean", () => {
  test("--project removes only the project's directory", async () => {
    const { home, env } = freshHome()
    const root = await createFixture()
    await runCli(root, ["run", "--all-files"], "", env)
    const project = projectStateDir(home, root)
    expect(existsSync(project)).toBe(true)
    await mkdir(path.join(home, "repos", "keep"), { recursive: true })

    expect(await runCli(root, ["clean", "--project"], "", env)).toMatchObject({
      code: 0,
      stdout: `removed ${project}\n`,
    })
    expect(existsSync(project)).toBe(false)
    expect(existsSync(path.join(home, "repos", "keep"))).toBe(true)
    expect(await runCli(root, ["clean", "--project"], "", env)).toMatchObject({ code: 0, stdout: "nothing to clean\n" })
  })

  test("without flags removes the whole cache", async () => {
    const { home, env } = freshHome()
    const root = await createFixture()
    await runCli(root, ["run", "--all-files"], "", env)
    expect(await runCli(root, ["clean"], "", env)).toMatchObject({ code: 0, stdout: `removed ${home}\n` })
    expect(existsSync(home)).toBe(false)
    expect(await runCli(root, ["clean"], "", env)).toMatchObject({ code: 0, stdout: "nothing to clean\n" })
  })

  test("--project needs a project", async () => {
    const { env } = freshHome()
    const result = await runCli(await createProject({}), ["clean", "--project"], "", env)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
  })
})
