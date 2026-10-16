import { createHash } from "node:crypto"

import { IGNORE, type SourceLines } from "./suppress"
import type { Match } from "./types"

/** What an id needs to know about a detector kind (its `Detector` fields of the same names). */
interface IdTraits {
  volatileCaptures?: readonly string[]
  wholeFile?: boolean
}

/** Bumped when what an id hashes changes, so a stored id is never compared against a different scheme. */
export const FINDING_ID_VERSION = 1

/** Re-indenting a line or a CRLF checkout must not change what a finding is. */
const normalise = (value: string) => value.replace(/\s+/g, " ").trim()

/**
 * What opens the comment an inline ignore is written in, in any syntax: the run of punctuation
 * right before it (`#`, `//`, `/*`, `/**`, `{/*`, `<!--`, `--`, `;`). Quotes are not part of it, so
 * an ignore inside a string literal is not taken for a comment.
 */
const OPENER = /[^\w\s"'`]+\s*$/

/**
 * A source line without a trailing `rulecast-ignore` comment, so writing one keeps the finding's id.
 * Only an ignore that a comment opener introduces is taken off; any other is part of the line.
 */
function withoutIgnore(line: string): string {
  const ignore = IGNORE.exec(line)
  if (ignore === null) return line
  const before = line.slice(0, ignore.index)
  return OPENER.test(before) ? before.replace(OPENER, "") : line
}

/**
 * What a finding is, apart from where it is: the source lines it spans, then its captures by name.
 *
 * Its lines, not its matched text: a short match (`eval(`, `TODO`) says little about which of
 * several it is, and the line does. A match that says it is about the whole file (a `path` rule's,
 * a hook's own finding) hashes its text instead, so an edit anywhere in the file does not make it a
 * different finding, and no whole file is hashed. So does a redacted match, whose line is a secret,
 * and a match whose file could not be read. Captures a detector declared volatile (a model's
 * `reason`, which differs between two runs over the same line) are left out, or the same finding
 * would get a new id on every run.
 */
function contentOf(match: Match, source: readonly string[] | null, kind: IdTraits) {
  const volatile = kind.volatileCaptures ?? []
  const captures = Object.keys(match.captures)
    .filter((name) => !volatile.includes(name))
    .sort()
    .map((name) => `${name}=${normalise(match.captures[name] ?? "")}`)
  const byText = kind.wholeFile === true || match.wholeFile === true || match.redacted === true
  const lines =
    byText || source === null || match.line < 1 || match.line > source.length
      ? null
      : source.slice(match.line - 1, Math.max(match.line, match.endLine)).map(withoutIgnore)
  return [lines === null ? normalise(match.text) : normalise(lines.join("\n")), ...captures].join("\u0000")
}

/**
 * A stable id per finding, in the same order as `items` (output contract, agents/reference/output.md).
 *
 * The id hashes the rule id (the alias, when one is set), the project-relative file, the source
 * lines the match spans (normalised, any trailing `rulecast-ignore` comment left out), its stable
 * captures and an occurrence index, and **not the line number**: a loop must recognise the same
 * violation after unrelated lines were inserted above it. So an id changes exactly when the
 * finding's lines do, which is also when rulecast calls a finding new. The occurrence index numbers
 * findings with the same rule, file and content by position, so two identical lines stay apart.
 *
 * `items` should include ignored matches too, so a `rulecast-ignore` on the first of two
 * duplicates does not renumber the second. `detector` looks up a kind's `volatileCaptures` and
 * `wholeFile`. `linesOf` must give the content detection judged (staged in a staged run, the
 * proposal in a guard): the `lines` detection was given, so no file is read a second time.
 */
export async function findingIds(
  items: readonly { rule: { id: string; detector: { kind: string } }; match: Match }[],
  detector: (kind: string) => IdTraits | undefined,
  linesOf: SourceLines,
): Promise<string[]> {
  const keys = await Promise.all(
    items.map(
      async ({ rule, match }) =>
        `${rule.id}\u0000${match.file}\u0000${contentOf(match, await linesOf(match.file), detector(rule.detector.kind) ?? {})}`,
    ),
  )
  const groups = new Map<string, number[]>()
  keys.forEach((key, index) => {
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [index])
    else group.push(index)
  })
  const ids: string[] = new Array(items.length)
  for (const [key, indices] of groups) {
    const at = (index: number) => items[index]!.match
    indices.sort((a, b) => at(a).line - at(b).line || at(a).column - at(b).column || at(a).endLine - at(b).endLine)
    indices.forEach((index, occurrence) => {
      ids[index] = createHash("sha256")
        .update(`v${FINDING_ID_VERSION}\u0000${key}\u0000${occurrence}`)
        .digest("hex")
        .slice(0, 16)
    })
  }
  return ids
}
