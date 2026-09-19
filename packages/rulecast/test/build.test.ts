import { execFile, spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createFixture } from "./helpers/fixture"
import { TEST_HOME } from "./helpers/home"
import { claudeCodePayload } from "./helpers/payloads"

const exec = promisify(execFile)
const cli = path.resolve("dist/cli.js")
const env = { ...process.env, RULECAST_HOME: TEST_HOME }

beforeAll(async () => {
  await exec("pnpm", ["build"])
}, 60_000)

test("built CLI runs rulecast run in a project", async () => {
  const root = await createFixture()
  const failure = await exec("node", [cli, "run", "--all-files", "--format", "agent"], { cwd: root, env }).catch(
    (error) => error,
  )
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("rulecast: 2 rules violated")
  expect(failure.stdout).toContain("--- conventions/backend.md#errors ---")
}, 30_000)

test("built CLI answers a Claude Code edit hook", async () => {
  const root = await createFixture()
  await writeFile(
    path.join(root, "app/services/users.py"),
    "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n",
  )
  const payload = claudeCodePayload("post-tool-use.edit", { root, file: "app/services/users.py", sessionId: "s1" })
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain("raises HTTPException(500)")
}, 30_000)
