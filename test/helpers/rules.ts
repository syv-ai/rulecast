import picomatch from "picomatch"

import type { CompiledRule } from "../../src/core/compile/compile"

/** Builds a CompiledRule for tests without going through compile(). */
export function rule(overrides: Partial<Omit<CompiledRule, "matches">> & { id: string; files?: string }): CompiledRule {
  const { files = "**", ...rest } = overrides
  const include = picomatch(files, { dot: true })
  return {
    source: `.rulecast/rules/${overrides.id}.yml`,
    severity: "error",
    on: ["violation"],
    detector: { kind: "regex", config: { pattern: "x", flags: "" }, captures: [], events: ["edit", "verify"] },
    message: "{{file}}:{{line}}",
    context: [],
    matches: (file) => include(file),
    ...rest,
  }
}
