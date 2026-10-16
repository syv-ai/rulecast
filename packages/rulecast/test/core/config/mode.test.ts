import { describe, expect, test } from "vitest"

import { resolveMode } from "../../../src/core/config/mode"

describe("resolveMode", () => {
  test("nothing set is attended, by default", () => {
    expect(resolveMode(null, {})).toEqual({ mode: "attended", source: "default", detail: "" })
  })

  test("RULECAST_MODE wins over the config, in both directions", () => {
    expect(resolveMode("attended", { RULECAST_MODE: "unattended" })).toEqual({
      mode: "unattended",
      source: "env",
      detail: "RULECAST_MODE=unattended",
    })
    expect(resolveMode("unattended", { RULECAST_MODE: "attended", CI: "true" })).toMatchObject({
      mode: "attended",
      source: "env",
    })
    expect(resolveMode(null, { RULECAST_MODE: "interactive" })).toMatchObject({ mode: "attended", source: "env" })
  })

  test("the config wins over CI detection", () => {
    expect(resolveMode("attended", { CI: "true" })).toEqual({
      mode: "attended",
      source: "config",
      detail: "mode: attended",
    })
    expect(resolveMode("unattended", {})).toMatchObject({ mode: "unattended", source: "config" })
  })

  test("CI or GITHUB_ACTIONS means unattended; false, 0 and empty do not", () => {
    expect(resolveMode(null, { CI: "true" })).toEqual({ mode: "unattended", source: "ci", detail: "CI=true" })
    expect(resolveMode(null, { GITHUB_ACTIONS: "true" })).toMatchObject({
      mode: "unattended",
      detail: "GITHUB_ACTIONS=true",
    })
    for (const value of ["false", "False", "FALSE", "0", ""])
      expect(resolveMode(null, { CI: value }).mode).toBe("attended")
  })

  test("an unknown RULECAST_MODE is ignored and said, and the rest decides", () => {
    expect(resolveMode(null, { RULECAST_MODE: "headless", CI: "1" })).toEqual({
      mode: "unattended",
      source: "ci",
      detail: "CI=1",
      ignored: "headless",
    })
  })
})
