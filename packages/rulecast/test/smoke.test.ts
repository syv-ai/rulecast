import { expect, test } from "vitest"

import * as rulecast from "../src/index"

test("package entry loads", () => {
  expect(rulecast).toBeTypeOf("object")
})

test("package entry exports the Claude Code adapter", () => {
  expect(rulecast.claudeCodeAdapter.name).toBe("claude-code")
})

test("package entry exports the compile, rule repo and cache API", () => {
  // Static access, not rulecast[name]: biome's noDynamicNamespaceImportAccess rejects indexing a namespace import.
  for (const exported of [
    rulecast.compile,
    rulecast.compileManifest,
    rulecast.cachedRepos,
    rulecast.fetchingRepos,
    rulecast.cacheHome,
    rulecast.projectStateDir,
    rulecast.runPipeline,
    rulecast.adapterByName,
  ]) {
    expect(exported).toBeTypeOf("function")
  }
  expect(rulecast.CONFIG_FILE).toBe(".rulecast-config.yaml")
  expect(rulecast.MANIFEST_FILE).toBe(".rulecast-rules.yaml")
  expect(rulecast.VERSION).toMatch(/^\d+\.\d+\.\d+$/)
})
