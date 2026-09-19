import type { CompiledRule } from "../../src/core/compile/rule"

/** Builds a CompiledRule for tests without going through compile(). `files` is a regex, searched like compile's. */
export function rule(overrides: Partial<Omit<CompiledRule, "matches">> & { id: string; files?: string }): CompiledRule {
  const { files = "", ...rest } = overrides
  const include = new RegExp(files)
  return {
    name: overrides.id,
    description: null,
    source: "local",
    severity: "error",
    stages: ["edit", "verify"],
    detector: { kind: "regex", config: { pattern: "x", flags: "" }, captures: [] },
    message: "{{file}}:{{line}}",
    context: [],
    matches: (file) => include.test(file),
    ...rest,
  }
}
