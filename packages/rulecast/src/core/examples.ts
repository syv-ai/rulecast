import { writeFile } from "node:fs/promises"
import path from "node:path"

import { computeChanges } from "./baseline/baseline"
import { type ContainerRanges, classify } from "./baseline/classify"
import { snapshotOf } from "./baseline/hash"
import type { DetectorRule } from "./compile/rule"
import type { BadRuleExample, BaselineRuleExample, RuleExample } from "./config/schema"
import type { DetectionContext } from "./detection/context"
import { readSourceFile } from "./detection/per-rule"
import { type DetectionOutput, runDetection } from "./detection/run"
import { withScratchTree } from "./detection/scratch"
import { renderTemplate } from "./template"
import type { ChangeSet, Match } from "./types"

export interface ExampleFinding {
  line: number
  endLine: number
  column: number
  /** What the detector matched, for a failure that the line alone does not explain. */
  text: string
  message: string
  /** Baseline examples only: how the rule's own `scope` classified it. */
  status?: "new" | "preexisting"
}

/** What an example was held to. */
export type ExampleExpectation =
  | { fires: false }
  /** `count` and `lines` only when the example's `expect` pins them; otherwise at least one finding. */
  | { fires: true; count?: number; lines?: number[] }
  /** A baseline example: the lines of its new and its pre-existing findings. */
  | { new: number[]; preexisting: number[] }

export interface ExampleOutcome {
  kind: "good" | "bad" | "baseline"
  /** 0-based within its own list, so a failure can be named `good[1]`. */
  index: number
  path: string
  passed: boolean
  expected: ExampleExpectation
  /** What the rule found, passing or not. */
  findings: ExampleFinding[]
  /** Why it failed, one sentence each; empty when it passed. */
  failures: string[]
  /** The detector failed on this example. A failure, not a silent pass. */
  error?: string
}

export interface ExampleResult {
  rule: string
  outcomes: ExampleOutcome[]
  /** Of the `bad` examples, how many the rule caught. */
  recall: { matched: number; total: number }
  /** Of the `good` and `bad` examples the rule fired on, how many were `bad` ones. */
  precision: { correct: number; total: number }
  /** The rule declared no `examples` key at all. */
  missing: boolean
  /** It declared one with no cases in it. */
  empty: boolean
  /** Not run: a metered rule (llm), and no rule id was named. */
  skipped: boolean
}

export interface ExamplesInput {
  /**
   * The project's detection context (detection/context.ts). Its `root` is where the scratch
   * directory examples are written to goes; see `runExamples`.
   */
  detection: DetectionContext
  rule: DetectorRule
  timeoutMs: number
}

/** The scratch directory's prefix, inside the project root. Removed when the command finishes. */
export const EXAMPLES_DIR = ".rulecast-examples-"

export function skippedResult(rule: string): ExampleResult {
  return { ...emptyResult(rule), skipped: true }
}

function emptyResult(rule: string): ExampleResult {
  return {
    rule,
    outcomes: [],
    recall: { matched: 0, total: 0 },
    precision: { correct: 0, total: 0 },
    missing: false,
    empty: false,
    skipped: false,
  }
}

/**
 * Run a rule against its own examples.
 *
 * Each example is written to disk and checked through the same `runDetection` the pipeline uses,
 * one example per run. Writing to disk rather than serving the content from memory is what makes
 * `linter`, `command` and `llm` rules testable at all: those detectors hand a path to another
 * program. One run per example, rather than all of them batched, is what makes a failure
 * attributable — a finding in the first example would otherwise mask a miss in the third.
 *
 * Each example gets its own scratch directory inside the project root (`withScratchTree`, which
 * says why inside the root), and detection runs with the project root as its cwd. One directory
 * per example, not one per rule: a rule's good and bad examples usually share a `path`.
 *
 * A `bad` example passes on *at least one* finding unless its `expect` pins a count or the lines.
 * That stays the default because a pattern that matches a violation twice is not wrong, and a pinned
 * count makes an example brittle against a detector change. Pinning is for an author who needs to
 * know the rule fires on the right line, not merely somewhere: a drafting agent, whose over-broad
 * pattern would otherwise pass on the wrong line.
 *
 * A `baseline` example asks a different question — which findings an edit would be told are its own
 * — so it counts towards neither recall nor precision.
 */
