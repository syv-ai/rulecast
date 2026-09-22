import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { packageReadme, README_HEADER } from "../../scripts/readme"

const packageDir = fileURLToPath(new URL("../../", import.meta.url))

describe("the package README", () => {
  test("is the repository README with a generated-by header", async () => {
    const generated = await packageReadme()
    expect(generated.startsWith(README_HEADER)).toBe(true)
    expect(generated).toContain("# rulecast")
  })

  test("the committed copy is current", async () => {
    const committed = await readFile(path.join(packageDir, "README.md"), "utf8")
    expect(committed, "packages/rulecast/README.md is stale: run pnpm readme").toBe(await packageReadme())
  })
})
