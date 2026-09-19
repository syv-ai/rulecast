import { describe, expect, test } from "vitest"

import { setRevs } from "../../../src/core/config/edit"

const CONFIG = [
  "# top comment",
  "repos:",
  "  - repo: https://github.com/syv-ai/rulecast",
  "    rev: v0.1.0   # frozen: v0.1.0",
  "    rules:",
  "      - id: a   # keep me",
  "  - repo: https://x/y",
  '    rev: "v1.0.0"  # pinned',
  "    rules: []",
  "  - { repo: https://z/w, rev: 'v2.0.0', rules: [] }",
  "  - repo: local",
  "    rules: [{ id: b, name: B, stages: [touch], context: ['@a.md'] }]",
  "",
].join("\n")

const replaced = (from: string, to: string) => CONFIG.replace(from, to)

describe("setRevs", () => {
  test("changes only the rev values, keeping quotes and comments; a stale frozen comment goes", () => {
    const text = setRevs(CONFIG, [
      { index: 0, rev: "v0.2.0", frozenTag: null },
      { index: 1, rev: "v1.1.0", frozenTag: null },
      { index: 2, rev: "v2.1.0", frozenTag: null },
    ])
    expect(text).toBe(
      CONFIG.replace("rev: v0.1.0   # frozen: v0.1.0", "rev: v0.2.0")
        .replace('rev: "v1.0.0"  # pinned', 'rev: "v1.1.0"  # pinned')
        .replace("rev: 'v2.0.0'", "rev: 'v2.1.0'"),
    )
  })

  test("freezing writes the SHA with a frozen comment", () => {
    expect(setRevs(CONFIG, [{ index: 0, rev: "deadbeef", frozenTag: "v0.2.0" }])).toBe(
      replaced("rev: v0.1.0   # frozen: v0.1.0", "rev: deadbeef  # frozen: v0.2.0"),
    )
    expect(setRevs(CONFIG, [{ index: 1, rev: "cafe", frozenTag: "v1.1.0" }])).toBe(
      replaced('rev: "v1.0.0"  # pinned', 'rev: "cafe"  # frozen: v1.1.0'),
    )
  })

  test("keeps Windows line endings", () => {
    const text = "repos:\r\n  - repo: u\r\n    rev: v1 # frozen: v1\r\n    rules: []\r\n"
    expect(setRevs(text, [{ index: 0, rev: "v2", frozenTag: null }])).toBe(
      "repos:\r\n  - repo: u\r\n    rev: v2\r\n    rules: []\r\n",
    )
  })

  test("no updates returns the text unchanged; a repo without rev is an error", () => {
    expect(setRevs(CONFIG, [])).toBe(CONFIG)
    expect(() => setRevs(CONFIG, [{ index: 3, rev: "v1", frozenTag: null }])).toThrow("repos[3] has no rev")
  })
})
