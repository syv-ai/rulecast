import { describe, expect, test } from "vitest"

import { installLabel, selfCommand } from "../../src/core/self"

const proc = { execPath: "/c/rulecast", argv: ["bun", "/$bunfs/root/rulecast", "hook"] }

describe("selfCommand", () => {
  test("in the binary, a child is started as the binary alone", () => {
    expect(selfCommand(proc, true)).toEqual(["/c/rulecast"])
  })

  test("under node, a child is node and the script", () => {
    expect(selfCommand(proc, false)).toEqual(["/c/rulecast", "/$bunfs/root/rulecast"])
  })
})

describe("installLabel", () => {
  test("in the binary, it names the binary's path", () => {
    expect(installLabel({ execPath: "/c/rulecast", argv: [] }, true)).toBe("the standalone binary at /c/rulecast")
  })

  test("under node, it names the script node runs", () => {
    expect(installLabel({ execPath: "/usr/bin/node", argv: ["node", "/nowhere/dist/cli.js"] }, false)).toBe(
      "/nowhere/dist/cli.js",
    )
  })
})
