import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import { draftPrompt } from "../../src/init/draft-prompt"

test("names the detected doc and the catalog tag", () => {
  expect(draftPrompt("v0.2.0", "AGENTS.md")).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/CONVENTIONS.md\n" +
      "and follow it with me to work out this project's conventions, starting from AGENTS.md, then draft rulecast rules for them.",
  )
  expect(draftPrompt("v0.2.0", "CLAUDE.md")).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/CONVENTIONS.md\n" +
      "and follow it with me to work out this project's conventions, starting from CLAUDE.md, then draft rulecast rules for them.",
  )
  expect(draftPrompt("v0.0.0", null)).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.0.0/agents/CONVENTIONS.md\n" +
      "and follow it with me to work out this project's conventions, starting from the project's docs, then draft rulecast rules for them.",
  )
})

test("the linked procedure exists in this repository", () => {
  const url = /https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/v1\.2\.3\/(\S+)/.exec(
    draftPrompt("v1.2.3", null),
  )
  expect(url?.[1]).toBe("agents/CONVENTIONS.md")
  // test/init → test → packages/rulecast → packages → repository root
  expect(existsSync(fileURLToPath(new URL(`../../../../${url?.[1]}`, import.meta.url)))).toBe(true)
})