export async function runExamples(input: ExamplesInput): Promise<ExampleResult> {
  const { rule } = input
  const result = emptyResult(rule.id)
  if (rule.examples === null) return { ...result, missing: true }

  const cases: { kind: "good" | "bad"; index: number; example: RuleExample | BadRuleExample }[] = [
    ...rule.examples.good.map((example, index) => ({ kind: "good" as const, index, example })),
    ...rule.examples.bad.map((example, index) => ({ kind: "bad" as const, index, example })),
  ]
  const baselines = rule.examples.baseline
  if (cases.length === 0 && baselines.length === 0) return { ...result, empty: true }

  for (const { kind, index, example } of cases) {
    const run = await withScratchTree(
      input.detection.root,
      EXAMPLES_DIR,
      new Map([[example.path, example.code]]),
      (scratch) => runOne(input, scratch, example),
    )
    result.outcomes.push(outcomeOf(kind, index, example.path, expectationOf(kind, example), run))
  }
  for (const [index, example] of baselines.entries()) {
    const run = await withScratchTree(
      input.detection.root,
      EXAMPLES_DIR,
      new Map([[example.path, example.before]]),
      (scratch) => runBaselineOne(input, scratch, example),
    )
    const expected = { new: example.expect.new, preexisting: example.expect.preexisting }
    result.outcomes.push(outcomeOf("baseline", index, example.path, expected, run))
  }

  const fired = (outcome: ExampleOutcome) => outcome.findings.length > 0
  const bad = result.outcomes.filter((outcome) => outcome.kind === "bad")
  const goodFired = result.outcomes.filter((outcome) => outcome.kind === "good" && fired(outcome))
  const badFired = bad.filter(fired)
  result.recall = { matched: badFired.length, total: bad.length }
  result.precision = { correct: badFired.length, total: badFired.length + goodFired.length }
  return result
}

function outcomeOf(
  kind: ExampleOutcome["kind"],
  index: number,
  file: string,
  expected: ExampleExpectation,
  run: RunOutcome,
): ExampleOutcome {
  const failures = judge(expected, run.findings, run.error)
  return {
    kind,
    index,
    path: file,
    passed: failures.length === 0,
    expected,
    findings: run.findings,
    failures,
    ...(run.error === undefined ? {} : { error: run.error }),
  }
}

function expectationOf(kind: "good" | "bad", example: RuleExample | BadRuleExample): ExampleExpectation {
  if (kind === "good") return { fires: false }
  const pinned = "expect" in example ? example.expect : undefined
  return {
    fires: true,
    ...(pinned?.count !== undefined ? { count: pinned.count } : {}),
    ...(pinned?.lines !== undefined ? { lines: [...pinned.lines] } : {}),
  }
}

const lineList = (lines: Iterable<number>) => `[${[...new Set(lines)].sort((a, b) => a - b).join(", ")}]`

const sameSet = (a: readonly number[], b: readonly number[]) => lineList(a) === lineList(b)

/**
 * Why an example failed, one sentence each; empty when it passed. A detector error fails every kind:
 * a good example whose detector broke found nothing, and that must not read as a pass.
 */
export function judge(expected: ExampleExpectation, findings: readonly ExampleFinding[], error?: string): string[] {
  if (error !== undefined) return [`the detector failed: ${error}`]
  const lines = findings.map((finding) => finding.line)
  if ("new" in expected) return judgeBaseline(expected, findings)
  if (!expected.fires) {
    if (findings.length === 0) return []
    const where = new Set(lines).size === 1 ? `line ${lines[0]}` : `lines ${lineList(lines)}`
    return [`expected no finding, found ${findings.length} on ${where}`]
  }
  if (findings.length === 0 && expected.count === undefined && expected.lines === undefined) {
    return ["expected at least one finding, found none"]
  }
  const failures: string[] = []
  if (expected.count !== undefined && expected.count !== findings.length) {
    failures.push(
      `expected ${expected.count} ${expected.count === 1 ? "finding" : "findings"}, found ${findings.length}`,
    )
  }
  if (expected.lines !== undefined && !sameSet(expected.lines, lines)) {
    failures.push(
      `expected lines ${lineList(expected.lines)}, found ${findings.length === 0 ? "none" : lineList(lines)}`,
    )
  }
  return failures
}

