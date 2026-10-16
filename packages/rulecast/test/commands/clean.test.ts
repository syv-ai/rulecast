import { existsSync, mkdtempSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { projectStateDir } from "../../src/core/home"
import { FINDINGS_LOG } from "../../src/core/stats/log"
import { runCli } from "../helpers/cli"
import { createFixture, fixtureFiles } from "../helpers/fixture"
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

  test("--project removes the findings log an agent session wrote", async () => {
    const { home, env } = freshHome()
    const root = await createFixture()
    const file = "app/services/users.py"
    await writeFile(path.join(root, file), `${fixtureFiles[file]}    raise HTTPException(500)\n`)
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: root,
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, file) },
    })
    await runCli(root, ["hook", "claude-code"], payload, env)
    const log = path.join(projectStateDir(home, root), FINDINGS_LOG)
    expect(existsSync(log)).toBe(true)
    expect((await runCli(root, ["clean", "--project"], "", env)).code).toBe(0)
    expect(existsSync(log)).toBe(false)
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
