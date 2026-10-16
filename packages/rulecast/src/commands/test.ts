import path from "node:path"
import { parseArgs } from "node:util"

import { TEST_SCHEMA_VERSION } from "../adapters/cli/contract"
import { compile, diagnosticText } from "../core/compile/project"
import { type DetectorRule, isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import type { RuleScope } from "../core/config/schema"
import { createReferenceResolver } from "../core/delivery/resolve"
import { type DetectionContext, detectionFor } from "../core/detection/context"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { type ExampleOutcome, type ExampleResult, runExamples, skippedResult } from "../core/examples"
import { allFiles } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"
import { UsageError } from "./usage"

interface TestArgs {
  ruleId: string | null
  /** Paths to fire the rule over for real; empty when --against was not given. */
  against: string[]
  /** With --against: the share of matching files a rule may violate in; null when not given. */
  maxRate: number | null
  format: "terminal" | "json"
}

export function parseTestArgs(args: string[]): TestArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      against: { type: "string", multiple: true },
      "max-rate": { type: "string" },
      format: { type: "string", default: "terminal" },
    },
  })
  if (positionals.length > 1) throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  const against = values.against ?? []
  let maxRate: number | null = null
  if (values["max-rate"] !== undefined) {
    if (against.length === 0) throw new UsageError("--max-rate needs --against")
    maxRate = values["max-rate"].trim() === "" ? Number.NaN : Number(values["max-rate"])
    if (!Number.isFinite(maxRate) || maxRate < 0 || maxRate > 1) {
      throw new UsageError("--max-rate takes a share of files between 0 and 1, such as 0.2")
    }
  }
  const ruleId = positionals[0] ?? null
  return { ruleId, against, maxRate, format: values.format }
}

/** Under this many violations a rule is one "nobody breaks" (8 of 15 measured conventions were). */
const FEW_VIOLATIONS = 25

/**
 * Under this many matching files no count means anything: a rule over 8 files is under 25
 * violations however often it is broken, and "few" or "most" would be read as a verdict on the rule
 * rather than on the size of the repository. A drafting agent in a 4-file project said exactly that.
 */
const SMALL_SAMPLE = 25

/**
 * The note for one count: the two ways a rule is not worth shipping, and what a zero does not mean.
 *
 * Everybody breaks it: `react/no-inline-style` produced 131 true-by-definition findings that nobody
 * would have kept — discovered only after adoption, which is the gap this closes. Nobody breaks it:
 * a rule that never fires costs an agent context for nothing. A zero is neither: self-installing
 * rulecast on rulecast produced 0 for all three of its own rules, the expected answer for a
 * repository that already follows them, and it says nothing about whether an agent editing it
 * would. No verdict is printed: there is no threshold that is right for every rule, and 131 is a
 * disaster for one rule and a normal Tuesday for a migration.
 */
