import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { opencodeProvider, PROMPT_LIMIT_BYTES } from "../../../../src/detectors/llm/providers/opencode"
import { type LlmRequest, LlmUnavailableError } from "../../../../src/detectors/llm/providers/types"
import { stubAgentCli, stubArgv } from "../../../helpers/llm"
import { createProject } from "../../../helpers/project"

const PROMPT = '### r1\nDoes this file print?\n\n## File: a.py\n\n    1  def f():\n    2      print("x")\n'
const ANSWER = '{"findings":[{"rule":"r1","line":2,"reason":"prints"}]}'

function request(cwd: string, overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: "anthropic/claude-haiku-4-5-20251001",
    prompt: PROMPT,
    settings: { provider: "opencode", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 },
    env: process.env,
    cwd,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe("opencode provider", () => {
  beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
  afterEach(() => vi.unstubAllEnvs())

  test("runs `opencode run` with the model and the prompt as an argument", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", { stdout: ANSWER })
    await opencodeProvider.ask(request(root))

    const argv = (await stubArgv(root, "opencode"))[0]!
    expect(argv.startsWith("run --model anthropic/claude-haiku-4-5-20251001 --format default ")).toBe(true)
    expect(argv.endsWith(PROMPT)).toBe(true)
  })

  test("reads the findings out of plain output", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", { stdout: ANSWER })
    expect(await opencodeProvider.ask(request(root))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("reads them out of prose and a fenced block, which is all OpenCode guarantees", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", {
      stdout: `I looked at the file.\n\n\`\`\`json\n${ANSWER}\n\`\`\`\n\nHope that helps!\n`,
    })
    expect(await opencodeProvider.ask(request(root))).toEqual([{ rule: "r1", line: 2, reason: "prints" }])
  })

  test("output with no JSON fails the call's rules and quotes what came back", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", { stdout: "I could not find anything wrong.\n" })
    const error = await opencodeProvider.ask(request(root)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmUnavailableError)
    expect((error as Error).message).toContain("I could not find anything wrong.")
  })

  test("a missing opencode disables every llm rule", async () => {
    const root = await createProject({})
    await expect(opencodeProvider.ask(request(root))).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  test("a prompt too large for argv fails before spawning anything", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", { stdout: ANSWER })
    const huge = "x".repeat(PROMPT_LIMIT_BYTES + 1)
    const error = await opencodeProvider.ask(request(root, { prompt: huge })).catch((e: unknown) => e)
    expect((error as Error).message).toMatch(/too large/)
    expect((error as Error).message).toContain(String(PROMPT_LIMIT_BYTES))
    expect(await stubArgv(root, "opencode")).toEqual([])
  })

  test("an aborted signal rejects", async () => {
    const root = await createProject({})
    await stubAgentCli(root, "opencode", { stdout: ANSWER })
    const controller = new AbortController()
    controller.abort()
    await expect(opencodeProvider.ask(request(root, { signal: controller.signal }))).rejects.toThrow()
  })
})