function judgeBaseline(
  expected: { new: number[]; preexisting: number[] },
  findings: readonly ExampleFinding[],
): string[] {
  const found = {
    new: new Set(findings.filter((finding) => finding.status === "new").map((finding) => finding.line)),
    preexisting: new Set(findings.filter((finding) => finding.status === "preexisting").map((finding) => finding.line)),
  }
  const label = { new: "new", preexisting: "pre-existing" }
  const failures: string[] = []
  const lines = [...new Set([...expected.new, ...expected.preexisting, ...found.new, ...found.preexisting])]
  for (const line of lines.sort((a, b) => a - b)) {
    for (const status of ["new", "preexisting"] as const) {
      const other = status === "new" ? "preexisting" : "new"
      const wanted = expected[status].includes(line)
      if (wanted && !found[status].has(line)) {
        failures.push(
          found[other].has(line)
            ? `line ${line}: expected ${label[status]}, was ${label[other]}`
            : `line ${line}: expected a ${label[status]} finding, found none`,
        )
      } else if (!wanted && found[status].has(line) && !expected[other].includes(line)) {
        failures.push(`line ${line}: unexpected ${label[status]} finding`)
      }
    }
  }
  return failures
}

interface RunOutcome {
  findings: ExampleFinding[]
  error?: string
}

/** The run's failure, if any: a detector error or a timeout. */
const failureOf = (output: DetectionOutput): string | undefined =>
  output.errors[0]?.message ?? (output.timedOut.length > 0 ? "timed out" : undefined)

const detect = (input: ExamplesInput, file: string, changes: ReadonlyMap<string, ChangeSet>) =>
  runDetection({
    detection: input.detection,
    event: "verify",
    selections: [{ rule: input.rule, files: [file] }],
    changes,
    read: (name) => readSourceFile(input.detection.root, name),
    timeoutMs: input.timeoutMs,
  })

async function runOne(input: ExamplesInput, scratch: string, example: RuleExample): Promise<RunOutcome> {
  // Repo-relative, as every path the core passes a detector is: <scratch>/<the example's own path>,
  // written there by withScratchTree.
  const relative = `${scratch}/${example.path}`
  // No baseline: an example is entirely new, which is what an author is asking about.
  const output = await detect(input, relative, new Map())
  const failure = failureOf(output)
  if (failure !== undefined) return { findings: [], error: failure }
  return { findings: output.findings.map(({ match }) => findingOf(input, example.path, match)) }
}

/**
 * A baseline example, the way a session sees an edit: `before` is on disk when the agent first opens
 * the file, so it is snapshotted (and, for a `container` rule, measured); then `after` replaces it
 * and the rule's findings are classified against that baseline by the rule's own `scope`.
 *
 * The container ranges are measured here with `runDetection`, not `recordContainers`, which selects
 * rules by `rule.matches` — and an anchored `files` does not match the scratch-prefixed path. A
 * metered rule is not measured, as in real use, so it classifies as `instance` here too.
 */
async function runBaselineOne(
  input: ExamplesInput,
  scratch: string,
  example: BaselineRuleExample,
): Promise<RunOutcome> {
  const { rule, detection } = input
  const relative = `${scratch}/${example.path}`
  let containers: ContainerRanges = new Map()
  if (rule.scope === "container" && detection.registry.get(rule.detector.kind)?.metered !== true) {
    const measured = await detect(input, relative, new Map())
    const failure = failureOf(measured)
    if (failure !== undefined) return { findings: [], error: failure }
    const ranges = measured.findings.map(({ match }): [number, number] => [match.line, match.endLine])
    containers = new Map([[relative, new Map([[rule.id, ranges]])]])
  }

  await writeFile(path.join(detection.root, relative), example.after)
  const changes = await computeChanges(
    detection.root,
    [relative],
    { snapshots: new Map([[relative, snapshotOf(example.before)]]), fallbackCommit: null },
    (name) => readSourceFile(detection.root, name),
  )
  const output = await detect(input, relative, changes.sets)
  const failure = failureOf(output)
  if (failure !== undefined) return { findings: [], error: failure }
  return {
    findings: output.findings.map(({ match }) => ({
      ...findingOf(input, example.path, match),
      status: classify(match, rule.scope, rule.id, changes, containers),
    })),
  }
}

function findingOf(input: ExamplesInput, file: string, match: Match): ExampleFinding {
  return {
    line: match.line,
    endLine: match.endLine,
    column: match.column,
    text: match.text,
    message: renderTemplate(input.rule.message, {
      ...match.captures,
      file,
      line: String(match.line),
      column: String(match.column),
      text: match.text,
      rule: input.rule.id,
    }),
  }
}
