import { type Diagnostic, diagnosticText } from "./compile/project"

/**
 * Configured rules that are not running, grouped by why (#29): a rule repo missing from the cache,
 * a rule that failed to compile, a detector whose tool is not installed. Never the deliberate
 * skips — a metered detector left out, a file budget, a whole-project rule in a staged run — which
 * have their own lines and their own flags.
 */
export interface DisabledGroup {
  reason: string
  /** The command that fixes it, when there is one: "rulecast install". */
  hint?: string
  /** Empty: the config itself did not load, so no rule ran and there is nothing to count. */
  rules: string[]
}

export interface DisabledInput {
  /** Compile diagnostics; warnings are ignored, only errors keep rules from running. */
  diagnostics: readonly Diagnostic[]
  /** Detector failures: this event's, and the ones the session recorded as disabled earlier. */
  detectorErrors: readonly { kind: string; rules: readonly string[]; message: string }[]
}

export function disabledRules(input: DisabledInput): DisabledGroup[] {
  const groups = new Map<string, DisabledGroup>()
  const seen = new Set<string>()
  /** Reasons that stand for the whole config, kept although they name no rule. */
  const whole = new Set<string>()
  const add = (reason: string, rules: readonly string[], hint?: string) => {
    let group = groups.get(reason)
    if (group === undefined) {
      group = { reason, ...(hint === undefined ? {} : { hint }), rules: [] }
      groups.set(reason, group)
    }
    // A rule is counted once, under the first reason found for it.
    for (const rule of rules) {
      if (seen.has(rule)) continue
      seen.add(rule)
      group.rules.push(rule)
    }
  }
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.level !== "error") continue
    const rules = diagnostic.rule !== null ? [diagnostic.rule] : (diagnostic.rules ?? [])
    if (diagnostic.rule === null && diagnostic.rules === undefined) {
      const reason = `the config did not load: ${diagnosticText(diagnostic)}`
      whole.add(reason)
      add(reason, [], diagnostic.hint)
    } else add(diagnosticText({ ...diagnostic, rule: null }), rules, diagnostic.hint)
  }
  for (const error of input.detectorErrors) add(`${error.kind} detector: ${error.message}`, error.rules)
  return [...groups.values()]
    .filter((group) => group.rules.length > 0 || whole.has(group.reason))
    .map((group) => ({ ...group, rules: [...group.rules].sort() }))
    .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0))
}

/** "3 rules disabled: syv-ai/rulecast@v0.4.0: not in the cache (run rulecast install)". */
export function disabledText(group: DisabledGroup): string {
  const hint = group.hint === undefined ? "" : ` (run ${group.hint})`
  if (group.rules.length === 0) return `no rules ran: ${group.reason}${hint}`
  const count = `${group.rules.length} ${group.rules.length === 1 ? "rule" : "rules"}`
  return `${count} disabled: ${group.reason}${hint}`
}

/** How many rules the groups keep from running. */
export function disabledCount(groups: readonly DisabledGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rules.length, 0)
}
