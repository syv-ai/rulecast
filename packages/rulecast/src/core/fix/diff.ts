import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff"

/** A unified diff of one file, with git's `a/` and `b/` headers; empty when nothing changed. */
export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return ""
  return labelledDiff(`a/${file}`, `b/${file}`, before, after)
}

/**
 * A tab, newline or carriage return ends a name in a header, so git apply only reads one quoted.
 * Other names are written as they are: macOS's patch reads no quoted name at all, and git applies
 * `å.ts` and `a"b.ts` unquoted too.
 */
const ENDS_A_NAME = /[\t\n\r]/

/**
 * patch takes a name up to its first whitespace unless a tab ends it, so git ends a name holding
 * a space with a tab, and so does this. Only those: a tab after every name is trailing whitespace
 * in every diff a person reads.
 */
const HAS_WHITESPACE = /[ \v\f]/

/**
 * A unified diff between two texts under the given names; for an expected and a produced result.
 * diff quotes every name with a non-ASCII or special character the way git does; only the names that
 * need it keep that.
 */
export function labelledDiff(from: string, to: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(from, to, before, after, undefined, undefined, { headerOptions: FILE_HEADERS_ONLY })
  if (ENDS_A_NAME.test(from) || ENDS_A_NAME.test(to)) return patch
  // The two header lines, rewritten: a quoted name escapes every newline, so each is one line.
  const body = patch.slice(patch.indexOf("\n", patch.indexOf("\n") + 1) + 1)
  const header = (name: string) => (HAS_WHITESPACE.test(name) ? `${name}\t` : name)
  return `--- ${header(from)}\n+++ ${header(to)}\n${body}`
}
