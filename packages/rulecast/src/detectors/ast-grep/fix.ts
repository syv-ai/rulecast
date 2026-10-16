import type { TextEdit } from "../../core/types"
import { METAVARIABLE, type Metavariable } from "./metavars"

/** The part of a parsed node a fix needs; structural, like detector.ts's `Node`. */
export interface FixNode {
  text(): string
  range(): { start: { index: number }; end: { index: number } }
  getMatch(name: string): FixNode | null
  getMultipleMatches(name: string): FixNode[]
}

/**
 * What a metavariable is replaced with. `$$$NAMES` is the source from its first matched node to its
 * last, so the separators and comments between them survive: the capture a message gets joins the
 * named nodes with ", ", which would rewrite every argument list it touched.
 */
function substitute(node: FixNode, variable: Metavariable, source: string): string {
  if (!variable.multi) return node.getMatch(variable.name)?.text() ?? ""
  const nodes = node.getMultipleMatches(variable.name)
  if (nodes.length === 0) return ""
  return source.slice(nodes[0]!.range().start.index, nodes.at(-1)!.range().end.index)
}

/**
 * The edit that replaces `node` with the rule's `fix`.
 *
 * `@ast-grep/napi` has no metavariable-aware fix (`SgNode.replace` inserts text literally), so the
 * substitution is done here. A fix spanning lines has lines 2+ indented by the indentation of the
 * line the match starts on, as ast-grep's CLI does: a fix written flush left lands at the match's
 * depth. Its line breaks are the file's, read from the line the match starts on (or, on a last line
 * with none, the line before it), so a CRLF file stays CRLF. Values are inserted as they are in the
 * source, after that indentation is added.
 *
 * The range's `index` is a UTF-16 offset, the unit a JavaScript string indexes by, although napi's
 * types call it a byte offset: test/detectors/ast-grep/fix.test.ts pins that with non-ASCII text
 * before a match.
 */
export function fixEdit(node: FixNode, fix: string, variables: Metavariable[], source: string): TextEdit {
  const range = node.range()
  const lineStart = source.lastIndexOf("\n", range.start.index - 1) + 1
  const indent = /^[ \t]*/.exec(source.slice(lineStart, range.start.index))![0]
  const lineEnd = source.indexOf("\n", range.start.index)
  const crlf = lineEnd === -1 ? source[lineStart - 2] === "\r" : source[lineEnd - 1] === "\r"
  const indented = fix
    .split(/\r?\n/)
    .map((line, index) => (index === 0 || line === "" ? line : indent + line))
    .join(crlf ? "\r\n" : "\n")
  const byName = new Map(variables.map((variable) => [variable.name, variable]))
  const text = indented.replace(METAVARIABLE, (whole, multi: string | undefined, single: string | undefined) => {
    const variable = byName.get((multi ?? single)!)
    return variable === undefined ? whole : substitute(node, variable, source)
  })
  return { start: range.start.index, end: range.end.index, text }
}