function againstNote(violations: number, violatingFiles: number, matchingFiles: number): string[] {
  if (matchingFiles < SMALL_SAMPLE) {
    return [
      `  Only ${matchingFiles} matching ${matchingFiles === 1 ? "file" : "files"}: too few for these numbers to say how often the rule is broken.`,
      "  Judge the rule by the doc it enforces.",
    ]
  }
  if (violations === 0) {
    return [
      "  Nothing to fix today is not the same as nothing to catch: this counts the",
      "  stock, not how often an edit would break the rule.",
    ]
  }
  if (violatingFiles * 2 > matchingFiles) {
    return ["  Most matching files violate it: check it is a convention, not a description of the code."]
  }
  if (violations < FEW_VIOLATIONS) {
    return [
      "  Few violations: a rule nobody breaks costs an agent context and catches little",
      `  (8 of 15 measured conventions were under ${FEW_VIOLATIONS}).`,
    ]
  }
  return []
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const touchRule = (id: string) => `${id} is a touch rule: it delivers context and has nothing to test\n`

const ratio = (part: number, whole: number) => (whole === 0 ? "   — " : (part / whole).toFixed(2))

function summaryLine(rule: DetectorRule, result: ExampleResult): string {
  const id = rule.id.padEnd(36)
  if (result.skipped) return `  ${id}skipped (llm; name the rule to run it)`
  if (result.missing || result.empty) return `  ${id}no examples`
  const passed = result.outcomes.filter((outcome) => outcome.passed).length
  const score = `${passed}/${result.outcomes.length}`.padEnd(7)
  const fixes = result.fixes.total === 0 ? "" : `  fix ${result.fixes.passed}/${result.fixes.total}`
  return `  ${id}${score} P ${ratio(result.precision.correct, result.precision.total)}  R ${ratio(result.recall.matched, result.recall.total)}${fixes}`
}

/** Characters of matched text shown; enough to see where a pattern went wrong. */
const MATCH_PREVIEW = 60

/**
 * What a detector matched, escaped so a line break shows. A regex whose `\s` crosses a blank line
 * reports a finding on the empty line, and "fired at line 2" over a blank source line is a puzzle;
 * the matched text answers it.
 */
function matchedLine(text: string): string {
  const shown = text.length > MATCH_PREVIEW ? `${text.slice(0, MATCH_PREVIEW)}…` : text
  return `matched ${JSON.stringify(shown)}${/\r?\n/.test(text) ? ", across a line break" : ""}`
}

/** The site, and the line it is on — an author needs where it fired, not a diff. */
function failureLines(rule: DetectorRule, result: ExampleResult): string[] {
  const out: string[] = []
  for (const outcome of result.outcomes) {
    if (outcome.passed) continue
    const name = `${outcome.kind}[${outcome.index}] ${outcome.path}`
    if (outcome.error !== undefined) {
      out.push(`      ${name} — ${rule.detector.kind} failed: ${outcome.error}`)
      continue
    }
    // A fix is only checked on a bad example that passed otherwise, so its sentence is the failure;
    // the findings it was given are the expected ones and say nothing.
    if (outcome.kind === "bad" && outcome.fix !== undefined) {
      out.push(...outcome.failures.map((failure) => `      ${name} — ${failure}`))
      if (outcome.fix.diff !== undefined) {
        out.push(
          ...outcome.fix.diff
            .trimEnd()
            .split("\n")
            .map((line) => `        ${line}`),
        )
      }
      continue
    }
    if (outcome.kind === "bad" && outcome.findings.length === 0) {
      out.push(`      ${name} — no finding`)
      continue
    }
    // A good example that fired is explained by where it fired. A pinned bad example and a baseline
    // one are explained by what they expected, and then where it fired.
    if (outcome.kind !== "good") out.push(...outcome.failures.map((failure) => `      ${name} — ${failure}`))
    const source = sourceOf(rule, outcome).split(/\r?\n/)
    for (const finding of outcome.findings) {
      const status = finding.status === undefined ? "" : ` (${finding.status === "new" ? "new" : "pre-existing"})`
      out.push(
        `      ${name} — fired at line ${finding.line}${status}`,
        `        ${source[finding.line - 1]?.trim() ?? ""}`,
      )
      out.push(`        ${matchedLine(finding.text)}`)
    }
  }
  return out
}

/** The code an outcome's findings are in: a baseline example's is its `after`. */
function sourceOf(rule: DetectorRule, outcome: ExampleOutcome): string {
  const examples = rule.examples
  if (outcome.kind === "baseline") return examples?.baseline[outcome.index]?.after ?? ""
  return examples?.[outcome.kind][outcome.index]?.code ?? ""
}

/** The worst files named, then the rest counted: enough to pick one to look at. */
const AGAINST_TOP_FILES = 10

/**
 * `--against`: fire the rule over real files and say how much it would produce.
 *
 * It reports, and fails only past a `--max-rate` the caller chose (see `againstNote` for why no
 * threshold is built in). The denominator is the files the rule *matches* under the given paths,
 * not every file walked: a rule scoped to `routes/` must not be diluted by the rest of the
 * repository.
 */
function againstPrefixes(root: string, paths: string[], io: CliIo): (file: string) => boolean {
  const prefixes = paths.map((given) => {
    // The root is a directory to search, not a file in it, which toProjectPath rejects. "." from
    // the root is what DRAFT-RULES tells an agent to pass, and it was refused as outside.
    if (path.resolve(io.cwd, given) === path.resolve(root)) return ""
    const resolved = toProjectPath(root, io.cwd, given)
    if (resolved === null) throw new UsageError(`${given} is outside the project`)
    return resolved
  })
  return (file) => prefixes.some((prefix) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`))
}

/** What `--against` measured for one rule: the `against` object of `test --format json`. */
interface AgainstReport {
  paths: string[]
  /** Files under the paths that the rule matches: the denominator. */
  matchingFiles: number
  violatingFiles: number
  violations: number
  /** `violatingFiles / matchingFiles`; null when no file matches. */
  rate: number | null
  maxRate: number | null
  /** Over `--max-rate`. Never on a small sample, where the rate is not applied. */
  exceeded: boolean
  /** Under `SMALL_SAMPLE` matching files: too few for a rate to mean anything. */
  smallSample: boolean
  /** Every violating file, worst first. */
  files: { file: string; count: number }[]
}

async function measureAgainst(
  root: string,
  rule: DetectorRule,
  candidates: readonly string[],
  paths: string[],
  maxRate: number | null,
  detection: DetectionContext,
  timeoutMs: number,
): Promise<AgainstReport> {
  const files = candidates.filter((file) => rule.matches(file))
  const byFile = new Map<string, number>()
  let violations = 0
  if (files.length > 0) {
    const output = await runDetection({
      detection,
      event: "verify",
      selections: [{ rule, files }],
      changes: new Map(),
      read: (file) => readSourceFile(root, file),
      timeoutMs,
    })
    const failure = output.errors[0]
    if (failure !== undefined) throw new Error(`${rule.detector.kind} detector failed: ${failure.message}`)
    for (const { match } of output.findings) byFile.set(match.file, (byFile.get(match.file) ?? 0) + 1)
    violations = output.findings.length
  }
  const rate = files.length === 0 ? null : byFile.size / files.length
  // A rate over a handful of files is noise, and failing a rule on it would fail rules at random
  // in a small repository; the terminal note already refuses to read anything into it.
  const smallSample = files.length < SMALL_SAMPLE
  return {
    paths,
    matchingFiles: files.length,
    violatingFiles: byFile.size,
    violations,
    rate,
    maxRate,
    exceeded: maxRate !== null && !smallSample && rate !== null && rate > maxRate,
    smallSample,
    files: [...byFile].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([file, count]) => ({ file, count })),
  }
}

/**
 * A rate to two decimals, or as many more as it takes to show which side of `--max-rate` it is on:
 * 126 of 250 is 0.504, over 0.5, and printed as "0.50" it read as equal to the limit it broke.
 */
function rateText(rate: number, maxRate: number): string {
  for (let digits = 2; digits <= 6; digits++) {
    const shown = rate.toFixed(digits)
    if (Math.sign(Number(shown) - maxRate) === Math.sign(rate - maxRate)) return shown
  }
  return String(rate)
}

/** The `--max-rate` verdict, for the terminal. */
function rateLine(against: AgainstReport): string {
  if (against.smallSample) {
    return `  --max-rate not applied: only ${plural(against.matchingFiles, "matching file")}`
  }
  const rate = rateText(against.rate ?? 0, against.maxRate ?? 0)
  return `  rate ${rate}: ${against.exceeded ? "over" : "within"} --max-rate ${against.maxRate}`
}

function againstText(rule: DetectorRule, against: AgainstReport): string {
  if (against.matchingFiles === 0) return `\n  no files under ${against.paths.join(", ")} match ${rule.id}\n\n`
  const worst = against.files.slice(0, AGAINST_TOP_FILES)
  const width = Math.max(...worst.map(({ file }) => file.length), 0)

  const out = [
    "",
    `  ${plural(against.violations, "violation")} in ${against.violatingFiles} of ${against.matchingFiles} matching files`,
  ]
  if (against.maxRate !== null) out.push(rateLine(against))
  if (worst.length > 0) {
    out.push("", ...worst.map(({ file, count }) => `  ${file.padEnd(width + 2)}${count}`))
    if (against.files.length > worst.length) out.push(`  …and ${against.files.length - worst.length} more files`)
  }
  const note = againstNote(against.violations, against.violatingFiles, against.matchingFiles)
  if (note.length > 0) out.push("", ...note)
  out.push("")
  return out.join("\n")
}

/**
 * `--against` with no rule: one line per rule, so drafting a whole config is one command rather than
 * a shell loop over ids. Metered rules are named and not run, as in bare `rulecast test`.
 */
function againstAllText(reports: readonly RuleReport[], maxRate: number | null): string {
  const header = maxRate === null ? ["rule", "violations", "files"] : ["rule", "violations", "files", "rate"]
  const rows: string[][] = [header]
  const notRun: string[] = []
  for (const report of reports) {
    const against = report.against
    if (against === null) {
      notRun.push(report.rule)
      continue
    }
    const files =
      against.matchingFiles === 0 ? "no files match" : `${against.violatingFiles} of ${against.matchingFiles}`
    const row = [report.rule, String(against.violations), files]
    if (maxRate !== null) {
      row.push(
        against.matchingFiles === 0
          ? ""
          : against.smallSample
            ? "not applied (too few files)"
            : `${rateText(against.rate ?? 0, maxRate)}${against.exceeded ? " over" : ""}`,
      )
    }
    rows.push(row)
  }
  const idWidth = Math.max(...rows.map(([id]) => id!.length))
  const countWidth = Math.max(...rows.map(([, n]) => n!.length))
  const filesWidth = Math.max(...rows.map(([, , files]) => files!.length))
  const line = ([id, n, files, rate]: string[]) =>
    `  ${id!.padEnd(idWidth + 2)}${n!.padStart(countWidth)}  ${rate === undefined ? files : `${files!.padEnd(filesWidth)}  ${rate}`.trimEnd()}`
  const out = ["", ...rows.map(line)]
  if (notRun.length > 0)
    out.push("", `  not run: ${notRun.join(", ")} (rulecast test <id> --against runs one; it costs money)`)
  out.push(
    "",
    "  The counts are the stock, not how often an edit breaks a rule. rulecast test <id> --against",
    "  shows one rule's worst files and what its count does and does not mean.",
    "",
  )
  return out.join("\n")
}

/** One rule's result: an entry of `rules` in `test --format json` (agents/reference/output.md). */
interface RuleReport {
  rule: string
  /** The detector kind; null for a touch rule. */
  detector: string | null
  scope: RuleScope
  /** `not-run`: a metered rule nobody named. `touch`: a rule with no detector, named. */
  status: "passed" | "failed" | "no-examples" | "not-run" | "touch"
  /** Null under `--against`, and when there was nothing run. */
  examples: Pick<ExampleResult, "outcomes" | "precision" | "recall"> | null
  /** Null unless `--against` was given and the rule ran. */
  against: AgainstReport | null
}

interface TestReport {
  schemaVersion: number
  /**
   * Exit 0 exactly when true: every rule compiled, no example failed, and no rule is over
   * `--max-rate`.
   */
  passed: boolean
  rules: RuleReport[]
}

/**
 * `uncompiled`: the rules (or rule repos) that failed to compile, which are in no report's `rules`.
 * A rule that does not compile was tested by nothing, so the run does not pass.
 */
const report = (rules: RuleReport[], uncompiled: readonly string[] = []): TestReport => ({
  schemaVersion: TEST_SCHEMA_VERSION,
  passed: uncompiled.length === 0 && rules.every((rule) => rule.status !== "failed"),
  rules,
})

/** The terminal's line for the rules that failed to compile; their diagnostics are on stderr. */
function uncompiledText(uncompiled: readonly string[]): string {
  if (uncompiled.length === 0) return ""
  const what = uncompiled.length === 1 ? "rule did" : "rules did"
  return `  ${uncompiled.length} ${what} not compile: ${uncompiled.join(", ")} (rulecast validate shows why)\n\n`
}

function againstReport(rule: DetectorRule, against: AgainstReport | null): RuleReport {
  const status = against === null ? "not-run" : against.exceeded ? "failed" : "passed"
  return { rule: rule.id, detector: rule.detector.kind, scope: rule.scope, status, examples: null, against }
}

function examplesReport(rule: DetectorRule, result: ExampleResult): RuleReport {
  const report = (status: RuleReport["status"], examples: RuleReport["examples"]): RuleReport => ({
    rule: rule.id,
    detector: rule.detector.kind,
    scope: rule.scope,
    status,
    examples,
    against: null,
  })
  if (result.skipped) return report("not-run", null)
  if (result.missing || result.empty) return report("no-examples", null)
  const { outcomes, precision, recall } = result
  return report(outcomes.every((outcome) => outcome.passed) ? "passed" : "failed", { outcomes, precision, recall })
}

function examplesText(results: readonly { rule: DetectorRule; result: ExampleResult }[]): string {
  if (results.length === 0) return "no rules with a detector\n"
  const lines: string[] = [""]
  const noExamples: string[] = []
  const notRun: string[] = []
  let failedRules = 0
  let ranRules = 0
  for (const { rule, result } of results) {
    lines.push(summaryLine(rule, result))
    if (result.missing || result.empty) {
      noExamples.push(rule.id)
      continue
    }
    if (result.skipped) {
      notRun.push(rule.id)
      continue
    }
    ranRules++
    if (result.outcomes.some((outcome) => !outcome.passed)) {
      failedRules++
      lines.push(...failureLines(rule, result))
    }
  }

  if (noExamples.length > 0) lines.push("", `  no examples: ${noExamples.join(", ")}`)
  // A drafting agent took "1 rule passed" as the final check clean while its llm rule never ran.
  if (notRun.length > 0) {
    lines.push("", `  not run: ${notRun.join(", ")} (rulecast test <id> runs one; it costs money per example)`)
  }
  lines.push(
    "",
    failedRules === 0
      ? ranRules === 0
        ? "  nothing to run"
        : `  ${ranRules} ${ranRules === 1 ? "rule" : "rules"} passed`
      : `  ${failedRules} of ${ranRules} rules failed`,
    "",
  )
  return lines.join("\n")
}

/**
 * `rulecast test [RULE_ID]` — run every rule's inline examples, or one rule's.
 *
 * Bare, it skips `llm` rules: running a rule's examples is the author asking for exactly that, so
 * there is no consent problem in `rulecast test <llm-rule>`, but `rulecast test` over a project
 * with several of them would be a surprise bill. Naming the rule runs it (§6, Consent).
 *
 * Everything is measured into one `TestReport` first and printed once, as JSON or as text, so a
 * failure part-way (exit 2) leaves stdout empty in either format.
 */
export async function testCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { ruleId, against, maxRate, format } = parseTestArgs(args)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  // A config that does not load compiled no rule at all: "passed" over nothing would be a lie.
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  const named = ruleId === null ? undefined : project.rules.find((rule) => rule.id === ruleId)
  if (ruleId !== null && named === undefined) throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)

  // Testing every rule includes the ones that did not compile: they are left out of the rules, so
  // without this a broken rule read as "passed". A named rule is tested alone.
  const errors = ruleId === null ? project.diagnostics.filter((diagnostic) => diagnostic.level === "error") : []
  const uncompiled = [...new Set(errors.map((diagnostic) => diagnostic.rule ?? diagnostic.source))]
  const print = (rules: RuleReport[], text: () => string): number => {
    const result = report(rules, uncompiled)
    for (const diagnostic of errors) io.stderr(`rulecast: ${diagnosticText(diagnostic)}\n`)
    io.stdout(format === "json" ? `${JSON.stringify(result, null, 2)}\n` : `${text()}${uncompiledText(uncompiled)}`)
    return result.passed ? 0 : 1
  }

  const rules = project.rules.filter(isDetectorRule).filter((rule) => ruleId === null || rule.id === ruleId)
  if (named !== undefined && rules.length === 0) {
    const touch: RuleReport = {
      rule: named.id,
      detector: null,
      scope: named.scope,
      status: "touch",
      examples: null,
      against: null,
    }
    return print([touch], () => touchRule(named.id))
  }
  const stateDir = ensureProjectState(cacheHome(io.env), root)
  const resolver = createReferenceResolver(root)
  const detection = detectionFor(project, registry, stateDir, resolver)
  const timeoutMs = project.config.timeouts.verifyMs
  // Spec §6: a metered rule runs only when asked for by id — never as part of "test them all".
  const notAsked = (rule: DetectorRule) => ruleId === null && registry.get(rule.detector.kind)?.metered === true

  if (against.length > 0) {
    const under = againstPrefixes(root, against, io)
    const candidates = (await allFiles(root)).filter(under)
    const reports: RuleReport[] = []
    for (const rule of rules) {
      const measured = notAsked(rule)
        ? null
        : await measureAgainst(root, rule, candidates, against, maxRate, detection, timeoutMs)
      reports.push(againstReport(rule, measured))
    }
    if (ruleId !== null) return print(reports, () => againstText(rules[0]!, reports[0]!.against!))
    return print(reports, () => againstAllText(reports, maxRate))
  }

  const results: { rule: DetectorRule; result: ExampleResult }[] = []
  for (const rule of rules) {
    const result = notAsked(rule) ? skippedResult(rule.id) : await runExamples({ detection, rule, timeoutMs })
    results.push({ rule, result })
  }
  return print(
    results.map(({ rule, result }) => examplesReport(rule, result)),
    () => examplesText(results),
  )
}
