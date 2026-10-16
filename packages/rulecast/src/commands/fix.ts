import { chmod, lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { exitCodeFor } from "../adapters/cli/format"
import { compile, diagnosticText } from "../core/compile/project"
import { type DetectorRule, isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver } from "../core/delivery/resolve"
import { detectionFor } from "../core/detection/context"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { selectDetectorRules } from "../core/detection/select"
import { errorMessage } from "../core/errors"
import { runExamples } from "../core/examples"
import { unifiedDiff } from "../core/fix/diff"
import { type FixSite, fixPasses, MAX_PASSES } from "../core/fix/passes"
import { cacheHome, ensureProjectState } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { Delivery } from "../core/types"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { checkRun, formatRun, parseRunArgs, type RunArgs, selectFiles } from "./run"
import { UsageError } from "./usage"

interface FixArgs {
  run: RunArgs
  dryRun: boolean
}

/**
 * `run`'s flags, less the ones that cannot mean anything for a command that writes the working
 * tree, plus `--dry-run`. A selection flag is required: the default `run` selection is the staged
 * files, read from the index, and writing a fix to the working tree behind a partly staged file
 * would leave the index and the tree saying different things.
 */
export function parseFixArgs(args: string[]): FixArgs {
  const dryRun = args.includes("--dry-run")
  const run = parseRunArgs(args.filter((arg) => arg !== "--dry-run"))
  if (run.format !== "terminal" && run.format !== "json") {
    throw new UsageError(`fix prints terminal or json, not ${run.format}`)
  }
  if (run.toRef !== null) throw new UsageError("--to-ref does not apply to fix: fixes are written to the working tree")
  if (run.session !== null) throw new UsageError("--session does not apply to fix")
  if (run.summary) throw new UsageError("--summary does not apply to fix")
  if (run.ref !== null) throw new UsageError("--ref only applies to try-repo")
  if (run.leading.length > 1) throw new UsageError(`unexpected arguments: ${run.leading.slice(1).join(" ")}`)
  if (run.files === null && !run.allFiles && run.fromRef === null) {
    throw new UsageError("fix needs --files, --all-files or --from-ref: it writes to the working tree, not the index")
  }
  return { run, dryRun }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** "fixed 37 findings in 12 files (python/logger-not-print ×30, react/x ×7)". */
function summaryLine(fixed: readonly FixSite[], files: number, dryRun: boolean): string {
  if (fixed.length === 0) return dryRun ? "nothing to fix" : "nothing fixed"
  const byRule = new Map<string, number>()
  for (const site of fixed) byRule.set(site.rule, (byRule.get(site.rule) ?? 0) + 1)
  const rules = [...byRule]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([rule, count]) => `${rule} ×${count}`)
  return `${dryRun ? "would fix" : "fixed"} ${plural(fixed.length, "finding")} in ${plural(files, "file")} (${rules.join(", ")})`
}

/**
 * Why a file a fix changed must not be written, or null. A symlink is not written through, even to
 * a file inside the project: the file it names is not the one git tracks under this path, and it may
 * be outside the project, where nothing would show the change. A file below a symlinked directory
 * that leads out of the project is refused too. A file that is not UTF-8 was mangled by reading it
 * as text, so its fix is no fix. Asked under --dry-run too, so the diff shows only what a real run
 * would write.
 */
async function unwritable(root: string, file: string, before: string): Promise<string | null> {
  const absolute = path.join(root, file)
  if ((await lstat(absolute)).isSymbolicLink()) return "a symlink"
  const target = await realpath(absolute)
  if (path.relative(await realpath(root), target).split(path.sep)[0] === "..") return "outside the project"
  const bytes = await readFile(target)
  if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) return "not UTF-8"
  if (!Buffer.from(before, "utf8").equals(bytes)) return "changed while fixing"
  return null
}

/**
 * Replaces the file's content through a temporary file and a rename, so a reader never sees half of
 * it, keeping its mode. The rename gives the path a new inode: another hard link to the file keeps
 * the old content. Null when it was written; otherwise why it was not (`unwritable`), and it is left
 * alone. A failure to write throws, with the file as it was.
 */
