import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

describe("the CLI's entry", () => {
  test("loads nothing of rulecast's before it turns on the compile cache", async () => {
    const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8")
    // A static import is hoisted above the call, and the code it loads would then not be cached.
    const imports = [...source.matchAll(/^import .* from "(.+)"$/gm)].map((match) => match[1])
    expect(imports).toEqual(["node:module"])
    expect(source.indexOf("enableCompileCache")).toBeLessThan(source.indexOf('await import("./cli-main")'))
  })
})
