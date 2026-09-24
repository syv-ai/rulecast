import type { CompiledRule, DetectorRule, TouchRule } from "../../src/core/compile/rule"

type Overrides = Partial<Omit<CompiledRule, "matches">> & { id: string; files?: string }

/**
 * Builds a CompiledRule for tests without going through compile(). `files` is a regex, searched
 * like compile's.
 *
 * The overloads mirror what compile guarantees: a rule built with the default detector is a
 * `DetectorRule`, so it can be handed to `runDetection` and friends without an assertion, and one
 * built with `detector: null` is a `TouchRule`.
 */
export function rule(overrides: Overrides & { detector: null }): TouchRule
export function rule(overrides: Overrides): DetectorRule
export function rule(overrides: Overrides): CompiledRule {
  const { files = "", ...rest } = overrides
  const include = new RegExp(files)
  return {
    name: overrides.id,
    description: null,
    source: "local",
    severity: "error",
    refuseWrite: false,
    stages: ["edit", "verify"],
    detector: { kind: "regex", config: { pattern: "x", flags: "" }, captures: [] },
    message: "{{file}}:{{line}}",
    context: [],
    matches: (file) => include.test(file),
    ...rest,
  }
}