export async function writeFixed(root: string, file: string, before: string, after: string): Promise<string | null> {
  const problem = await unwritable(root, file, before)
  if (problem !== null) return `${file}: ${problem}; left unchanged`
  const target = await realpath(path.join(root, file))
  const { mode } = await stat(target)
  const temporary = `${target}.rulecast-fix-${process.pid}`
  try {
    await writeFile(temporary, after)
    await chmod(temporary, mode & 0o7777)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return null
}

/** Why a named rule cannot be fixed: the compile warning that dropped its fix, or that it has none. */
function notFixable(rule: string, warnings: readonly string[]): string {
  return warnings.length > 0 ? `${rule}: ${warnings.join("; ")}` : `${rule} has no fix`
}

/**
 * `rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A) [--dry-run]`: apply the fixes
 * of `regex` and `ast-grep` rules, then check the files as `rulecast run` would.
 *
 * Only this command applies a fix. Hooks never do: rulecast never rewrites an agent's file behind
 * its back (detectors/hook/modified.ts). Nothing on the hook path imports core/fix/, and no
 * `PipelineOptions` key asks a detector for one (test/commands/fix-hooks.test.ts).
 *
 * Every finding of a fixable rule in the selected files is fixed, pre-existing ones too: a verified
 * deterministic fix is how a backlog is burned down. `--from-ref` narrows it to the changed files.
 * A rule's fix is first run over its own `bad` examples, and a rule whose examples fail is skipped.
 *
 * The exit code is `run`'s, from a check after writing. Under `--dry-run` nothing is written, so the
 * code is an estimate: the check of the files as they are, less the findings the fixes would remove.
 */
export async function fixCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const { run, dryRun } = parseFixArgs(args)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  const ruleId = run.leading[0] ?? null
  if (ruleId !== null) {
    const rule = project.rules.find((candidate) => candidate.id === ruleId)
    if (rule === undefined) throw new UsageError(`no rule "${ruleId}" (see rulecast validate)`)
    if (!rule.fixable) {
      const warnings = project.diagnostics
        .filter((diagnostic) => diagnostic.rule === ruleId && diagnostic.level === "warning")
        .map((diagnostic) => diagnostic.message)
      throw new UsageError(notFixable(ruleId, warnings))
    }
  }

  const input = { project, ruleId, run, registry, io }
  const selected = await selectFiles(root, io.cwd, run)
  const stateDir = ensureProjectState(cacheHome(io.env), root)
  const detection = detectionFor(project, registry, stateDir, createReferenceResolver(root))
  const timeoutMs = project.config.timeouts.verifyMs
  const warnings: string[] = []

  // A fix is applied to code nobody reviews line by line, so it is proven on the rule's own
  // examples first, every time: `rulecast test` may not have been run since the rule last changed.
  const usable: DetectorRule[] = []
  const candidates = project.rules
    .filter(isDetectorRule)
    .filter((rule) => rule.enabled && rule.fixable && (ruleId === null || rule.id === ruleId))
  for (const rule of candidates) {
    const examples = await runExamples({ detection, rule, timeoutMs })
    if (examples.outcomes.every((outcome) => outcome.passed)) usable.push(rule)
    else
      warnings.push(`the fix for ${rule.id} fails its examples, so it was not applied (run rulecast test ${rule.id})`)
  }

  // The rules `run` would check on these files: a fix applies to what the check after it reports.
  const selections = selectDetectorRules(usable, "verify", selected.files, new Set())
  const contents = new Map<string, string>()
  for (const file of new Set(selections.flatMap((selection) => selection.files))) {
    const text = await readSourceFile(root, file)
    if (text !== null) contents.set(file, text)
  }
  const passes = await fixPasses({ detection, selections, contents, timeoutMs })
  for (const error of passes.errors) warnings.push(`fixes not applied: ${error}`)
  for (const file of passes.unsettled) {
    warnings.push(
      `fixes were still pending after ${MAX_PASSES} passes, so ${file} was left unchanged: two rules' fixes may undo each other`,
    )
  }

  // Each file on its own: one that cannot be written is reported and left, and the rest go ahead.
  const skipped = new Set<string>()
  for (const file of passes.changed) {
    const before = contents.get(file)!
    let problem: string | null
    try {
      if (dryRun) {
        const why = await unwritable(root, file, before)
        problem = why === null ? null : `${file}: ${why}; left unchanged`
      } else {
        problem = await writeFixed(root, file, before, passes.contents.get(file)!)
      }
    } catch (error) {
      problem = `${file}: could not ${dryRun ? "check" : "write"} it (${errorMessage(error)}); left unchanged`
    }
    if (problem !== null) {
      warnings.push(problem)
      skipped.add(file)
    }
  }
  const changed = passes.changed.filter((file) => !skipped.has(file))
  const fixed = passes.fixed.filter((site) => !skipped.has(site.file))

  const check = await checkRun(input, selected)
  let delivery: Delivery = check.result.delivery
  if (dryRun) {
    // Nothing was written, so the check saw the files unfixed: leave out what the fixes would remove.
    const removed = new Set(fixed.map((site) => site.id))
    delivery = {
      ...delivery,
      findings: delivery.findings.filter((finding) => !removed.has(finding.id)),
      ...(delivery.preexisting === undefined
        ? {}
        : { preexisting: delivery.preexisting.filter((finding) => !removed.has(finding.id)) }),
    }
  }
  delivery = { ...delivery, warnings: [...warnings, ...delivery.warnings] }

  const diff = dryRun
    ? changed.map((file) => unifiedDiff(file, contents.get(file)!, passes.contents.get(file)!)).join("")
    : ""
  if (run.format === "json") {
    const extra = {
      dryRun,
      fixed,
      changedFiles: changed,
      unresolved: passes.unresolved,
      ...(dryRun ? { diff } : {}),
    }
    io.stdout(`${await formatRun(project, run, check, delivery, extra)}\n`)
  } else {
    const out: string[] = []
    if (diff !== "") out.push(diff)
    out.push(summaryLine(fixed, changed.length, dryRun))
    for (const site of passes.unresolved) {
      out.push(
        `  unresolved: ${site.file}:${site.line}  ${site.rule}  its fix did not remove the finding, so it was not applied`,
      )
    }
    out.push("", await formatRun(project, run, check, delivery))
    io.stdout(`${out.join("\n")}\n`)
  }
  return exitCodeFor(delivery, check.complete)
}
