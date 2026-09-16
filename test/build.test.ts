import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createFixture } from "./helpers/fixture"

const exec = promisify(execFile)
const cli = path.resolve("dist/cli.js")

beforeAll(async () => {
  await exec("pnpm", ["build"])
}, 60_000)

test("built CLI runs check in a project", async () => {
  const root = await createFixture()
  const failure = await exec("node", [cli, "check", "--format", "agent"], { cwd: root }).catch((error) => error)
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("rulecast: 2 rules violated")
  expect(failure.stdout).toContain("--- conventions/backend.md#errors ---")
}, 30_000)
