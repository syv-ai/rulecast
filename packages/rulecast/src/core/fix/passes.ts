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
  /**
   * Findings whose fix left them in place, or made the same violation again: reverted, never retried.
   * And every finding of a file in `unsettled`, as the file was given.
   */
  unresolved: FixSite[]
  /** Files with fixes still pending after MAX_PASSES: given back as they came, none of their fixes kept. */
  unsettled: string[]
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

/** A rule's span of text, as offsets: [start, end). */
type Region = { rule: string; start: number; end: number }

/**
 * Where offset `at` of the text before `edits` lies in the text after them; `spans` is where each
 * edit's new text lies (applyEdits). An offset inside an edit goes to the start or the end of what
 * replaced it, so a region an edit cut into grows to cover the edit.
 */
function mapOffset(at: number, edits: readonly Fixable[], spans: readonly [number, number][], side: 0 | 1): number {
  let mapped = at
  for (const [index, { fix }] of edits.entries()) {
    if (fix.end <= at) mapped = at + spans[index]![1] - fix.end
    else if (fix.start < at) return spans[index]![side]
    else break
  }
  return mapped
}

/** The lines `match` spans in `text`, as offsets: an ignore covers whole lines. */
function linesOf(text: string, match: Match): [number, number] {
  const starts = [0]
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1)
  const start = starts[match.line - 1] ?? text.length
  const end = (starts[match.endLine] ?? text.length + 1) - 1
  return [start, Math.max(start, end)]
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
 * Whether a finding of the same rule lies wholly on the text an edit wrote: the fix did not remove
 * its finding, or wrote the violation back. One that only overlaps it, taking in text around it, is
 * new work for the next pass: adjacent fixes can join into a match that fixing again resolves
 * (`aa` → `a` on `aaaa`). A pair that never settles runs into MAX_PASSES, and its file is given back.
 */
function refires(span: [number, number], after: readonly { fix?: TextEdit }[]): boolean {
  const [start, end] = span
  return after.some(({ fix }) => {
    if (fix === undefined) return false
    return fix.start >= start && fix.end <= end && (fix.start < end || start === end)
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
 * are never fixed. Nor are they in a later pass, after another fix moved the ignore away from them:
 * the lines each one was on at the start are followed through every edit, and a finding of its rule
 * on them is left alone.
 *
 * A file with fixes still pending after MAX_PASSES never settled, and fixing it again would change
 * it again: it is given back as it came, and its findings are reported unresolved.
 */
export async function fixPasses(input: FixInput): Promise<FixResult> {
  const contents = new Map(input.contents)
  const result: FixResult = { contents, changed: [], fixed: [], unresolved: [], unsettled: [], errors: [] }
  const original = new Map(input.contents)
  const given = new Set(contents.keys())
  const selections = input.selections
    .map((selection) => ({ ...selection, files: selection.files.filter((file) => given.has(file)) }))
    .filter((selection) => selection.files.length > 0)
  if (selections.length === 0) return result

  const volatile = (kind: string) => input.detection.registry.get(kind)?.volatileCaptures ?? []
  const ignored = new Map<string, Region[]>()
  const detect = async (texts: ReadonlyMap<string, string>, first = false): Promise<Fixable[] | null> => {
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
    if (first) {
      for (const { rule, match } of output.ignored) {
        const [start, end] = linesOf(texts.get(match.file)!, match)
        ignored.set(match.file, [...(ignored.get(match.file) ?? []), { rule: rule.id, start, end }])
      }
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

  /** Whether a finding lies on lines that were ignored for its rule: inclusive, to err towards leaving it. */
  const wasIgnored = ({ rule, match, fix }: Fixable) =>
    (ignored.get(match.file) ?? []).some(
      (region) => region.rule === rule.id && fix.start <= region.end && fix.end >= region.start,
    )
  const givenUp = new Set<string>()
  const pendingIn = (findings: Fixable[]) =>
    findings.filter((finding) => !givenUp.has(contentKey(finding)) && !wasIgnored(finding))
  const initial = await detect(contents, true)
  let found = initial
  let exhausted = false
  for (let pass = 0; found !== null && pass < MAX_PASSES; pass++) {
    const pending = pendingIn(found)
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
      const regions = new Map<string, Region[]>()
      for (const [file, list] of planned) {
        const kept = list.filter(keep)
        const applied = applyEdits(contents.get(file)!, kept)
        next.set(file, applied.text)
        for (const [index, edit] of kept.entries()) spans.set(edit, applied.spans[index]!)
        const moved = (ignored.get(file) ?? []).map((region) => ({
          rule: region.rule,
          start: mapOffset(region.start, kept, applied.spans, 0),
          end: mapOffset(region.end, kept, applied.spans, 1),
        }))
        if (moved.length > 0) regions.set(file, moved)
      }
      return { next, spans, regions }
    }

    let { next, spans, regions } = apply(() => true)
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
      ;({ next, spans, regions } = apply((edit) => !failed.has(edit)))
      after = await detect(next)
      if (after === null) break
    }
    for (const edit of spans.keys()) result.fixed.push(site(edit))
    for (const [file, text] of next) contents.set(file, text)
    for (const [file, moved] of regions) ignored.set(file, moved)
    found = after
    if (pass === MAX_PASSES - 1) exhausted = true
  }

  if (exhausted && found !== null) {
    const unsettled = new Set(pendingIn(found).map((finding) => finding.match.file))
    for (const file of unsettled) contents.set(file, original.get(file)!)
    result.fixed = result.fixed.filter((fixed) => !unsettled.has(fixed.file))
    result.unresolved = [
      ...result.unresolved.filter((fixed) => !unsettled.has(fixed.file)),
      ...initial!.filter((finding) => unsettled.has(finding.match.file)).map(site),
    ]
    result.unsettled = [...unsettled].sort()
  }

  result.changed = [...contents].filter(([file, text]) => original.get(file) !== text).map(([file]) => file)
  result.changed.sort()
  return result
}
