import { resolveCli, runCli } from "./cli"
import { extractFindingsJson } from "./extract"
import { FINDINGS_SCHEMA, type LlmFinding, type LlmProvider, type LlmRequest, responseSchema } from "./types"

const SYSTEM_PROMPT =
  "You check one source file against a list of rules and answer only with the structured result. " +
  "You never edit files, run commands or ask questions."

/**
 * Claude Code in print mode. Needs no API key on a machine that is signed in, which is why it is
 * the default provider.
 *
 * The flags matter (plan 6a, Decision 5). Measured on Claude Code 2.1.278 with the same prompt:
 * a naive `claude -p` costs 23,046 input tokens because it drags the whole system prompt, the
 * project's CLAUDE.md and its plugins along; with these it costs 1,254. `--tools ""` also means
 * the child cannot read, write or run anything, and `--restricted` makes it ignore user, project
 * and local settings files — so a rulecast Stop hook cannot spawn a claude that trips it again.
 */
export const claudeCodeProvider: LlmProvider = {
  name: "claude-code",
  async ask(request: LlmRequest): Promise<LlmFinding[]> {
    const command = await resolveCli("claude", request.cwd)
    const args = [
      "-p",
      "--model",
      request.model,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(FINDINGS_SCHEMA),
      "--system-prompt",
      SYSTEM_PROMPT,
      "--tools",
      "",
      "--restricted",
      "--strict-mcp-config",
      "--no-session-persistence",
    ]
    const result = await runCli(command, args, {
      cwd: request.cwd,
      input: request.prompt,
      env: request.env,
      signal: request.signal,
    })

    const envelope = parseJson(result.stdout)
    if (isRecord(envelope)) {
      if (envelope.is_error === true) {
        throw new Error(`claude reported an error: ${firstLine(String(envelope.result ?? result.stderr))}`)
      }
      const structured = responseSchema.safeParse(envelope.structured_output)
      if (structured.success) return structured.data.findings
      if (typeof envelope.result === "string") {
        const fromResult = responseSchema.safeParse(parseJson(envelope.result))
        if (fromResult.success) return fromResult.data.findings
      }
    }

    const scanned = responseSchema.safeParse(extractFindingsJson(result.stdout))
    if (scanned.success) return scanned.data.findings
    throw new Error(
      `claude returned no usable JSON (exit ${result.code}): ${firstLine(result.stderr || result.stdout)}`,
    )
  },
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.slice(0, 200) ?? ""
}
