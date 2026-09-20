import { describe, expect, test } from "vitest"
import { claudeCodeProvider } from "../../../../src/detectors/llm/providers/claude-code"
import type { LlmRequest } from "../../../../src/detectors/llm/providers/types"
import { LlmUnavailableError } from "../../../../src/detectors/llm/providers/types"
import { stubAgentCli, stubArgv, stubStdin } from "../../../helpers/llm"
import { createProject } from "../../../helpers/project"

const PROMPT = '### r1\nDoes this file print?\n\n## File: a.py\n\n    1  def f():\n>   2      print("x")\n'

function request(cwd: string, overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: "haiku",
    prompt: PROMPT,
    settings: { provider: "claude-code", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 },
    // A PATH with the shell's own tools but no claude, so a machine that has Claude Code
    // installed (it lives in ~/.local/bin) cannot make one of these tests pass for real.
    env: { ...process.env, PATH: "/usr/bin:/bin" },
    cwd,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe("claude-code provider", () => {
  test("runs claude -p lean, with the prompt on stdin", async () => {
    const root = await createProject({ "a.py": "def f():\n    print('x')\n" })
    await stubAgentCli(root, "claude")
    await claudeCodeProvider.ask(request(root))

    const argv = (await stubArgv(root, "claude"))[0]!
    expect(argv).toContain("-p")
    expect(argv).toContain("--model haiku")
    expect(argv).toContain("--output-format json")
    // Without these the call drags Claude Code's whole system prompt in: 23k tokens instead of 1.2k.
    expect(argv).toContain("--restricted")
    expect(argv).toContain("--strict-mcp-config")
    expect(argv).toContain("--no-session-persistence")
    expect(argv).toContain("--system-prompt")
    expect(argv).toContain("--tools")
    expect(await stubStdin(root, "claude")).toEqual([PROMPT.replace(/\n$/, "")])
  })

  test("passes a --json-schema that describes the findings shape", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude")
    await claudeCodeProvider.ask(request(root))
    // JSON.stringify emits no spaces, so the schema survives argv's space-joining as one token.
    const argv = (await stubArgv(root, "claude"))[0]!
    const token = argv.split(" ").find((part) => part.startsWith('{"type":"object"'))
    expect(JSON.parse(token!).properties.findings.items.properties.reason).toEqual({ type: "string" })
  })

  test("reads structured_output, with the rule id the prompt asked about", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude")
    expect(await claudeCodeProvider.ask(request(root))).toEqual([
      { rule: "r1", line: 2, text: 'print("x")', reason: "Line uses print(), which the rule forbids" },
    ])
  })

  test("falls back to the result string when there is no structured_output", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude", {
      stdout: JSON.stringify({
        is_error: false,
        result: '{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}',
      }),
    })
    expect(await claudeCodeProvider.ask(request(root))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("falls back to scanning stdout when it is not an envelope at all", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude", {
      stdout: 'Here you go:\n{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}\n',
    })
    expect(await claudeCodeProvider.ask(request(root))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("an is_error envelope fails the call, carrying the CLI's own message", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude", {
      stdout: JSON.stringify({ is_error: true, result: "Credit balance is too low" }),
    })
    await expect(claudeCodeProvider.ask(request(root))).rejects.toThrow(/Credit balance is too low/)
  })

  test("unusable output is a per-rule failure, not an unavailable backend", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude", { stdout: "I had a think and decided not to answer.\n" })
    const error = await claudeCodeProvider.ask(request(root)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
  })

  test("a missing claude disables every llm rule, not one", async () => {
    const root = await createProject({})
    await expect(claudeCodeProvider.ask(request(root))).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  test("an aborted signal rejects", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "claude")
    const controller = new AbortController()
    controller.abort()
    await expect(claudeCodeProvider.ask(request(root, { signal: controller.signal }))).rejects.toThrow()
  })
})
