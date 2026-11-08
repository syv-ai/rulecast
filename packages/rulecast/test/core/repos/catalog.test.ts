import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { createRegistry } from "../../../src/core/detection/registry"
import { loadCatalog } from "../../../src/core/repos/catalog"
import { builtinDetectors } from "../../../src/detectors"
import { createCatalogRepo } from "../../helpers/catalog"

const registry = createRegistry([...builtinDetectors])
const options = { tagsTimeoutMs: 5000, cachedFallback: true }
let source: string

beforeAll(async () => {
  source = await createCatalogRepo()
}, 30_000)

const temp = () => mkdtemp(path.join(tmpdir(), "rulecast-catalog-"))

describe("loadCatalog offline", () => {
  test("an unreachable file:// catalog falls back to the newest cached tag, and says so", async () => {
    const home = await temp()
    const dir = path.join(await temp(), "catalog.git")
    await cp(source, dir, { recursive: true })
    const url = `file://${dir}`
    const online = await loadCatalog(url, undefined, home, registry, options)
    expect(typeof online === "string" ? online : online.rev).toBe("v0.2.0")
    expect(typeof online === "string" ? null : online.offline).toBeUndefined()

    await rm(dir, { recursive: true, force: true })
    const offline = await loadCatalog(url, undefined, home, registry, options)
    if (typeof offline === "string") throw new Error(offline)
    expect(offline.rev).toBe("v0.2.0")
    expect(offline.rules.some((rule) => rule.id === "generated-code")).toBe(true)
    expect(offline.offline).toMatch(/could not be reached \(.+\); using the cached v0\.2\.0$/)
  })

  test("with nothing cached, an unreachable catalog is an error", async () => {
    const home = await temp()
    const url = `file://${path.join(await temp(), "missing.git")}`
    expect(typeof (await loadCatalog(url, undefined, home, registry, options))).toBe("string")
    // Without the fallback, a cached tag is not used either.
    expect(typeof (await loadCatalog(url, undefined, home, registry))).toBe("string")
  })
})
