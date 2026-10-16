import { existsSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"

import { EXIT } from "../adapters/cli/contract"
import {
  BASELINE_FILE,
  baselineHas,
  baselineSize,
  buildBaseline,
  type CommittedBaseline,
  entryVerdict,
  fileExists,
  pruneBaseline,
  readCommittedBaseline,
  writeCommittedBaseline,
} from "../core/baseline/committed"
import { type CompiledProject, compile, diagnosticText } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import { agentDir } from "../core/delivery/persist"
import type { DetectorRegistry } from "../core/detection/registry"
import { FINDING_ID_VERSION } from "../core/finding-id"
import { allFiles, git } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { type PipelineResult, runPipeline } from "../core/pipeline"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const sizeText = (baseline: CommittedBaseline) => {
  const size = baselineSize(baseline)
  return `${plural(size.entries, "finding")}, ${plural(size.rules, "rule")}, ${plural(size.files, "file")}`
}

/**
 * `rulecast baseline`: write `.rulecast/baseline.json` from a run over every file, so later
 * `run --all-files` and `--files` runs fail only on what is new (core/baseline/committed.ts).
 *
 * - No flag: create it. An existing file is refused — rewriting it forgives everything found since,
 *   which should be a deliberate `--force`, not a habit.
 * - `--prune`: drop the entries this run shows are gone. Never adds one.
 *
 * Nothing is written from a run where a rule failed: a baseline missing a broken rule's findings
 * would make every one of them new once the rule works again.
 */
export async function baselineCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      prune: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "no-llm": { type: "boolean", default: false },
    },
  })
  if (positionals.length > 0) throw new UsageError(`unexpected arguments: ${positionals.join(" ")}`)
  if (values.prune && values.force) throw new UsageError("--prune and --force cannot be combined")
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)

  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)

  let existing: CommittedBaseline | null = null
  if (values.prune) {
    existing = await readCommittedBaseline(root)
    if (existing === null) {
      io.stderr(`rulecast: no ${BASELINE_FILE} to prune (rulecast baseline writes one)\n`)
      return EXIT.failed
    }
    if (existing.findingIdVersion !== FINDING_ID_VERSION) {
      io.stderr(
        `rulecast: ${BASELINE_FILE} holds ids of scheme v${existing.findingIdVersion} and this rulecast computes v${FINDING_ID_VERSION}; rulecast baseline --force rewrites it\n`,
      )
      return EXIT.failed
    }
  } else if (!values.force && existsSync(path.join(root, BASELINE_FILE))) {
    io.stderr(
      `rulecast: ${BASELINE_FILE} exists: rulecast baseline --prune shrinks it; --force rewrites it (every current finding becomes pre-existing)\n`,
    )
    return EXIT.failed
  }

  const result = await everything(project, registry, io, values["no-llm"])
  for (const warning of result.delivery.warnings) io.stdout(`rulecast problem: ${warning}\n`)
  const complete = !result.failed

  if (existing !== null) return prune(project, existing, result, io, complete)

  if (!complete) {
    io.stdout(
      `not written: some rules did not run, and a baseline without their findings would make every one of them new later\n`,
    )
    return EXIT.incomplete
  }
  const baseline = buildBaseline(
    (result.findings ?? []).map(({ id, rule, match }) => ({ id, rule: rule.id, file: match.file })),
  )
  await writeCommittedBaseline(root, baseline)
  agentDir(root)
  io.stdout(`wrote ${BASELINE_FILE}: ${sizeText(baseline)}. Commit it; prefer --from-ref wherever a ref exists.\n`)
  await warnIfIgnored(root, io)
  return EXIT.clean
}

/** One verify over every file, with no baseline at all: every finding comes back new. */
async function everything(
  project: CompiledProject,
  registry: DetectorRegistry,
  io: CliIo,
  noLlm: boolean,
): Promise<PipelineResult> {
  const metered = new Set(registry.kinds().filter((kind) => registry.get(kind)?.metered === true))
  return runPipeline({
    project,
    stateDir: ensureProjectState(cacheHome(io.env), project.root),
    event: { kind: "verify", files: await allFiles(project.root), cwd: project.root },
    registry,
    maxContextChars: null,
    ...(noLlm ? { skipDetectorKinds: metered } : {}),
  })
}

async function prune(
  project: CompiledProject,
  existing: CommittedBaseline,
  result: PipelineResult,
  io: CliIo,
  complete: boolean,
): Promise<number> {
  const findings = result.findings ?? []
  const found = new Set([...findings, ...(result.ignored ?? [])].flatMap(({ id }) => (id === undefined ? [] : [id])))
  const verdict = entryVerdict({
    rules: project.rules,
    compiledCleanly: !project.diagnostics.some((diagnostic) => diagnostic.level === "error"),
    ran: result.ran ?? new Map(),
    exists: fileExists(project.root),
  })
  const { next, removed } = pruneBaseline(existing, found, verdict)
  // Only when something went: an unchanged baseline is not rewritten, so a prune that found
  // nothing leaves no diff even if the file was formatted by hand.
  if (removed.length > 0) await writeCommittedBaseline(project.root, next)

  if (removed.length === 0) io.stdout("nothing to prune\n")
  else {
    io.stdout(`pruned ${removed.length === 1 ? "1 entry" : `${removed.length} entries`}:\n`)
    const counts = new Map<string, number>()
    for (const { rule, file } of removed) counts.set(`${rule}  ${file}`, (counts.get(`${rule}  ${file}`) ?? 0) + 1)
    for (const [where, count] of counts) io.stdout(`  ${where}  −${count}\n`)
  }
  const added = findings.filter(({ id, rule, match }) => !baselineHas(existing, rule.id, match.file, id)).length
  if (added > 0) {
    io.stdout(
      `${added === 1 ? "1 new finding is" : `${added} new findings are`} not added; fix ${added === 1 ? "it" : "them"}, or rulecast baseline --force to rewrite the file\n`,
    )
  }
  if (!complete) io.stdout("some rules did not run; their entries were kept\n")
  io.stdout(`${BASELINE_FILE}: ${sizeText(next)}\n`)
  if (removed.length > 0) await warnIfIgnored(project.root, io)
  return complete ? EXIT.clean : EXIT.incomplete
}

/**
 * A file git ignores cannot be committed without `-f`. rulecast's own `.rulecast/.gitignore` lets
 * the baseline through, but one the project edited, or a rule in its own ignore files, may not.
 */
async function warnIfIgnored(root: string, io: CliIo): Promise<void> {
  // -v alone is no answer: it also prints, and exits 0 for, the `!baseline.json` that un-ignores it.
  if (!(await git(root, ["check-ignore", "-q", "--", BASELINE_FILE])).ok) return
  const ignored = await git(root, ["check-ignore", "-v", "--", BASELINE_FILE])
  const source = ignored.ok ? (ignored.stdout.split("\t")[0]?.trim() ?? "") : ""
  io.stdout(
    `git ignores ${BASELINE_FILE}${source === "" ? "" : ` (${source})`}: add !baseline.json to .rulecast/.gitignore, or commit it with git add -f\n`,
  )
}
