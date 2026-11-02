import { createHash } from "node:crypto"

import { type Diagnostic, diagnosticText } from "./compile/project"

export type Warning = { key: string; text: string }

/**
 * Above this many warnings of one kind, they collapse into one carrying a count and an example.
 *
 * An agent mid-session cannot act on eighty individual compile errors, and the detail is in
 * `rulecast validate` and the debug log either way. Stress testing measured 80 broken rules as
 * 13,500 characters against a 9,000 character budget, with the one rule that fired dropped whole.
 */
const SUMMARY_THRESHOLD = 3

const DEFAULT_HINT = "rulecast validate"

/** The warnings for what `disabledRules` lists: compile errors and detector failures, one or summed. */
export const DISABLED_WARNING = /^(diagnostics?|detector):/

/**
 * The key a summary is delivered under.
 *
 * Warnings are announced once per agent context (`decide.ts`), so a single fixed key would silence
 * a rule that breaks *later* in the session. Keying on the set of rules means a set that changes
 * re-announces and a set that does not stays quiet.
 */
function summaryKey(prefix: string, ids: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...ids].sort().join("\n"))
    .digest("hex")
    .slice(0, 16)
  return `${prefix}:${digest}`
}

/**
 * One warning per failed rule, or — above the threshold — one for all of them.
 *
 * A rule repo pinned to a rev that has moved, or a `minimum_rulecast_version` bump, invalidates
 * many rules at once, and that is exactly the moment the rules that still work matter most.
 */
export function compileWarnings(errors: readonly Diagnostic[]): Warning[] {
  if (errors.length <= SUMMARY_THRESHOLD) {
    return errors.map((diagnostic) => ({
      key: `diagnostic:${diagnostic.source}:${diagnostic.rule ?? ""}:${diagnostic.message}`,
      text: `${diagnosticText(diagnostic)} (run ${diagnostic.hint ?? DEFAULT_HINT})`,
    }))
  }
  // A missing repo says "rulecast install" and a bad rule says "rulecast validate"; a mixed set has
  // no one lever, and validate is the command that lists them all.
  const hints = new Set(errors.map((diagnostic) => diagnostic.hint ?? DEFAULT_HINT))
  const hint = hints.size === 1 ? [...hints][0] : DEFAULT_HINT
  return [
    {
      key: summaryKey(
        "diagnostics",
        errors.map((diagnostic) => diagnostic.rule ?? diagnostic.source),
      ),
      text: `${errors.length} rules failed to compile and were skipped — run ${hint}.\nFirst: ${diagnosticText(errors[0]!)}`,
    },
  ]
}

/**
 * Detector errors, collapsed per kind above the threshold: one detector that fails disables every
 * rule that uses it, and a dozen copies of the same sentence tell the agent nothing the count does not.
 */
export function detectorWarnings(
  errors: readonly { kind: string; rules: string[]; message: string }[],
  /** Whether a session will remember the disable. A CLI run has none, so it says what it did. */
  scope: "session" | "run",
): Warning[] {
  const outcome = scope === "session" ? "Disabled for this session." : "Skipped for this run."
  const text = (error: { kind: string; rules: string[]; message: string }) =>
    `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. ${outcome}`
  const byKind = new Map<string, { kind: string; rules: string[]; message: string }[]>()
  for (const error of errors) {
    const group = byKind.get(error.kind)
    if (group === undefined) byKind.set(error.kind, [error])
    else group.push(error)
  }
  const summarised: Warning[] = []
  for (const [kind, group] of byKind) {
    if (group.length <= SUMMARY_THRESHOLD) {
      summarised.push(
        ...group.map((error) => ({
          key: `detector:${kind}:${error.rules.join(",")}:${error.message}`,
          text: text(error),
        })),
      )
      continue
    }
    const ids = group.flatMap((error) => error.rules)
    summarised.push({
      key: summaryKey(`detector:${kind}`, ids),
      text: `${ids.length} ${kind} rules ${scope === "session" ? "were disabled this session" : "were skipped in this run"} — see debug.log.\nFirst: ${text(group[0]!)}`,
    })
  }
  return summarised
}
