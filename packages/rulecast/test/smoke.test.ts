import { expect, test } from "vitest"
import * as rulecast from "../src/index"
import * as internal from "../src/internal"

test("package entry loads", () => {
  expect(rulecast).toBeTypeOf("object")
})

test("package entry exports the Claude Code adapter", () => {
  expect(rulecast.claudeCodeAdapter.name).toBe("claude-code")
})

test("package entry exports the plugin API a detector or adapter author needs", () => {
  // Static access, not rulecast[name]: biome's noDynamicNamespaceImportAccess rejects indexing a namespace import.
  for (const exported of [
    rulecast.perRule,
    rulecast.createRegistry,
    rulecast.detectorContract,
    rulecast.adapterContract,
    rulecast.adapterByName,
    rulecast.emptyDelivery,
    rulecast.isDetectorRule,
    // Promoted deliberately (plan 9 Task 2): the context budget is computed *against* this
    // renderer — decide() measures with measureRuleBlock and trims to adapter.maxContextChars — so
    // an adapter that renders a Delivery its own way gets text trimmed to a budget for a different
    // renderer. Publishing it says that Adapter.format is expected to wrap it, not replace it.
    rulecast.renderAgentText,
    rulecast.lineStarts,
    rulecast.positionAt,
    rulecast.offsetAt,
  ]) {
    expect(exported).toBeTypeOf("function")
  }
  expect(rulecast.VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  expect(rulecast.builtinDetectors.length).toBeGreaterThan(0)
  expect(rulecast.ADAPTERS.length).toBeGreaterThan(0)
})

// Spec §16: the entry point is the plugin API. rulecast's own machinery lives behind ./internal,
// which carries no stability promise — a shape moving between the two is a deliberate decision,
// so this test fails when one drifts back.
test("the CLI's own internals are not on the plugin API", () => {
  const published = new Set(Object.keys(rulecast))
  for (const name of [
    "compile",
    "compileManifest",
    "runPipeline",
    "cacheHome",
    "projectStateDir",
    "cachedRepos",
    "fetchingRepos",
    "fixedRepo",
    // renderAgentText was here until plan 9 Task 2 and is now on both entry points: the budget is
    // computed against it, so every adapter needs it, and `scripts/` still reaches it through
    // ./internal. Everything else in this list is rulecast driving itself and stays internal.
    "checkDetectors",
    "CONFIG_FILE",
    "MANIFEST_FILE",
  ]) {
    expect(published.has(name), `${name} should be on ./internal, not the package entry`).toBe(false)
  }
})

test("the internal entry exports the compile, pipeline, rule repo and cache API", () => {
  for (const exported of [
    internal.compile,
    internal.compileManifest,
    internal.runPipeline,
    internal.cachedRepos,
    internal.fetchingRepos,
    internal.cacheHome,
    internal.projectStateDir,
    internal.renderAgentText,
  ]) {
    expect(exported).toBeTypeOf("function")
  }
  expect(internal.CONFIG_FILE).toBe(".rulecast-config.yaml")
  expect(internal.MANIFEST_FILE).toBe(".rulecast-rules.yaml")
})
