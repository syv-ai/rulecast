import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"

import { resolveModel } from "../../../src/detectors/llm/models"
import { claudeCodeProvider } from "../../../src/detectors/llm/providers/claude-code"
import { createProject } from "../../helpers/project"

const exec = promisify(execFile)

const SOURCE = "def get(id):\n    print('fetching', id)\n    return id\n"

// Built by hand: buildPrompt does not exist until plan 6b. Switch this over in 6c, Task 4.
const PROMPT = [
  "Check the file below against each rule. Report every line that breaks a rule.",
  "",
  'Answer with JSON only: {"findings": [{"rule": "<rule id>", "line": <number>, "text": "<the line>", "reason": "<why>"}]}',
  "",
  "## Rules",
  "",
  "### r1",
  "Does this function write to stdout instead of using a logger? Report each offending line.",
  "",
  "## File: app/a.py",
  "",
  "```",
  "    1  def get(id):",
  "    2      print('fetching', id)",
  "    3      return id",
  "```",
  "",
].join("\n")

async function onPath(command: string): Promise<boolean> {
  return exec("command", ["-v", command], { shell: "/bin/sh" }).then(
    () => true,
    () => false,
  )
}

/**
 * Opt in with RULECAST_LLM=1. The normal suite replays test/payloads/llm/ through a stub, because a
 * live call costs money and answers differently every time; this is where those recordings get
 * checked against the real thing. A provider the machine cannot reach is skipped by name rather
 * than silently passing.
 *
 * Assertions are on the shape of the answer, never on the model's words.
 */
describe.runIf(process.env.RULECAST_LLM === "1")("live llm providers", () => {
  test("claude-code answers about the line that prints", async () => {
    if (!(await onPath("claude"))) {
      console.log("skipping claude-code: claude is not on PATH")
      return
    }
    const root = await createProject({ "app/a.py": SOURCE })
    const findings = await claudeCodeProvider.ask({
      model: resolveModel("haiku", "claude-code")!,
      prompt: PROMPT,
      settings: { provider: "claude-code", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 },
      env: process.env,
      cwd: root,
      signal: new AbortController().signal,
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
})
