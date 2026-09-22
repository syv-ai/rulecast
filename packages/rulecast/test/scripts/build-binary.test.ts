import { describe, expect, test } from "vitest"

import { BINARY_TARGETS, hostTarget } from "../../scripts/build-binary"

describe("hostTarget", () => {
  test("names the target for each platform 0.1 ships", () => {
    expect(hostTarget("linux", "x64")).toBe("linux-x64")
    expect(hostTarget("darwin", "arm64")).toBe("darwin-arm64")
  })

  test("throws on a platform with no binary rather than naming one that would not work", () => {
    expect(() => hostTarget("win32", "x64")).toThrow(/does not ship a binary for win32-x64/)
  })

  test("this machine is one of them", () => {
    expect(BINARY_TARGETS).toContain(hostTarget())
  })
})
