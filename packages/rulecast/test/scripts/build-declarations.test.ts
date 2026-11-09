import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { rewriteSpecifiers } from "../../scripts/build-declarations"

describe("rewriteSpecifiers", () => {
  const dist = async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-dts-"))
    await mkdir(path.join(root, "core"))
    await writeFile(path.join(root, "types.d.ts"), "")
    await writeFile(path.join(root, "core", "index.d.ts"), "")
    return root
  }

  test("a file gains .js and a directory gains /index.js, in every import form", async () => {
    const root = await dist()
    const text = [
      'export { a } from "./types";',
      "import type { b } from './core';",
      'export type C = import("./types").C;',
    ].join("\n")
    const found: string[] = []
    expect(rewriteSpecifiers(text, path.join(root, "index.d.ts"), (file) => found.push(file))).toBe(
      [
        'export { a } from "./types.js";',
        "import type { b } from './core/index.js';",
        'export type C = import("./types.js").C;',
      ].join("\n"),
    )
    expect(found).toEqual([
      path.join(root, "types.d.ts"),
      path.join(root, "core/index.d.ts"),
      path.join(root, "types.d.ts"),
    ])
  })

  test("packages are left alone", async () => {
    const root = await dist()
    expect(rewriteSpecifiers('import { z } from "zod";', path.join(root, "index.d.ts"))).toBe(
      'import { z } from "zod";',
    )
  })

  test("an import with no declaration behind it fails the build", async () => {
    const root = await dist()
    expect(() => rewriteSpecifiers('export * from "./gone";', path.join(root, "index.d.ts"))).toThrow(/no declaration/)
  })
})
