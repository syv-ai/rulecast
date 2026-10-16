import type { DetectionContext } from "../detection/context"
import { type DetectionOutput, runDetection } from "../detection/run"
import type { Selection } from "../detection/select"
import { findingIds } from "../finding-id"
import type { Match, TextEdit } from "../types"

/**
 * Passes before `rulecast fix` gives up on what is left: eslint's limit. A fix that keeps creating
 * work for another fix is a pair of rules that disagree, and ten rounds of it is plenty to show it.
 */
export const MAX_PASSES = 10

/** A finding a fix was applied to, or one whose fix did not remove it. The id is the finding's before the edit. */
export interface FixSite {
  id: string
  rule: string
  file: string
  line: number
}

export interface FixInput {
  detection: DetectionContext
  /** Fixable rules, each with the files it applies to. */
  selections: Selection[]
  /** The text of every selected file. A file not in it is absent. */
  contents: ReadonlyMap<string, string>
  timeoutMs: number
}

export interface FixResult {
  /** Every file's text after the passes; a file no fix touched keeps the string it came with. */
  contents: Map<string, string>
  /** The files whose text changed, sorted. */
  changed: string[]
  fixed: FixSite[]
  /** Findings whose fix left them in place, or made the same violation again: reverted, never retried. */
  unresolved: FixSite[]
  /** Fixes were still pending after MAX_PASSES. */
  exhausted: boolean
  /** A detector failed or timed out: the pass it happened in was not applied. */
  errors: string[]
}

type Fixable = { id: string; rule: Selection["rule"]; match: Match; fix: TextEdit }

/**
 * What makes two findings the same violation for a fix: the rule, the file and the match's content,
 * without the occurrence index in its id. Identical text gets an identical edit, so once one of them
 * is known not to resolve, none of them is tried again.
 */
function contentKey({ rule, match }: { rule: { id: string }; match: Match }): string {
  const captures = Object.keys(match.captures)
    .sort()
    .map((name) => `${name}=${match.captures[name]}`)
  return [rule.id, match.file, match.text, ...captures].join("\u0000")
}

const site = ({ id, rule, match }: Fixable): FixSite => ({ id, rule: rule.id, file: match.file, line: match.line })

/** The edits that can go in together: sorted by start, each one that overlaps an earlier one deferred. */
function nonOverlapping(edits: Fixable[]): Fixable[] {
  const sorted = [...edits].sort((a, b) => a.fix.start - b.fix.start || a.fix.end - b.fix.end)
  const kept: Fixable[] = []
  let end = -1
  for (const edit of sorted) {
    // Two insertions at one point overlap too: their order would decide the result.
    if (kept.length > 0 && (edit.fix.start < end || edit.fix.start === kept.at(-1)!.fix.start)) continue
    kept.push(edit)
    end = edit.fix.end
  }
  return kept
}

/** `text` with `edits` applied, which must not overlap; also where each edit's new text now lies. */
function applyEdits(text: string, edits: readonly Fixable[]): { text: string; spans: [number, number][] } {
  let out = ""
  let at = 0
  const spans: [number, number][] = []
  for (const { fix } of edits) {
    out += text.slice(at, fix.start)
    spans.push([out.length, out.length + fix.text.length])
    out += fix.text
    at = fix.end
  }
  return { text: out + text.slice(at), spans }
}

/**
 * Whether a finding of the same rule lies on the text an edit wrote: the fix did not remove its
 * finding, or wrote the violation back. A deletion leaves an empty span, which only a match
 * straddling the point it left can be on.
 */
function refires(span: [number, number], after: readonly { fix?: TextEdit }[]): boolean {
  const [start, end] = span
  return after.some(({ fix }) => {
    if (fix === undefined) return false
    return start === end ? fix.start < start && fix.end > start : fix.start < end && fix.end > start
  })
}

/**
 * Apply the selected rules' fixes to `contents`, in memory, over at most MAX_PASSES passes.
 *
 * Each pass detects with `fixes: true`, applies every edit that does not overlap an earlier one in
 * its file (the next pass gets the rest), and detects again. An edit after which the same rule
 * still fires on the text it wrote is reverted and reported as unresolved, and the same violation
 * is not tried again: that is what keeps a bad fix from being left half-applied, and what makes a
 * second `rulecast fix` a no-op. An edit that changes nothing is unresolved without being applied.
 *
 * Ignored findings (`rulecast-ignore`) are dropped by `runDetection` before they get here, so they
 * are never fixed.
 */
