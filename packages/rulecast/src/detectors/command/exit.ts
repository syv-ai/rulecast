import type { ToolResult } from "../../core/detection/tool"

/** How many lines of a failed tool's stderr a rule error carries: enough to say why, not a log. */
const STDERR_LINES = 5

/**
 * Whether this exit code says the tool failed rather than "found something" or "clean".
 *
 * Exit codes do not mean "error" uniformly — ty exits 1 on findings and 2 on a bad config, vulture
 * 3 on findings, semgrep 0 either way — so only the codes a rule lists count. Every other code is
 * read as findings-or-clean, which is what the output says.
 */
export function isToolError(exitCode: number, config: { exit_codes?: { error: number[] } }): boolean {
  return config.exit_codes?.error.includes(exitCode) ?? false
}

/** The rule error for a failed run: the command, its code, and the first lines of what it said. */
export function toolFailure(command: string, result: ToolResult): string {
  const said = (result.stderr.trim() || result.stdout.trim()).split(/\r?\n/).slice(0, STDERR_LINES).join("\n")
  return `${command} exited ${result.exitCode}${said ? `: ${said}` : ""}`
}

/** The text a rule reads its findings from. */
export function streamText(result: ToolResult, stream: "stdout" | "stderr" | "both" | undefined): string {
  if (stream === "stderr") return result.stderr
  if (stream === "both") return `${result.stdout}\n${result.stderr}`
  return result.stdout
}
