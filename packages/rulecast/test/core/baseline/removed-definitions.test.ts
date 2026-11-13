import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { removedDefinitions } from "../../../src/core/baseline/removed-definitions"
import { createRepo, git } from "../../helpers/git"

describe("removedDefinitions (#72)", () => {
  test("definitions gone from changed and deleted files, not those kept or moved within a file", async () => {
    const root = await createRepo({
      "a.py": "class Order:\n    pass\n\ndef total():\n    return 1\n",
      "b.ts": "export interface Cart {}\nexport function price() {}\nconst x = 1\n",
      "c.go": "func Old() {}\n",
    })
    const head = (await git(root, "rev-parse", "HEAD")).trim()
    await writeFile(path.join(root, "a.py"), "def total():\n    return 1\n")
    await writeFile(path.join(root, "b.ts"), "export function price() {}\n")
    await rm(path.join(root, "c.go"))
    await writeFile(path.join(root, "new.py"), "class Order:\n    pass\n")
    const read = async (file: string) => readFile(path.join(root, file), "utf8").catch(() => null)
    expect(await removedDefinitions(root, ["new.py", "c.go", "b.ts", "a.py"], head, read)).toEqual([
      { file: "a.py", line: "class Order:" },
      { file: "b.ts", line: "export interface Cart {}" },
      { file: "b.ts", line: "const x = 1" },
      { file: "c.go", line: "func Old() {}" },
    ])
  })
})
