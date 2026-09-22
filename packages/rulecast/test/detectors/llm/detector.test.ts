import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { diskCache, memoryCache } from "../../../src/core/detection/cache"
import {
  type ChangeSet,
  type DetectorRuleInput,
  defaultDetectorSettings,
  type LlmSettings,
} from "../../../src/core/types"
import { llmDetector } from "../../../src/detectors/llm/detector"
import type { LlmConfig } from "../../../src/detectors/llm/schema"
import { stubAgentCli, stubArgv, stubStdin } from "../../helpers/llm"
import { fakeApi } from "../../helpers/llm-server"
import { createProject } from "../../helpers/project"

const PY = "def get(id):\n    print('fetching', id)\n    return id\n"

const config = (model = "haiku", extra: Partial<LlmConfig> = {}): LlmConfig => ({
  model,
  question: "Does this file print instead of logging?",
  grounding: true,
  ...extra,
})

const rule = (id: string, files: string[], model = "haiku", context: { ref: string; content: string }[] = []) =>
  ({ id, config: config(model), files, context }) as DetectorRuleInput<LlmConfig>

function run(
  cwd: string,
  rules: DetectorRuleInput<LlmConfig>[],
  options: { changes?: Map<string, ChangeSet>; llm?: Partial<LlmSettings>; signal?: AbortSignal } = {},
) {
  const settings = defaultDetectorSettings()
  return llmDetector.run({
    event: "verify",
    rules,
    changes: options.changes ?? new Map(),
    cache: memoryCache(),
    settings: { llm: { ...settings.llm, ...options.llm } },
    cwd,
    signal: options.signal ?? new AbortController().signal,
  })
}

async function project(files: Record<string, string> = { "app/a.py": PY }, broken: string[] = ["broken-model"]) {
  const root = await createProject(files)
  await stubAgentCli(root, "claude", { broken })
  return root
}

