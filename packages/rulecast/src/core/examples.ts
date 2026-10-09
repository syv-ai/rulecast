import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DetectorRule } from "./compile/rule"
import type { RuleExample } from "./config/schema"
import type { DetectionContext } from "./detection/context"
import { readSourceFile } from "./detection/per-rule"
import { runDetection } from "./detection/run"
import { renderTemplate } from "./template"

export interface ExampleFinding {
  line: number
  column: number
  message: string
}

export interface ExampleOutcome {
  kind: "good" | "bad"
  /** 0-based within its own list, so a failure can be named `good[1]`. */
  index: number
  path: string
  passed: boolean
  /** What the rule found. Empty for a passing `good` case and a failing `bad` one. */
  findings: ExampleFinding[]
  /** The detector failed on this example. A failure, not a silent pass. */
  error?: string
}

export interface ExampleResult {
  rule: string
  outcomes: ExampleOutcome[]
  /** Of the `bad` examples, how many the rule caught. */
  recall: { matched: number; total: number }
  /** Of the examples the rule fired on, how many were `bad` ones. */
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
 * **The scratch directory is inside the project root, not in `os.tmpdir()`**, and detection runs
 * with the project root as its cwd. Everything a rule's tool needs is found relative to one of
 * those two: `linter` and `llm` resolve their binaries from `<cwd>/node_modules/.bin`, `command`
 * resolves `run[0]` the same way, and eslint and ruff find their configuration by walking up from
 * the file they are given. From a directory under `/tmp` an example would be checked by whatever
 * happens to be on PATH, with none of the project's configuration — which is not the rule the
 * author is testing. It is removed in a `finally`.
 *
 * A `bad` example passes when the rule found *at least one* thing, not an exact count: a pattern
 * that matches a violation twice is not a failure, and pinning the count makes every example
 * brittle against a detector change. An author who wants counts uses `--against`.
 */
export async function runExamples(input: ExamplesInput): Promise<ExampleResult> {
  const { rule } = input
  const result = emptyResult(rule.id)
  if (rule.examples === null) return { ...result, missing: true }

  const cases: { kind: "good" | "bad"; index: number; example: RuleExample }[] = [
    ...rule.examples.good.map((example, index) => ({ kind: "good" as const, index, example })),
    ...rule.examples.bad.map((example, index) => ({ kind: "bad" as const, index, example })),
  ]
  if (cases.length === 0) return { ...result, empty: true }

  const scratch = path.basename(await mkdtemp(path.join(input.detection.root, EXAMPLES_DIR)))
  try {
    for (const { kind, index, example } of cases) {
      const outcome = await runOne(input, scratch, example)
      // A `bad` example must produce something and a `good` one must not; a detector error is a
      // failure either way, never a quiet pass.
      const fired = outcome.findings.length > 0
      const passed = outcome.error === undefined && fired === (kind === "bad")
      result.outcomes.push({ kind, index, path: example.path, ...outcome, passed })
    }
  } finally {
    // Also on a detector that threw: a scratch directory per rule, left in the repository on every
    // failing run, is how somebody ends up committing one.
    await rm(path.join(input.detection.root, scratch), { recursive: true, force: true })
  }

  const fired = (outcome: ExampleOutcome) => outcome.findings.length > 0
  const bad = result.outcomes.filter((outcome) => outcome.kind === "bad")
  const goodFired = result.outcomes.filter((outcome) => outcome.kind === "good" && fired(outcome))
  const badFired = bad.filter(fired)
  result.recall = { matched: badFired.length, total: bad.length }
  result.precision = { correct: badFired.length, total: badFired.length + goodFired.length }
  return result
}

async function runOne(
  input: ExamplesInput,
  scratch: string,
  example: RuleExample,
): Promise<{ findings: ExampleFinding[]; error?: string }> {
  // Repo-relative, as every path the core passes a detector is: <scratch>/<the example's own path>.
  // The example keeps its own path under it, because the extension decides the parser and the
  // directory decides what a linter's configuration says about it.
  const relative = path.join(scratch, example.path)
  const file = path.join(input.detection.root, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, example.code)

  const output = await runDetection({
    detection: input.detection,
    event: "verify",
    selections: [{ rule: input.rule, files: [relative] }],
    // No baseline: an example is entirely new, which is what an author is asking about.
    changes: new Map(),
    read: (name) => readSourceFile(input.detection.root, name),
    timeoutMs: input.timeoutMs,
  })

  const failure = output.errors[0]?.message ?? (output.timedOut.length > 0 ? "timed out" : undefined)
  if (failure !== undefined) return { findings: [], error: failure }

  const findings = output.findings.map(({ match }) => ({
    line: match.line,
    column: match.column,
    message: renderTemplate(input.rule.message, {
      ...match.captures,
      file: example.path,
      line: String(match.line),
      column: String(match.column),
      text: match.text,
      rule: input.rule.id,
    }),
  }))
  return { findings }
}
