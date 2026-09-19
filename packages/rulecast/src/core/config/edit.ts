import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml"

export interface RevUpdate {
  /** Index of the entry in `repos`. */
  index: number
  rev: string
  /** Freezing: the tag the SHA in `rev` stands for, written as a `# frozen: <tag>` comment. */
  frozenTag: string | null
}

const FROZEN = /^\s*#\s*frozen:/

function quoted(value: string, type: Scalar.Type | undefined): string {
  if (type === "QUOTE_DOUBLE") return JSON.stringify(value)
  if (type === "QUOTE_SINGLE") return `'${value.replaceAll("'", "''")}'`
  return value
}

/**
 * Rewrites `repos[index].rev` values in config text. Every other byte stays as written: edits are made
 * on the source ranges the YAML parser reports, not by re-serialising the document.
 */
export function setRevs(text: string, updates: readonly RevUpdate[]): string {
  if (updates.length === 0) return text
  const doc = parseDocument(text, { keepSourceTokens: true })
  const repos = doc.get("repos", true)
  if (!isSeq(repos)) throw new Error("repos must be a list")
  const edits: { start: number; end: number; text: string }[] = []
  for (const update of updates) {
    const entry = repos.items[update.index]
    if (!isMap(entry)) throw new Error(`repos[${update.index}] is not a mapping`)
    const rev = entry.get("rev", true)
    if (!isScalar(rev) || !rev.range) throw new Error(`repos[${update.index}] has no rev`)
    // range: [start, end of the value, end of the node including trailing whitespace and comment].
    const [start, valueEnd] = rev.range
    const value = quoted(update.rev, rev.type)
    if (entry.flow) {
      // `{ repo: …, rev: …, rules: … }`: the rest of the line belongs to the mapping, so only the value changes.
      edits.push({ start, end: valueEnd, text: value })
      continue
    }
    const newline = text.indexOf("\n", valueEnd)
    let end = newline === -1 ? text.length : newline
    if (text[end - 1] === "\r") end--
    let tail = text.slice(valueEnd, end)
    if (update.frozenTag !== null) tail = `  # frozen: ${update.frozenTag}`
    else if (FROZEN.test(tail)) tail = ""
    edits.push({ start, end, text: value + tail })
  }
  let result = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }
  return result
}
