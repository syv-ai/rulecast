import { execFile, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createCatalogRepo } from "./helpers/catalog"
import { createFixture } from "./helpers/fixture"
import { createRepo } from "./helpers/git"
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

test("built CLI runs init --yes and keeps @clack/prompts out of its entry", async () => {
  const root = await createRepo({ "app/services/users.py": "x = 1\n", "CLAUDE.md": "# Project\n" })
  const catalog = await createCatalogRepo()
  const result = spawnSync(process.execPath, [cli, "init", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, RULECAST_CATALOG: catalog },
  })
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(existsSync(path.join(root, ".rulecast-config.yaml"))).toBe(true)
  expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(true)
  expect(result.stdout).toContain("from CLAUDE.md.")
  // The prompter is a separate chunk (Decision 2): hooks never load it. The entry only reaches it
  // through the dynamic import, so @clack/prompts is imported from that chunk and never from cli.js.
  // Static `from "x"` and dynamic `import("x")`.
  const imports = (file: string) =>
    [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1]!)
  expect(imports(cli)).not.toContain("@clack/prompts")
  const chunk = imports(cli).find((specifier) => /^\.\/clack-\w+\.js$/.test(specifier))
  expect(chunk, "cli.js dynamically imports the clack chunk").toBeDefined()
  expect(imports(path.join(path.dirname(cli), chunk!))).toContain("@clack/prompts")
}, 60_000)
