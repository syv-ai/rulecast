import { stringify } from "yaml"

/** A .rulecast-config.yaml with one local repo holding `rules`, plus top-level `settings` (snake_case). */
export function localConfig(rules: Record<string, unknown>[], settings: Record<string, unknown> = {}): string {
  return stringify({ ...settings, repos: [{ repo: "local", rules }] })
}
