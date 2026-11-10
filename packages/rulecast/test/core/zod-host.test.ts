import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { z } from "zod"

import { parseConfig } from "../../src/core/config/load"
import * as errors from "../../src/core/errors"

/**
 * rulecast is also a library: a program that imports it has its own zod schemas and its own zod
 * settings. Each keeps its own wording.
 */
describe("rulecast's wording and a host program's zod", () => {
  afterEach(() => {
    z.config(z.locales.en())
  })

  test("a host's own schema keeps zod's wording after importing rulecast", async () => {
    await import("../../src/index")
    const result = z.object({ a: z.string() }).safeParse({ a: 1 })
    expect(result.error?.issues[0]?.message).toBe("Invalid input: expected string, received number")
  })

  test("a host's zod locale does not change rulecast's config errors", () => {
    z.config(z.locales.de())
    expect(parseConfig({ repos: 1 })).toEqual({
      ok: false,
      message: ".rulecast-config.yaml: repos: Expected array, received number",
    })
  })

  test("nor does a host's customError", () => {
    z.config({ customError: () => "the host's words" })
    try {
      expect(parseConfig({ repos: [], mode: "x" })).toMatchObject({
        ok: false,
        message: expect.stringContaining("mode: Invalid enum value. Expected"),
      })
    } finally {
      z.config({ customError: undefined })
    }
  })

  // A zod that keeps its settings to itself: zod 3's `zod/v4`, which the workspace has through a
  // dependency. A third-party detector could be built with one like it.
  const store = fileURLToPath(new URL("../../../../node_modules/.pnpm", import.meta.url))
  const zod3 = existsSync(store) ? readdirSync(store).find((name) => name.startsWith("zod@3.")) : undefined
  test.runIf(zod3 !== undefined)(
    "a detector schema from a zod copy of its own still gets rulecast's wording",
    async () => {
      const other = (await import(path.join(store, zod3!, "node_modules/zod/v4/index.js"))) as { z: typeof z }
      const schema = other.z.object({ mode: other.z.enum(["a", "b"]), n: other.z.number().int() }).strict()
      const parsed = await errors.parseReportedAsync(schema as unknown as z.ZodType, { mod: "a", n: 1.5 }, "detect.x")
      expect(parsed).toEqual({
        success: false,
        message:
          'detect.x: unknown key "mod" (did you mean "mode"?); detect.x.mode: required; detect.x.n: Expected integer, received float',
      })
    },
  )
})
