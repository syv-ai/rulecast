/**
 * A Claude Code stop hook's output, read the way the agent gets it. Attended, findings arrive as
 * Stop or SubagentStop context, unattended as a block; both hold the stop, so both read here as
 * `decision: "block"` with the text as `reason`. Anything else on the output is kept as it is.
 */
export function stopVerdict(stdout: string): { decision?: string; reason?: string; [key: string]: unknown } {
  if (stdout === "") return {}
  const output = JSON.parse(stdout) as Record<string, unknown>
  const specific = output.hookSpecificOutput as { hookEventName?: string; additionalContext?: string } | undefined
  if (specific?.hookEventName !== "Stop" && specific?.hookEventName !== "SubagentStop") return output
  const { hookSpecificOutput: _, ...rest } = output
  return { ...rest, decision: "block", reason: specific.additionalContext }
}
