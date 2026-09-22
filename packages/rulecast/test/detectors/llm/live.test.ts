import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"

import type { LlmProviderName } from "../../../src/core/types"
import { resolveModel } from "../../../src/detectors/llm/models"
import { buildPrompt } from "../../../src/detectors/llm/prompt"
import { anthropicProvider } from "../../../src/detectors/llm/providers/anthropic"
import { claudeCodeProvider } from "../../../src/detectors/llm/providers/claude-code"
import { openaiCompatibleProvider } from "../../../src/detectors/llm/providers/openai"
import { opencodeProvider } from "../../../src/detectors/llm/providers/opencode"
import type { LlmProvider } from "../../../src/detectors/llm/providers/types"
import { createProject } from "../../helpers/project"

const exec = promisify(execFile)

const FILE = "app/a.py"
const SOURCE = "def get(id):\n    print('fetching', id)\n    return id\n"

const PROMPT = buildPrompt({
  file: FILE,
  source: SOURCE,
  changedLines: null,
  rules: [
    {
      id: "r1",
      question: "Does this function write to stdout instead of using a logger? Report each offending line.",
      grounding: [],
    },
  ],
})

async function onPath(command: string): Promise<boolean> {
  return exec("command", ["-v", command], { shell: "/bin/sh" }).then(
    () => true,
    () => false,
  )
}

interface Live {
  provider: LlmProvider
  name: LlmProviderName
  /** The alias or model to ask for. */
  model: string
  apiKeyEnv: string
  baseUrl: string | null
  /** Why this provider cannot run here, or null when it can. */
  unavailable(): Promise<string | null>
}

const LIVE: Live[] = [
  {
    provider: claudeCodeProvider,
    name: "claude-code",
    model: "haiku",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: null,
    unavailable: async () => ((await onPath("claude")) ? null : "claude is not on PATH"),
  },
  {
    provider: opencodeProvider,
    name: "opencode",
    model: "haiku",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: null,
    unavailable: async () => ((await onPath("opencode")) ? null : "opencode is not on PATH"),
  },
  {
    provider: anthropicProvider,
    name: "anthropic",
    model: "haiku",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: null,
    unavailable: async () => (process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY is not set"),
  },
  {
    provider: openaiCompatibleProvider,
    name: "openai-compatible",
    // No alias maps for this provider by design, so a real model id is named here.
    model: "gpt-4o-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: null,
    unavailable: async () => (process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY is not set"),
  },
]

/**
 * Opt in with RULECAST_LLM=1. The normal suite replays test/payloads/llm/ through a stub and
 * answers the HTTP providers from a local server, because a live call costs money and answers
 * differently every time; this is where those stand-ins get checked against the real thing.
 *
 * A provider the machine cannot reach is skipped by name rather than silently passing, and every
 * assertion is on the shape of the answer, never on the model's words.
 */
describe.runIf(process.env.RULECAST_LLM === "1")("live llm providers", () => {
  for (const live of LIVE) {
    test(`${live.name} answers about the line that prints`, async () => {
      const reason = await live.unavailable()
      if (reason !== null) {
        console.log(`skipping ${live.name}: ${reason}`)
        return
      }
      const model = resolveModel(live.model, live.name)
      expect(model).not.toBeNull()

      const root = await createProject({ [FILE]: SOURCE })
      const findings = await live.provider.ask({
        model: model!,
        prompt: PROMPT,
        settings: {
          provider: live.name,
          baseUrl: live.baseUrl,
          apiKeyEnv: live.apiKeyEnv,
          maxFilesPerVerify: 10,
        },
        env: process.env,
        cwd: root,
        signal: AbortSignal.timeout(100_000),
      })

      expect(Array.isArray(findings)).toBe(true)
      expect(findings.length).toBeGreaterThan(0)
      for (const finding of findings) {
        expect(finding.rule).toBe("r1")
        expect(Number.isInteger(finding.line)).toBe(true)
        expect(finding.line).toBeGreaterThanOrEqual(1)
        expect(finding.line).toBeLessThanOrEqual(3)
        expect(finding.reason.length).toBeGreaterThan(0)
      }
    }, 120_000)
  }
})
