import { describe, expect, test } from "vitest"

import { newestEntry } from "../../scripts/release-notes"

const CHANGELOG = [
  "# @syv-ai/rulecast",
  "",
  "## 0.2.0",
  "",
  "### Minor Changes",
  "",
  "- The newest thing.",
  "",
  "## 0.1.0",
  "",
  "- The older thing.",
  "",
].join("\n")

describe("release notes", () => {
  test("takes the newest entry only", () => {
    expect(newestEntry(CHANGELOG)).toEqual({
      version: "0.2.0",
      body: "### Minor Changes\n\n- The newest thing.",
    })
  })

  test("the only entry is the newest entry", () => {
    expect(newestEntry("# x\n\n## 0.1.0\n\n- First.\n").body).toBe("- First.")
  })

  test("a changelog with no version heading throws rather than publishing an empty release", () => {
    expect(() => newestEntry("# @syv-ai/rulecast\n\nnothing yet\n")).toThrow(/no `## X.Y.Z` heading/)
  })
})
