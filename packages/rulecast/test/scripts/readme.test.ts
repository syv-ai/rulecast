import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { absoluteLinks, packageReadme, README_HEADER } from "../../scripts/readme"
import { run } from "../helpers/script"

const packageDir = fileURLToPath(new URL("../../", import.meta.url))

describe("the package README", () => {
  test("is the repository README, under a generated-by header, with absolute links", async () => {
    const root = await readFile(path.join(packageDir, "../../README.md"), "utf8")
    expect(await packageReadme()).toBe(README_HEADER + absoluteLinks(root))
  })

  test("relative links become absolute, and nothing else is touched", () => {
    // npmjs.com resolves relative links against packages/rulecast/, where none of these exist.
    expect(absoluteLinks("see [setup](agents/SETUP.md) and [x](LICENSE)")).toBe(
      "see [setup](https://github.com/syv-ai/rulecast/blob/main/agents/SETUP.md) and " +
        "[x](https://github.com/syv-ai/rulecast/blob/main/LICENSE)",
    )
    expect(absoluteLinks("[a](https://example.invalid/x) [b](#anchor)")).toBe(
      "[a](https://example.invalid/x) [b](#anchor)",
    )
  })

  test("the published README has no relative link left", async () => {
    const relative = [...(await packageReadme()).matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map((m) => m[1])
    expect(relative).toEqual([])
  })

  test("--check exits 1 when the copy is stale, and 0 when it is not", async () => {
    const script = path.join(packageDir, "scripts/readme.ts")
    await expect(run(script)).resolves.toBe(0)
    const target = path.join(packageDir, "README.md")
    const original = await readFile(target, "utf8")
    try {
      await writeFile(target, `${original}stale\n`)
      await expect(run(script)).resolves.toBe(1)
    } finally {
      await writeFile(target, original)
    }
    await expect(run(script)).resolves.toBe(0)
  })

  test("the committed copy is current", async () => {
    const committed = await readFile(path.join(packageDir, "README.md"), "utf8")
    expect(committed, "packages/rulecast/README.md is stale: run pnpm readme").toBe(await packageReadme())
  })
})