describe("llm detector", () => {
  // The stub is found by absolute path in the fixture's node_modules/.bin; a PATH without claude
  // on it means a machine that has Claude Code installed cannot make one of these pass for real.
  beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
  afterEach(() => vi.unstubAllEnvs())

  test("declares its kind, capture and verify-only default", () => {
    expect(llmDetector.kind).toBe("llm")
    expect(llmDetector.captures(config())).toEqual(["reason"])
    expect(llmDetector.events(config())).toEqual(["verify"])
  })

  test("one call covers every rule selected for the file", async () => {
    const root = await project()
    const result = await run(root, [rule("r1", ["app/a.py"]), rule("r2", ["app/a.py"])])
    expect(await stubArgv(root, "claude")).toHaveLength(1)
    const prompt = (await stubStdin(root, "claude"))[0]!
    expect(prompt).toContain("### r1")
    expect(prompt).toContain("### r2")
    expect(result.errors).toEqual([])
  })

  test("two models on one file are two calls, each naming only its own rule", async () => {
    const root = await project()
    await run(root, [rule("r1", ["app/a.py"], "haiku"), rule("r2", ["app/a.py"], "sonnet")])
    const prompts = await stubStdin(root, "claude")
    expect(prompts).toHaveLength(2)
    expect(prompts.filter((p) => p.includes("### r1") && !p.includes("### r2"))).toHaveLength(1)
    expect(prompts.filter((p) => p.includes("### r2") && !p.includes("### r1"))).toHaveLength(1)
  })

  test("a file with an empty change set is not sent", async () => {
    const root = await project()
    const changes = new Map([["app/a.py", { changedLines: [] as [number, number][] }]])
    const result = await run(root, [rule("r1", ["app/a.py"])], { changes })
    expect(await stubArgv(root, "claude")).toEqual([])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("a file absent from changes is judged whole, with no marks", async () => {
    const root = await project()
    const prompt = (await run(root, [rule("r1", ["app/a.py"])]).then(() => stubStdin(root, "claude")))[0]!
    expect(prompt).toContain("Judge the whole file.")
    expect(prompt).toContain("  2      print('fetching', id)")
  })

  test("changed lines are marked when there is a change set", async () => {
    const root = await project()
    const changes = new Map([["app/a.py", { changedLines: [[2, 2]] as [number, number][] }]])
    const prompt = (await run(root, [rule("r1", ["app/a.py"])], { changes }).then(() => stubStdin(root, "claude")))[0]!
    expect(prompt).toContain("> 2      print('fetching', id)")
    expect(prompt).toContain('Only lines marked with ">" were changed.')
  })

  test("grounding sends the rule's references, and grounding: false does not", async () => {
    const root = await project()
    const grounded = rule("r1", ["app/a.py"], "haiku", [{ ref: "docs/log.md", content: "Use the logger." }])
    const bare = {
      id: "r2",
      config: config("haiku", { grounding: false }),
      files: ["app/a.py"],
      context: [{ ref: "docs/other.md", content: "Never sent." }],
    } as DetectorRuleInput<LlmConfig>
    const prompt = (await run(root, [grounded, bare]).then(() => stubStdin(root, "claude")))[0]!
    expect(prompt).toContain("Use the logger.")
    expect(prompt).not.toContain("Never sent.")
  })

  test("a finding becomes a match carrying the file's own line, not the model's quote", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubAgentCli(root, "claude", {
      stdout: JSON.stringify({
        is_error: false,
        structured_output: { findings: [{ rule: "r1", line: 2, text: "WRONG QUOTE", reason: "it prints" }] },
      }),
    })
    const result = await run(root, [rule("r1", ["app/a.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "r1",
        match: {
          file: "app/a.py",
          line: 2,
          endLine: 2,
          column: 1,
          text: "    print('fetching', id)",
          captures: { reason: "it prints" },
        },
      },
    ])
  })

  test("findings the file cannot support are dropped, not errors", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubAgentCli(root, "claude", {
      stdout: JSON.stringify({
        is_error: false,
        structured_output: {
          findings: [
            { rule: "nobody-asked", line: 2, reason: "hallucinated rule" },
            { rule: "r1", line: 99, reason: "past the end of the file" },
            { rule: "r1", line: 3, reason: "outside the changed lines" },
            { rule: "r1", line: 2, reason: "the real one" },
          ],
        },
      }),
    })
    const changes = new Map([["app/a.py", { changedLines: [[2, 2]] as [number, number][] }]])
    const result = await run(root, [rule("r1", ["app/a.py"])], { changes })
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => f.match.captures.reason)).toEqual(["the real one"])
  })

  test("a missing claude disables every llm rule at once, not one by one", async () => {
    const root = await createProject({ "app/a.py": PY })
    const result = await run(root, [rule("r1", ["app/a.py"]), rule("r2", ["app/a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.rule).toBeNull()
  })

  test("an unusable answer fails only the rules of that call", async () => {
    const root = await project()
    const result = await run(root, [rule("bad", ["app/a.py"], "broken-model"), rule("good", ["app/a.py"])])
    expect(result.errors.map((e) => e.rule)).toEqual(["bad"])
    expect(result.findings.map((f) => f.rule)).toEqual(["good"])
  })

  test("a model alias the provider cannot express is a per-rule error naming both", async () => {
    const root = await project()
    // openai-compatible has no mapping for "haiku" on purpose: those projects name their own
    // models, and a wrong guess would be worse than a clear error.
    const result = await run(root, [rule("r1", ["app/a.py"])], { llm: { provider: "openai-compatible" } })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.rule).toBe("r1")
    expect(result.errors[0]!.message).toMatch(/haiku/)
    expect(result.errors[0]!.message).toMatch(/openai-compatible/)
  })

  test("one rule's unmappable alias leaves the others working, over an HTTP provider", async () => {
    vi.stubEnv("KEY", "sk-test")
    const api = await fakeApi(() => [
      200,
      { choices: [{ message: { content: '{"findings":[{"rule":"explicit","line":2,"reason":"prints"}]}' } }] },
    ])
    try {
      const root = await project()
      const result = await run(
        root,
        // "haiku" has no openai-compatible mapping; "gpt-5-mini" is not an alias, so it goes verbatim.
        [rule("aliased", ["app/a.py"], "haiku"), rule("explicit", ["app/a.py"], "gpt-5-mini")],
        { llm: { provider: "openai-compatible", baseUrl: api.url, apiKeyEnv: "KEY" } },
      )
      expect(result.errors.map((e) => e.rule)).toEqual(["aliased"])
      expect(result.findings.map((f) => f.rule)).toEqual(["explicit"])
    } finally {
      await api.close()
    }
  })

  test("a second run over the same disk cache makes no call", async () => {
    // Spec §6: "Unchanged files make no calls on repeated verifies." The unit test in call.test.ts
    // uses an in-memory cache, which cannot show that the key survives a process boundary — and
    // the real cache is a directory of JSON files read by a fresh CLI process every time.
    const root = await project()
    const cacheDir = path.join(root, ".cache")
    const twice = () =>
      llmDetector.run({
        event: "verify",
        rules: [rule("r1", ["app/a.py"])],
        changes: new Map(),
        cache: diskCache(cacheDir),
        settings: defaultDetectorSettings(),
        cwd: root,
        signal: new AbortController().signal,
      })

    const first = await twice()
    const second = await twice()
    expect(await stubArgv(root, "claude")).toHaveLength(1)
    expect(second.findings).toEqual(first.findings)
    expect(second.findings.length).toBeGreaterThan(0)
  })

  test("a file that no longer exists is skipped", async () => {
    const root = await project()
    const result = await run(root, [rule("r1", ["app/gone.py"])])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("an aborted run rejects rather than reporting errors", async () => {
    const root = await project()
    const controller = new AbortController()
    controller.abort()
    await expect(run(root, [rule("r1", ["app/a.py"])], { signal: controller.signal })).rejects.toThrow()
  })
})
