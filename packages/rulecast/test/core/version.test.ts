import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

import { isOlder, parseVersion, VERSION } from "../../src/core/version"

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
  expect(VERSION).toBe(pkg.version)
})

test("parseVersion reads X.Y.Z only", () => {
  expect(parseVersion("0.2.10")).toEqual([0, 2, 10])
  expect(parseVersion("v0.2.0")).toBeNull()
  expect(parseVersion("0.2")).toBeNull()
  expect(parseVersion("0.2.0-rc.1")).toBeNull()
})

test("isOlder compares numerically", () => {
  expect(isOlder("0.2.0", "0.10.0")).toBe(true)
  expect(isOlder("0.10.0", "0.2.0")).toBe(false)
  expect(isOlder("1.0.0", "1.0.0")).toBe(false)
  expect(isOlder("0.9.9", "1.0.0")).toBe(true)
})
