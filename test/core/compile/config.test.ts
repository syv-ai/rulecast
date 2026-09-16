import { describe, expect, test } from "vitest"

import { loadConfig } from "../../../src/core/compile/config"
import { createProject } from "../../helpers/project"

describe("loadConfig", () => {
  test("missing config file gives defaults", async () => {
    const root = await createProject({})
    const result = await loadConfig(root)
    expect(result).toEqual({
      ok: true,
      config: {
        rules: ".rulecast/rules/**/*.yml",
        context: { mode: "inject", maxBytes: 32768 },
        maxMatchesPerRule: 10,
        timeouts: { editDeadlineMs: 350, verifyMs: 60000 },
        stopGate: { maxBlocks: 3 },
        llm: {
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          baseUrl: null,
          apiKeyEnv: "ANTHROPIC_API_KEY",
          maxFilesPerVerify: 10,
        },
      },
    })
  })

  test("partial config merges with defaults", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context:\n  mode: read\n" })
    const result = await loadConfig(root)
    expect(result.ok && result.config.context).toEqual({ mode: "read", maxBytes: 32768 })
  })

  test("invalid config is reported, not thrown", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context:\n  mode: shout\n" })
    const result = await loadConfig(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(".rulecast/config.yml: context.mode:")
  })

  test("unparseable YAML is reported", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context: [" })
    const result = await loadConfig(root)
    expect(result.ok).toBe(false)
  })
})
