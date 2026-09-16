import { expect, test } from "vitest"

import * as rulecast from "../src/index"

test("package entry loads", () => {
  expect(rulecast).toBeTypeOf("object")
})

test("package entry exports the Claude Code adapter", () => {
  expect(rulecast.claudeCodeAdapter.name).toBe("claude-code")
})
