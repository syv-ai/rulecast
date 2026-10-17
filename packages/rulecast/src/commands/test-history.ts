import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import type { CompiledProject } from "../core/compile/project"
import type { DetectorRule } from "../core/compile/rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { isNotFound } from "../core/errors"
import { type HistoryCommit, recentCommits } from "../core/history"
import { runPipeline } from "../core/pipeline"

/** Under this many commits a rate says nothing about how often the rule is broken. */
const SMALL_HISTORY = 10

/** Commits judged when `--history` is given without a number, and for a rule that costs money per file. */
export const DEFAULT_HISTORY = 20
export const DEFAULT_METERED_HISTORY = 10

export type Label = "real" | "false"

export interface HistoryFinding {
  commit: string
  subject: string
  file: string
  line: number
  message: string
  /** From the label file, when the developer marked it. */
  label?: Label
}

/** What `--history` measured for one rule: the `history` object of `test --format json`. */
export interface HistoryReport {
  /** Commits judged: the newest non-merge commits that change a file the rule matches. */
  commits: number
  /** Of those, the commits the rule found something new in. */
  commitsFired: number
  /** `commitsFired / commits`; null when there was no commit to judge. */
  rate: number | null
  maxRate: number | null
  /** Over `--max-rate`. Never on a small sample, where the rate is not applied. */
  exceeded: boolean
  /** Under ten commits: too few for a rate to mean anything. */
  smallSample: boolean
  /** Every new finding, newest commit first. */
  findings: HistoryFinding[]
  /**
   * The developer's marks, over the findings above that have one, from `.rulecast/history/<rule>.json`.
   * Null when there is no label file.
   */
  labels: { real: number; false: number; unlabelled: number; precision: number | null; file: string } | null
}

/** A metered rule's history is a bill: this is what it would cost, asked for before it is run. */
export interface HistoryEstimate {
  commits: number
  /** One model call per file per commit (llm groups every rule asking about a file into one call). */
  calls: number
}

/** The commits `--history` would judge, and the files in them the rule would be run on. */
export async function historyCommits(root: string, rule: DetectorRule, limit: number): Promise<HistoryCommit[]> {
  return recentCommits(root, (file) => rule.matches(file), limit)
}

export function estimate(commits: readonly HistoryCommit[]): HistoryEstimate {
  return { commits: commits.length, calls: commits.reduce((sum, commit) => sum + commit.files.length, 0) }
}

/**
 * Judge the rule on each commit the way a session judges an edit: against what the commit changed,
 * at the commit's content, and only what it added counts. The same path as `run --from-ref C^ --to-ref C`.
 */
export async function measureHistory(input: {
  root: string
  project: CompiledProject
  registry: DetectorRegistry
  stateDir: string
  rule: DetectorRule
  commits: readonly HistoryCommit[]
  maxRate: number | null
}): Promise<Omit<HistoryReport, "labels">> {
  const { root, rule, commits, maxRate } = input
  const findings: HistoryFinding[] = []
  let commitsFired = 0
  for (const commit of commits) {
    const result = await runPipeline({
      project: input.project,
      stateDir: input.stateDir,
      event: {
        kind: "verify",
        files: commit.files,
        baseCommit: commit.parent,
        content: { kind: "commit", ref: commit.commit },
        cwd: root,
      },
      registry: input.registry,
      maxContextChars: null,
      onlyRules: new Set([rule.id]),
      ignoreFileBudgets: true,
    })
    const failure = result.delivery.warnings.find((warning) => warning.includes(rule.id))
    if (result.failed && failure !== undefined) throw new Error(failure)
    const found = result.delivery.findings.filter((finding) => finding.rule === rule.id)
    if (found.length > 0) commitsFired++
    for (const finding of found) {
      findings.push({
        commit: commit.commit,
        subject: commit.subject,
        file: finding.file,
        line: finding.line,
        message: finding.message,
      })
    }
  }
  const rate = commits.length === 0 ? null : commitsFired / commits.length
  const smallSample = commits.length < SMALL_HISTORY
  return {
    commits: commits.length,
    commitsFired,
    rate,
    maxRate,
    exceeded: maxRate !== null && !smallSample && rate !== null && rate > maxRate,
    smallSample,
    findings,
  }
}

