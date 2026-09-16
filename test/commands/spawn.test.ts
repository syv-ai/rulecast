import { existsSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

import { spawnDetached } from "../../src/commands/spawn"
import { createProject } from "../helpers/project"

test("a detached process keeps running after spawnDetached returns", async () => {
  const dir = await createProject({})
  const marker = path.join(dir, "done")
  const script = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"), 50)`
  spawnDetached(process.execPath, ["-e", script], dir)
  expect(existsSync(marker)).toBe(false)
  await expect.poll(() => existsSync(marker), { timeout: 5000 }).toBe(true)
})

test("a command that cannot start does not throw", async () => {
  const dir = await createProject({})
  expect(() => spawnDetached(path.join(dir, "no-such-binary"), [], dir)).not.toThrow()
})
