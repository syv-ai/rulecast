import { mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { writeFixed } from "../../src/commands/fix"

/** Run once, while the fixed text is being written to its temporary file: another writer's move. */
const race: { during: (() => Promise<void>) | null } = { during: null }

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  const patched = {
    ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args)
      const during = race.during
      if (during !== null && String(args[0]).includes(".rulecast-fix-")) {
        race.during = null
        await during()
      }
    },
  }
  return { ...patched, default: patched }
})

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

describe("writeFixed: the file changes between the check and the rename", () => {
  beforeEach(() => {
    race.during = null
  })

  test("an edit made meanwhile is kept, not replaced by the fix", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-race-"))
    await writeFile(path.join(root, "a.py"), "before\n")
    race.during = () => writeFile(path.join(root, "a.py"), "edited by someone else\n")
    expect(await writeFixed(root, "a.py", "before\n", "after\n")).toBe("a.py: changed while fixing; left unchanged")
    expect(await read(root, "a.py")).toBe("edited by someone else\n")
  })

  test("a file swapped for a symlink meanwhile is not replaced", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-race-"))
    const outside = await mkdtemp(path.join(tmpdir(), "rulecast-outside-"))
    await writeFile(path.join(outside, "b.py"), "before\n")
    await writeFile(path.join(root, "a.py"), "before\n")
    race.during = async () => {
      await rename(path.join(root, "a.py"), path.join(root, "old.py"))
      await symlink(path.join(outside, "b.py"), path.join(root, "a.py"))
    }
    expect(await writeFixed(root, "a.py", "before\n", "after\n")).toBe("a.py: changed while fixing; left unchanged")
    expect(await read(root, "a.py")).toBe("before\n")
    expect(await readFile(path.join(outside, "b.py"), "utf8")).toBe("before\n")
  })
})
