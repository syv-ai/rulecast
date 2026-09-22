import { cliAvailable, resolveCli, runCli } from "./cli"
import { extractFindingsJson } from "./extract"
import { type LlmFinding, type LlmProvider, type LlmRequest, responseSchema } from "./types"

/**
 * OpenCode takes the prompt as a positional argument (plan 6c, Decision 3), so it is bounded by
 * ARG_MAX. macOS allows 1 MiB for the whole argv; 128 KiB leaves room for the rest and turns an
 * E2BIG from spawn into an error that names the file.
 */
export const PROMPT_LIMIT_BYTES = 128 * 1024

/**
 * OpenCode in headless mode: `opencode run -m provider/model`.
 *
 * Unlike `claude -p` there is no schema flag and no way to turn the tools off, so the answer is
 * scraped out of whatever it printed. `--format default` rather than `--format json`: the JSON
 * event schema is undocumented and could not be recorded from a real run, while "the model's reply
 * appears in stdout" is true of both — fewer assumptions, and it survives an event-schema change.
 */
export const opencodeProvider: LlmProvider = {
  name: "opencode",
  async ask(request: LlmRequest): Promise<LlmFinding[]> {
    const size = Buffer.byteLength(request.prompt, "utf8")
    if (size > PROMPT_LIMIT_BYTES) {
      throw new Error(
        `prompt is too large for the opencode provider: ${size} bytes against a limit of ${PROMPT_LIMIT_BYTES}. Narrow the rule's files, or use a provider that takes the prompt on stdin.`,
      )
    }

    const command = await resolveCli("opencode", request.cwd)
    const result = await runCli(command, ["run", "--model", request.model, "--format", "default", request.prompt], {
      cwd: request.cwd,
      input: "",
      env: request.env,
      signal: request.signal,
    })

    const scanned = responseSchema.safeParse(extractFindingsJson(result.stdout))
    if (scanned.success) return scanned.data.findings
    throw new Error(
      `opencode returned no usable JSON (exit ${result.code}): ${firstLine(result.stderr || result.stdout)}`,
    )
  },
  available: ({ cwd, signal }) => cliAvailable("opencode", cwd, signal),
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.slice(0, 200) ?? ""
}
