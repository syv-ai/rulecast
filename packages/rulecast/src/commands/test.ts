import { parseArgs } from "node:util"

import { compile } from "../core/compile/project"
import { type CompiledRule, type DetectorRule, isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver, resolveRuleContext } from "../core/delivery/resolve"
import { detectorCacheDir, diskCache } from "../core/detection/cache"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { type ExampleResult, runExamples, skippedResult } from "../core/examples"
import { allFiles } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { Cache, DetectorSettings, ResolvedReference } from "../core/types"
import type { CliIo } from "./main"
import { hasProject, toProjectPath } from "./project"
import { UsageError } from "./usage"

interface TestArgs {
  ruleId: string | null
  /** Paths to fire the rule over for real; empty when --against was not given. */
  against: string[]
}

export function parseTestArgs(args: string[]): TestArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { against: { type: "string", multiple: true } },
  })
  if (positionals.length > 1) throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(" ")}`)
  const against = values.against ?? []
  const ruleId = positionals[0] ?? null
  if (against.length > 0 && ruleId === null) throw new UsageError("--against needs a RULE_ID")
  return { ruleId, against }
}

/**
 * The two ways a rule is not worth shipping, both visible in one number.
 *
 * Nobody breaks it: 8 of 15 conventions measured under 25 violations in ~1,300 sites, and a rule
 * that never fires costs an agent context for nothing. Or everybody breaks it: `react/no-inline-style`
 * produced 131 true-by-definition findings that nobody would have kept — discovered only after
 * adoption, which is the gap this closes. No verdict is printed: there is no threshold that is
 * right for every rule, and 131 is a disaster for one rule and a normal Tuesday for a migration.
 */
const AGAINST_NOTES = [
  "  A rule this common is usually true by definition rather than a convention.",
  "  A rule with almost no violations is usually not worth an agent's context.",
]

const ratio = (part: number, whole: number) => (whole === 0 ? "   — " : (part / whole).toFixed(2))

function summaryLine(rule: DetectorRule, result: ExampleResult): string {
  const id = rule.id.padEnd(36)
  if (result.skipped) return `  ${id}skipped (llm; name the rule to run it)`
  if (result.missing || result.empty) return `  ${id}no examples`
  const passed = result.outcomes.filter((outcome) => outcome.passed).length
  const score = `${passed}/${result.outcomes.length}`.padEnd(7)
  return `  ${id}${score} P ${ratio(result.precision.correct, result.precision.total)}  R ${ratio(result.recall.matched, result.recall.total)}`
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
    if (outcome.kind === "bad") {
      out.push(`      ${name} — no finding`)
      continue
    }
    const source = (rule.examples?.good[outcome.index]?.code ?? "").split(/\r?\n/)
    for (const finding of outcome.findings) {
      out.push(`      ${name} — fired at line ${finding.line}`, `        ${source[finding.line - 1]?.trim() ?? ""}`)
    }
  }
  return out
}

interface Detection {
  registry: DetectorRegistry
  settings: DetectorSettings
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
  cacheFor(kind: string): Cache
  timeoutMs: number
}

/** The worst files named, then the rest counted: enough to pick one to look at. */
const AGAINST_TOP_FILES = 10

/**
 * `--against`: fire the rule over real files and say how much it would produce.
 *
 * It reports and never fails, whatever it finds (see `AGAINST_NOTES`). The denominator is the files
 * the rule *matches* under the given paths, not every file walked: a rule scoped to `routes/` must
 * not be diluted by the rest of the repository.
 */
async function reportAgainst(
  root: string,
  rule: DetectorRule,
  paths: string[],
  detection: Detection,
  io: CliIo,
): Promise<number> {
  const prefixes = paths.map((given) => {
    const resolved = toProjectPath(root, io.cwd, given)
    if (resolved === null) throw new UsageError(`${given} is outside the project`)
    return resolved === "." ? "" : resolved
  })
  const under = (file: string) =>
    prefixes.some((prefix) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`))
  const files = (await allFiles(root)).filter((file) => under(file) && rule.matches(file))

  if (files.length === 0) {
    io.stdout(`\n  no files under ${paths.join(", ")} match ${rule.id}\n\n`)
    return 0
  }

  const output = await runDetection({
    ...detection,
    root,
    event: "verify",
    selections: [{ rule, files }],
    changes: new Map(),
    read: (file) => readSourceFile(root, file),
  })
  const failure = output.errors[0]
  if (failure !== undefined) throw new Error(`${rule.detector.kind} detector failed: ${failure.message}`)

  const byFile = new Map<string, number>()
  for (const { match } of output.findings) byFile.set(match.file, (byFile.get(match.file) ?? 0) + 1)
  const worst = [...byFile].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, AGAINST_TOP_FILES)
  const width = Math.max(...worst.map(([file]) => file.length), 0)

  const out = [
    "",
    `  ${output.findings.length} violations in ${byFile.size} of ${files.length} matching files`,
    "",
    ...worst.map(([file, count]) => `  ${file.padEnd(width + 2)}${count}`),
  ]
  if (byFile.size > worst.length) out.push(`  …and ${byFile.size - worst.length} more files`)
  out.push("", ...AGAINST_NOTES, "")
  io.stdout(out.join("\n"))
  return 0
}

/**
 * `rulecast test [RULE_ID]` — run every rule's inline examples, or one rule's.
 *
 * Bare, it skips `llm` rules: running a rule's examples is the author asking for exactly that, so
 * there is no consent problem in `rulecast test <llm-rule>`, but `rulecast test` over a project
 * with several of them would be a surprise bill. Naming the rule runs it (§6, Consent).
 */
export async function testCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { ruleId, against } = parseTestArgs(args)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  if (ruleId !== null && !project.rules.some((rule) => rule.id === ruleId)) {
    throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
  }

  const rules = project.rules.filter(isDetectorRule).filter((rule) => ruleId === null || rule.id === ruleId)
  const stateDir = ensureProjectState(cacheHome(io.env), root)
  const resolver = createReferenceResolver(root)
  const detection = {
    registry,
    settings: { llm: project.config.llm },
    contextFor: (one: CompiledRule) => resolveRuleContext(resolver, one.context),
    cacheFor: (kind: string) => diskCache(detectorCacheDir(stateDir, kind)),
    timeoutMs: project.config.timeouts.verifyMs,
  }

  if (against.length > 0) return await reportAgainst(root, rules[0]!, against, detection, io)

  const lines: string[] = [""]
  const noExamples: string[] = []
  let failedRules = 0
  let ranRules = 0

  for (const rule of rules) {
    const result =
      ruleId === null && rule.detector.kind === "llm"
        ? skippedResult(rule.id)
        : await runExamples({ ...detection, root, rule })
    lines.push(summaryLine(rule, result))
    if (result.missing || result.empty) {
      noExamples.push(rule.id)
      continue
    }
    if (result.skipped) continue
    ranRules++
    if (result.outcomes.some((outcome) => !outcome.passed)) {
      failedRules++
      lines.push(...failureLines(rule, result))
    }
  }

  if (rules.length === 0) {
    io.stdout("no rules with a detector\n")
    return 0
  }
  if (noExamples.length > 0) lines.push("", `  no examples: ${noExamples.join(", ")}`)
  lines.push(
    "",
    failedRules === 0
      ? ranRules === 0
        ? "  nothing to run"
        : `  ${ranRules} ${ranRules === 1 ? "rule" : "rules"} passed`
      : `  ${failedRules} of ${ranRules} rules failed`,
    "",
  )
  io.stdout(lines.join("\n"))
  return failedRules === 0 ? 0 : 1
}
