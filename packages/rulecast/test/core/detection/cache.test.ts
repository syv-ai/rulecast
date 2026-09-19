import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { diskCache, memoryCache } from "../../../src/core/detection/cache"

describe.each([
  ["memory", async () => memoryCache()],
  ["disk", async () => diskCache(path.join(await mkdtemp(path.join(tmpdir(), "rulecast-cache-")), "regex"))],
])("%s cache", (_, create) => {
  test("returns undefined for unknown keys and round-trips JSON values", async () => {
    const cache = await create()
    expect(await cache.get("missing")).toBeUndefined()
    await cache.set("key:with/odd chars", { lines: [1, 2], ok: true })
    expect(await cache.get("key:with/odd chars")).toEqual({ lines: [1, 2], ok: true })
  })

  test("returned values are copies", async () => {
    const cache = await create()
    await cache.set("k", { list: [1] })
    const value = await cache.get<{ list: number[] }>("k")
    value!.list.push(2)
    expect(await cache.get("k")).toEqual({ list: [1] })
  })
})

test("disk cache leaves no temporary files", async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-cache-")), "regex")
  const cache = diskCache(dir)
  await Promise.all([cache.set("a", 1), cache.set("a", 2), cache.set("b", 3)])
  expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([])
})
