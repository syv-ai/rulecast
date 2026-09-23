import type { Match, WriteIntent } from "../types"
import { lineStarts } from "./positions"

export interface Proposal {
  /** The file as it will be if the write goes ahead. */
  content: string
  /** Half-open character ranges of the text the agent is adding, in `content`. */
  inserts: [start: number, end: number][]
}

/**
 * The file the agent's tool call would leave behind, or null when that cannot be said exactly.
 *
 * Null is the important answer: a refusal rests on this, so anything ambiguous — an `old_string`
 * that is missing, or that appears twice without `replace_all` — gives up and lets the write
 * through. The edit hook still reports it a moment later. Being wrong in that direction costs a
 * late message; being wrong in the other costs the agent a write it was entitled to make.
 */
export function propose(current: string | null, intent: WriteIntent): Proposal | null {
  if (intent.content !== undefined) {
    // A whole-file write needs no reconstruction: the content is the payload.
    return { content: intent.content, inserts: intent.content === "" ? [] : [[0, intent.content.length]] }
  }
  if (intent.edit === undefined || current === null) return null
  const { find, replace, all } = intent.edit
  if (find === "") return null
  const first = current.indexOf(find)
  if (first === -1) return null
  if (!all && current.indexOf(find, first + find.length) !== -1) return null

  let content = ""
  let rest = current
  const inserts: [number, number][] = []
  for (;;) {
    const at = rest.indexOf(find)
    if (at === -1) break
    const start = content.length + at
    content += rest.slice(0, at) + replace
    if (replace !== "") inserts.push([start, start + replace.length])
    rest = rest.slice(at + find.length)
    if (!all) break
  }
  return { content: content + rest, inserts }
}

/**
 * Whether a match is evidence from the agent's own text. A `path` match is the file itself, and
 * writing the file is what the rule forbids, so it always counts; everything else must overlap
 * what is being inserted, compared by character so a match sharing only a line does not.
 */
export function isInserted(proposal: Proposal, match: Match, detector: string): boolean {
  if (detector === "path") return true
  const starts = lineStarts(proposal.content)
  const lineStart = starts[match.line - 1]
  if (lineStart === undefined) return false
  const start = lineStart + match.column - 1
  const end = start + match.text.length
  return proposal.inserts.some(([from, to]) => start < to && end > from)
}