/** `.rulecast/history/<rule>.json`: a rule id's `/` would be a directory. */
export function labelFile(root: string, ruleId: string): string {
  return path.join(root, ".rulecast", "history", `${ruleId.replaceAll("/", "__")}.json`)
}

interface LabelDocument {
  rule: string
  findings: (Omit<HistoryFinding, "label"> & { label: Label | null })[]
}

const keyOf = (finding: Pick<HistoryFinding, "commit" | "file" | "line">) =>
  `${finding.commit} ${finding.file}:${finding.line}`

async function readLabels(file: string): Promise<LabelDocument | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LabelDocument
  } catch (error) {
    if (isNotFound(error)) return null
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Attach the developer's marks to the findings, and with `write` add the findings that have none
 * yet to the label file, keeping every mark already in it. Precision is over the findings judged
 * this time that carry a mark.
 */
export async function applyLabels(
  root: string,
  ruleId: string,
  report: Omit<HistoryReport, "labels">,
  write: boolean,
): Promise<HistoryReport> {
  const file = labelFile(root, ruleId)
  const existing = await readLabels(file)
  const marks = new Map((existing?.findings ?? []).map((finding) => [keyOf(finding), finding.label]))
  const findings = report.findings.map((finding) => {
    const label = marks.get(keyOf(finding))
    return label === null || label === undefined ? finding : { ...finding, label }
  })
  if (write) {
    const kept = existing?.findings ?? []
    const known = new Set(kept.map(keyOf))
    const added = report.findings.filter((finding) => !known.has(keyOf(finding))).map((f) => ({ ...f, label: null }))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify({ rule: ruleId, findings: [...kept, ...added] }, null, 2)}\n`)
  }
  if (existing === null && !write) return { ...report, labels: null }
  const real = findings.filter((finding) => finding.label === "real").length
  const wrong = findings.filter((finding) => finding.label === "false").length
  return {
    ...report,
    findings,
    labels: {
      real,
      false: wrong,
      unlabelled: findings.length - real - wrong,
      precision: real + wrong === 0 ? null : real / (real + wrong),
      file: path.relative(root, file),
    },
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Characters of a finding's message shown per line; the label file has it whole. */
const MESSAGE_PREVIEW = 100

export function historyText(rule: DetectorRule, history: HistoryReport): string {
  if (history.commits === 0) return `\n  no commit on this branch changes a file ${rule.id} matches\n\n`
  const out = [
    "",
    `  ${rule.id}: new findings in ${history.commitsFired} of ${plural(history.commits, "commit")} that change its files`,
  ]
  for (const finding of history.findings) {
    const message = finding.message.replace(/\s+/g, " ").trim()
    const shown = message.length > MESSAGE_PREVIEW ? `${message.slice(0, MESSAGE_PREVIEW)}…` : message
    const mark = finding.label === undefined ? "" : ` [${finding.label}]`
    out.push(`    ${finding.commit.slice(0, 10)} ${finding.file}:${finding.line}${mark}  ${shown}`)
  }
  out.push("")
  if (history.smallSample) {
    out.push(`  Only ${plural(history.commits, "commit")}: too few for the rate to say how often the rule is broken.`)
  } else if (history.maxRate !== null) {
    const rate = (history.rate ?? 0).toFixed(2)
    out.push(`  rate ${rate}: ${history.exceeded ? "over" : "within"} --max-rate ${history.maxRate}`)
  }
  if (history.commitsFired * 2 > history.commits && !history.smallSample) {
    out.push("  Most of these commits break it: check it is a convention, not a description of the code.")
  }
  if (history.labels !== null) {
    const { real, false: wrong, unlabelled, precision, file } = history.labels
    out.push(
      `  marked in ${file}: ${real} real, ${wrong} false, ${unlabelled} not marked` +
        (precision === null ? "" : `: precision ${precision.toFixed(2)}`),
    )
    if (real > 0)
      out.push("  A finding marked real is a candidate for the rule's examples.bad: offer it to the developer.")
  }
  out.push("")
  return out.join("\n")
}

export function estimateText(rule: DetectorRule, cost: HistoryEstimate): string {
  return (
    `\n  ${rule.id} is a ${rule.detector.kind} rule: judging ${plural(cost.commits, "commit")} takes ` +
    `${plural(cost.calls, "billed model call")}, one per file per commit.\n` +
    "  Run it again with --yes to go ahead.\n\n"
  )
}
