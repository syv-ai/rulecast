import { type CompiledRule, type DetectorRule, isDetectorRule } from "../compile/rule"
import type { DetectorEvent } from "../types"

export interface Selection {
  rule: DetectorRule
  files: string[]
}

/** Rules whose detector runs on this event (their stages include it), with the files each applies to. */
export function selectDetectorRules(
  rules: readonly CompiledRule[],
  event: DetectorEvent,
  files: readonly string[],
  disabled: ReadonlySet<string>,
): Selection[] {
  return rules
    .filter(
      (rule): rule is DetectorRule => isDetectorRule(rule) && rule.stages.includes(event) && !disabled.has(rule.id),
    )
    .map((rule) => ({ rule, files: files.filter((file) => rule.matches(file)) }))
    .filter((selection) => selection.files.length > 0)
}

/** Every rule of one detector kind, in the shape the warm and check contracts take them. */
export function rulesOfKind(rules: readonly CompiledRule[], kind: string): { id: string; config: unknown }[] {
  return rules
    .filter(isDetectorRule)
    .filter((rule) => rule.detector.kind === kind)
    .map((rule) => ({ id: rule.id, config: rule.detector.config }))
}

/** Rules with stage touch that apply to one of the files and have not fired in this agent context. */
export function selectTouchRules(
  rules: readonly CompiledRule[],
  files: readonly string[],
  touched: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
): CompiledRule[] {
  return rules.filter(
    (rule) =>
      rule.stages.includes("touch") &&
      !touched.has(rule.id) &&
      !disabled.has(rule.id) &&
      files.some((file) => rule.matches(file)),
  )
}
