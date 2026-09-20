/**
 * Finds a `{"findings": [...]}` object anywhere in a model's reply.
 *
 * Only `claude-code` can enforce a schema (`--json-schema`); OpenCode has no such flag and the two
 * HTTP providers answer with free text, so scraping is the common denominator. It takes the *last*
 * such object, so a model that reasons in JSON before answering still parses.
 */
export function extractFindingsJson(text: string): { findings: unknown[] } | null {
  let found: { findings: unknown[] } | null = null
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = objectEnd(text, start)
    if (end === -1) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(start, end))
    } catch {
      continue
    }
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { findings?: unknown }).findings)) {
      found = parsed as { findings: unknown[] }
      // Keep scanning: a later object wins, and nested objects are skipped past by `start`.
      start = end - 1
    }
  }
  return found
}

/** The index just past the object opening at `start`, or -1 when it never closes. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]!
    if (inString) {
      if (char === "\\") i++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return i + 1
  }
  return -1
}
