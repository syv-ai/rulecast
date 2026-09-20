/**
 * ast-grep metavariables: `$NAME` matches one node, `$$$NAMES` matches several. The `$$$` branch
 * comes first so `$$$ARGS` is never read as the `$ARGS` inside it. Names starting with `_` are
 * ast-grep's non-capturing form.
 */
const METAVARIABLE = /\$\$\$([A-Z_][A-Z0-9_]*)|\$([A-Z_][A-Z0-9_]*)/g

export interface Metavariable {
  name: string
  /** Matched several nodes: the capture is their text joined with ", ". */
  multi: boolean
}

function scan(value: unknown, into: Map<string, boolean>): void {
  if (typeof value === "string") {
    for (const found of value.matchAll(METAVARIABLE)) {
      const multi = found[1] !== undefined
      const name = found[1] ?? found[2]!
      if (name.startsWith("_")) continue
      into.set(name, (into.get(name) ?? false) || multi)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) scan(item, into)
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) scan(item, into)
  }
}

/** Every capture name in a rule, constraints and utils, in the order they first appear. */
export function metavariables(config: unknown): Metavariable[] {
  const found = new Map<string, boolean>()
  scan(config, found)
  return [...found].map(([name, multi]) => ({ name, multi }))
}