export async function fixPasses(input: FixInput): Promise<FixResult> {
  const contents = new Map(input.contents)
  const result: FixResult = { contents, changed: [], fixed: [], unresolved: [], exhausted: false, errors: [] }
  const original = new Map(input.contents)
  const given = new Set(contents.keys())
  const selections = input.selections
    .map((selection) => ({ ...selection, files: selection.files.filter((file) => given.has(file)) }))
    .filter((selection) => selection.files.length > 0)
  if (selections.length === 0) return result

  const volatile = (kind: string) => input.detection.registry.get(kind)?.volatileCaptures ?? []
  const detect = async (texts: ReadonlyMap<string, string>): Promise<Fixable[] | null> => {
    const output: DetectionOutput = await runDetection({
      detection: input.detection,
      event: "verify",
      selections,
      changes: new Map(),
      read: async (file) => texts.get(file) ?? null,
      timeoutMs: input.timeoutMs,
      fixes: true,
    })
    if (output.errors.length > 0 || output.timedOut.length > 0) {
      for (const error of output.errors) result.errors.push(`${error.rules.join(", ")}: ${error.message}`)
      for (const late of output.timedOut) result.errors.push(`${late.rules.join(", ")}: timed out`)
      return null
    }
    // Over ignored matches too, as the pipeline numbers them, so an id here is the id `run` reports.
    const ids = findingIds([...output.findings, ...output.ignored], volatile)
    // An edit outside the text it was computed from is a detector bug; applying it would corrupt the file.
    const inside = (file: string, fix: TextEdit) =>
      fix.start >= 0 && fix.start <= fix.end && fix.end <= (texts.get(file)?.length ?? -1)
    return output.findings.flatMap(({ rule, match, fix }, index) =>
      fix === undefined || !inside(match.file, fix) ? [] : [{ id: ids[index]!, rule, match, fix }],
    )
  }

  const givenUp = new Set<string>()
  let found = await detect(contents)
  for (let pass = 0; found !== null && pass < MAX_PASSES; pass++) {
    const pending = found.filter((finding) => !givenUp.has(contentKey(finding)))
    const noop = new Set(
      pending.filter(({ match, fix }) => contents.get(match.file)!.slice(fix.start, fix.end) === fix.text),
    )
    for (const finding of noop) {
      givenUp.add(contentKey(finding))
      result.unresolved.push(site(finding))
    }
    const edits = pending.filter((finding) => !noop.has(finding))
    if (edits.length === 0) break

    const byFile = new Map<string, Fixable[]>()
    for (const edit of edits) byFile.set(edit.match.file, [...(byFile.get(edit.match.file) ?? []), edit])
    const planned = new Map([...byFile].map(([file, list]) => [file, nonOverlapping(list)]))
    const apply = (keep: (edit: Fixable) => boolean) => {
      const next = new Map(contents)
      const spans = new Map<Fixable, [number, number]>()
      for (const [file, list] of planned) {
        const kept = list.filter(keep)
        const applied = applyEdits(contents.get(file)!, kept)
        next.set(file, applied.text)
        for (const [index, edit] of kept.entries()) spans.set(edit, applied.spans[index]!)
      }
      return { next, spans }
    }

    let { next, spans } = apply(() => true)
    let after = await detect(next)
    if (after === null) break
    const failed = new Set<Fixable>()
    for (const [edit, span] of spans) {
      const same = after.filter(({ rule, match }) => rule.id === edit.rule.id && match.file === edit.match.file)
      if (refires(span, same)) failed.add(edit)
    }
    if (failed.size > 0) {
      for (const edit of failed) {
        givenUp.add(contentKey(edit))
        result.unresolved.push(site(edit))
      }
      ;({ next, spans } = apply((edit) => !failed.has(edit)))
      after = await detect(next)
      if (after === null) break
    }
    for (const edit of spans.keys()) result.fixed.push(site(edit))
    for (const [file, text] of next) contents.set(file, text)
    found = after
    if (pass === MAX_PASSES - 1) {
      result.exhausted = after.some((finding) => !givenUp.has(contentKey(finding)))
    }
  }

  result.changed = [...contents].filter(([file, text]) => original.get(file) !== text).map(([file]) => file)
  result.changed.sort()
  return result
}
