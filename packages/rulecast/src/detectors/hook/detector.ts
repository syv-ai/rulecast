import { existsSync } from "node:fs"
import path from "node:path"

import { readOutput, type ToolFinding } from "../../core/detection/outputs"
import { filesFrom } from "../../core/detection/paths"
import { pastDeadline } from "../../core/detection/per-rule"
import { runTool, type ToolResult } from "../../core/detection/tool"
import { errorMessage } from "../../core/errors"
import { repositoryTop } from "../../core/git"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, DetectorRun } from "../../core/types"
import { distribute } from "../command/detector"
import { isToolError, toolFailure } from "../command/exit"
import { stripRunnerFraming } from "./framing"
import { restoreChanged, snapshot } from "./modified"
import {
  FILE_TEMPLATE,
  findLefthookJob,
  findPreCommitHook,
  HK_ENV,
  HK_PRE_PUSH_UNREAD,
  type HkPlan,
  hkCommand,
  hkNeedsNetwork,
  hkPlan,
  hkStepNeverRuns,
  lefthookCommand,
  lefthookDump,
  missingManager,
  PRE_COMMIT_CONFIG,
  parseHkRun,
  preCommitRunner,
  substituteFiles,
} from "./resolve"
import { type HookConfig, hookName, hookSchema, managerOf } from "./schema"

const ALWAYS = ["message", "ruleId", "severity"] as const
/** How many lines of an unreadable failure the finding carries. */
const OUTPUT_LINES = 5

/** What one run of a hook said, whichever runner ran it. */
interface HookRun {
  /** The hook's own exit code; null when it passed or was skipped. */
  exitCode: number | null
  failed: boolean
  output: string
  /** Where relative paths in the output are relative to. */
  dir: string
  /** The hook's command got the files it was run on (not always_run, pass_filenames: false, a job without them). */
  givenFiles: boolean
}

/** The repository declares and runs the hook, from its top; the files are the project's. */
async function runPreCommit(id: string, files: string[], input: DetectorRun<HookConfig>): Promise<HookRun> {
  const top = await repositoryTop(input.cwd)
  const hook = await findPreCommitHook(top, id)
  if (hook === null) throw new Error(`no hook with id "${id}" in ${PRE_COMMIT_CONFIG}`)
  const found = await preCommitRunner(input.cwd, top, input.signal)
  if (found === null) throw new Error("neither prek nor pre-commit is installed")
  const stage = hook.stage === "pre-commit" ? [] : ["--hook-stage", hook.stage]
  // `--files` runs on exactly these files and never stashes (pre-commit and prek both).
  const ran = await runTool(found.command, ["run", id, ...stage, "--files", ...filesFrom(top, input.cwd, files)], {
    cwd: top,
    signal: input.signal,
    notFound: `${found.runner} is not installed`,
  })
  const framed = stripRunnerFraming(`${ran.stdout}\n${ran.stderr}`, found.runner)
  // No status line: the runner stopped before the hook (an id it rejects, an environment it could not build).
  if (framed.status === null && ran.exitCode !== 0) throw new Error(toolFailure(found.runner, ran))
  return {
    exitCode: framed.exitCode,
    failed: framed.status === "failed",
    output: framed.output,
    dir: top,
    givenFiles: hook.givenFiles,
  }
}

/**
 * The job's own command, run directly: `lefthook run` would install git hooks as a side effect,
 * and its framing says less than the tool does.
 */
async function runLefthook(spec: string, files: string[], input: DetectorRun<HookConfig>): Promise<HookRun> {
  const top = await repositoryTop(input.cwd)
  const command = await lefthookCommand(input.cwd, top, input.signal)
  if (command === null) throw new Error("lefthook is not installed")
  const job = findLefthookJob(await lefthookDump(command, top, input.signal), spec)
  if (job === null) throw new Error(`lefthook has no job "${spec}" with a run command`)
  // lefthook runs a job from the repository's top, or its `root` under it, and gives it files from there.
  const dir = path.join(top, job.root)
  const ran: ToolResult = await runTool("/bin/sh", ["-c", substituteFiles(job.run, filesFrom(dir, input.cwd, files))], {
    cwd: dir,
    signal: input.signal,
    notFound: "/bin/sh is not available",
  })
  return {
    exitCode: ran.exitCode,
    failed: ran.exitCode !== 0,
    output: `${ran.stdout}\n${ran.stderr}`,
    dir,
    // A job without a files template runs over whatever it chooses, not the rule's files.
    givenFiles: FILE_TEMPLATE.test(job.run),
  }
}

/**
 * What a pre-push run needs to take the rule's files without asking the git remote (hk 2.12). Its
 * first two arguments are the remote and its url, so stand-ins come before the files; without a
 * ref range hk runs `git ls-remote` for the default branch, and HEAD..HEAD gives one with no files
 * of its own, so the given files are the ones checked.
 */
export const HK_PRE_PUSH_ARGS = ["--from-ref", "HEAD", "--to-ref", "HEAD", "rulecast", "rulecast"]

/**
 * One hk step in check mode on the rule's files: `--check` runs its check command, never its fix,
 * and `--stash none` leaves the working tree as it is. Run from the repository's top, where hk.pkl is.
 */
async function runHk(spec: string, files: string[], input: DetectorRun<HookConfig>): Promise<HookRun> {
  const top = await repositoryTop(input.cwd)
  const command = await hkCommand(input.cwd, top, input.signal)
  if (command === null) throw new Error("hk is not installed")
  // A hook rule never makes hk download its Pkl package: the developer fetches it, visibly, once.
  const network = await hkNeedsNetwork(top, process.env)
  if (network !== null) {
    // A package stays in hk's cache once fetched; for a module read over http(s) there is no such step.
    const fix = network.startsWith("hk's Pkl package")
      ? "; run `hk validate` once to download it, and the rule runs from then on"
      : ""
    throw new Error(`not run: ${network}${fix}`)
  }
  const slash = spec.indexOf("/")
  const [hook, step] = [spec.slice(0, slash), spec.slice(slash + 1)]
  const args = ["run", hook, "--check", "--step", step, "--stash", "none", "--no-stage", "--format", "json"]
  const ran = await runTool(
    command,
    [...args, ...(hook === "pre-push" ? HK_PRE_PUSH_ARGS : []), ...filesFrom(top, input.cwd, files)],
    {
      cwd: top,
      signal: input.signal,
      notFound: "hk is not installed",
      env: HK_ENV,
    },
  )
  const run = parseHkRun(ran.stdout)
  if (run === null) throw new Error(toolFailure("hk", ran))
  const result = run.steps.find((one) => one.name === step)
  // No step ran: hk stopped before it, at an unknown hook or step, and says why in `failure`.
  if (result === undefined) {
    if (run.status === "failed") throw new Error(`hk: ${run.failure ?? "the step did not run"}`)
    return { exitCode: null, failed: false, output: "", dir: top, givenFiles: false }
  }
  const failed = result.status === "failed"
  // A step's command may ignore the files hk hands it ({{files}}), and hk does not say: not counted as given.
  return { exitCode: failed ? ran.exitCode : null, failed, output: result.output ?? "", dir: top, givenFiles: false }
}

/**
 * What a tool that could not start prints: uv's "Failed to spawn", a shell's "command not found"
 * (dash: "not found"), pre-commit's "Executable `x` not found", a shebang to an interpreter that is
 * gone ("bad interpreter"), Rust tools' "(os error 2)".
 */
const CANT_RUN =
  /Failed to spawn|command not found|: not found$|Executable `[^`]+` not found|bad interpreter|No such file or directory \(os error 2\)/m

/** The hook failed because its tool could not start: exit 126 or 127, or it said so. */
const couldNotRun = (ran: HookRun) =>
  ran.failed && (ran.exitCode === 126 || ran.exitCode === 127 || CANT_RUN.test(ran.output))

/** `path:line` anywhere on a line, as tools print it outside their main format (ty's ` --> a.py:3:5`). */
const LOCATION = String.raw`(?:^|[\s(<>'"])(?<file>[\w@+.-]*(?:/[\w@+.-]+)*\.[A-Za-z0-9]+):(?<line>\d+)(?::\d+)?(?<message>)`

/**
 * The files and lines a failed hook's output names, project-relative: what its format read, and
 * any `path:line` in its lines that is a file on disk. Once each, in the order printed.
 */
function namedLocations(findings: ToolFinding[], ran: HookRun, cwd: string): { file: string; line: number }[] {
  const scanned = readOutput({ lines: { pattern: LOCATION } }, ran.output, ran.dir, cwd)
  const seen = new Set<string>()
  const out: { file: string; line: number }[] = []
  for (const { file, line } of [...findings, ...scanned]) {
    const key = `${file}:${line}`
    if (seen.has(key) || !existsSync(path.join(cwd, file))) continue
    seen.add(key)
    out.push({ file, line })
  }
  return out
}

/** A finding at the line a failed hook's output named. */
function lineFinding(location: { file: string; line: number }, ruleId: string, message: string): ToolFinding {
  return {
    file: location.file,
    line: location.line,
    column: 1,
    endLine: location.line,
    endColumn: null,
    ruleId,
    message,
    severity: "error",
    text: "",
    properties: {},
  }
}

/**
 * A finding the hook itself is the source of, not a line of its output. It spans the whole file,
 * as a `path` match does, so any edit to the file makes it the agent's rather than the backlog.
 */
async function hookFinding(
  file: string,
  ruleId: string,
  message: string,
  read: (file: string) => Promise<string | null>,
): Promise<ToolFinding> {
  const text = await read(file)
  return {
    file,
    line: 1,
    column: 1,
    endLine: text === null ? 1 : text.split(/\r?\n/).length,
    endColumn: null,
    ruleId,
    message,
    severity: "error",
    text: "",
    properties: {},
    wholeFile: true,
  }
}

/**
 * Findings about the hook as a whole (it would change a file, it failed without a location) go to
 * the rules that take every finding of the hook, or name the hook among their `rules`.
 */
function forHook(rules: DetectorRuleInput<HookConfig>[], name: string) {
  return rules.filter((rule) => !rule.config.rules || rule.config.rules.includes(name))
}

/** A command as doctor shows it: its path, or "(PATH)" after a bare name, as for command and linter. */
const shown = (command: string) => (command.includes("/") ? command : `${command} (PATH)`)

export const hookDetector: Detector<HookConfig> = {
  kind: "hook",
  schema: hookSchema,
  captures: (config) => [...new Set([...ALWAYS, ...config.captures])],
  // A hook is written for a commit, not a keystroke: `stages: [edit, verify]` opts in.
  events: () => ["verify"],
  // A hook runs in the project with its own environment; a scratch copy is not that project.
  wholeProject: () => true,
  // A formatter hook rewrites files until they are put back: nothing else may read them meanwhile.
  changesFiles: true,
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const groups = new Map<string, DetectorRuleInput<HookConfig>[]>()
    for (const rule of input.rules) {
      const key = JSON.stringify([
        rule.config["pre-commit"],
        rule.config.lefthook,
        rule.config.hk,
        rule.config.output,
        rule.config.exit_codes,
      ])
      const group = groups.get(key)
      if (group) group.push(rule)
      else groups.set(key, [rule])
    }
    // One hook at a time: two hooks over the same files would see each other's changes.
    for (const rules of groups.values()) {
      const config = rules[0]!.config
      const name = hookName(config)
      const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
      if (files.length === 0) continue
      try {
        const before = await snapshot(files, input.cwd)
        let ran: HookRun
        let changed: string[] = []
        try {
          ran = config["pre-commit"]
            ? await runPreCommit(config["pre-commit"], files, input)
            : config.lefthook
              ? await runLefthook(config.lefthook, files, input)
              : await runHk(config.hk!, files, input)
        } finally {
          changed = await restoreChanged(before, input.cwd)
          const findings = await Promise.all(
            changed.map((file) => hookFinding(file, name, `${name} would change this file`, input.read)),
          )
          await distribute(findings, forHook(rules, name), input.read, result)
        }
        if (ran.exitCode !== null && isToolError(ran.exitCode, config)) {
          throw new Error(toolFailure(name, { stdout: ran.output, stderr: "", exitCode: ran.exitCode }))
        }
        const said = ran.output.trim().split(/\r?\n/).slice(0, OUTPUT_LINES).join("\n")
        // A tool that could not start found nothing: that is the rule's error, not a finding.
        if (couldNotRun(ran)) throw new Error(`${name} could not run, so it checked nothing: ${said}`)
        const findings = readOutput(config.output, ran.output, ran.dir, input.cwd)
        await distribute(findings, rules, input.read, result)
        if (ran.failed && changed.length === 0) {
          // The hook failed and nothing it said reached a rule: no format reads it, or it is about
          // files the rule did not give it (a whole-project, always_run hook). The agent still hears
          // it, but never on a file the hook did not name.
          const named = namedLocations(findings, ran, input.cwd)
          const told = new Set(result.findings.map((finding) => finding.rule))
          for (const rule of forHook(rules, name).filter((rule) => !told.has(rule.id))) {
            const own = named.filter((location) => rule.files.includes(location.file))
            if (own.length > 0) {
              const at = own.map((location) => lineFinding(location, name, `${name} failed: ${said}`))
              await distribute(at, [rule], input.read, result)
            } else if (named.length > 0) {
              const where = named.slice(0, 3).map((location) => `${location.file}:${location.line}`)
              const message = `${name} failed over files this run did not give it (${where.join(", ")}), not over its own: ${said}`
              result.errors.push({ rule: rule.id, message })
            } else if (ran.givenFiles && files.length === 1 && rule.files.includes(files[0]!)) {
              // Given one file and naming none, the hook can only be talking about that file.
              const finding = await hookFinding(files[0]!, name, `${name} failed: ${said}`, input.read)
              await distribute([finding], [rule], input.read, result)
            } else {
              const message = `${name} failed and named no file, so this is its output about the project: ${said}`
              result.errors.push({ rule: rule.id, message })
            }
          }
        }
      } catch (error) {
        if (pastDeadline(error, input)) throw error
        const message = errorMessage(error)
        for (const rule of rules) result.errors.push({ rule: rule.id, message })
      }
    }
    return result
  },
  async validate(input) {
    const problems: { rule: string; message: string }[] = []
    const top = await repositoryTop(input.cwd)
    for (const rule of input.rules) {
      const manager = managerOf(rule.config)
      const missing = await missingManager(top, manager)
      if (missing !== null) {
        problems.push({ rule: rule.id, message: missing })
        continue
      }
      const id = rule.config["pre-commit"]
      if (id !== undefined && (await findPreCommitHook(top, id)) === null) {
        problems.push({ rule: rule.id, message: `no hook with id "${id}" in ${PRE_COMMIT_CONFIG}` })
      }
    }
    return problems
  },
  async check(input) {
    const results: CheckResult[] = []
    const top = await repositoryTop(input.cwd)
    const preCommit = input.rules.filter((rule) => rule.config["pre-commit"] !== undefined)
    const preCommitMissing = preCommit.length > 0 ? await missingManager(top, "pre-commit") : null
    if (preCommitMissing !== null) {
      results.push({
        what: "pre-commit",
        level: "error",
        detail: preCommitMissing,
        rules: preCommit.map((rule) => rule.id),
      })
    } else if (preCommit.length > 0) {
      const found = await preCommitRunner(input.cwd, top, input.signal)
      results.push(
        found === null
          ? {
              what: "prek or pre-commit",
              level: "error",
              detail: "neither is installed",
              rules: preCommit.map((rule) => rule.id),
            }
          : { what: found.runner, level: "ok", detail: shown(found.command), rules: [] },
      )
      const byId = new Map<string, string[]>()
      for (const rule of preCommit)
        byId.set(rule.config["pre-commit"]!, [...(byId.get(rule.config["pre-commit"]!) ?? []), rule.id])
      for (const [id, rules] of byId) {
        if ((await findPreCommitHook(top, id)) !== null) continue
        results.push({ what: `hook "${id}"`, level: "error", detail: `not in ${PRE_COMMIT_CONFIG}`, rules })
      }
    }
    const lefthook = input.rules.filter((rule) => rule.config.lefthook !== undefined)
    const lefthookMissing = lefthook.length > 0 ? await missingManager(top, "lefthook") : null
    if (lefthookMissing !== null) {
      results.push({
        what: "lefthook",
        level: "error",
        detail: lefthookMissing,
        rules: lefthook.map((rule) => rule.id),
      })
    } else if (lefthook.length > 0) {
      const command = await lefthookCommand(input.cwd, top, input.signal)
      if (command === null) {
        results.push({
          what: "lefthook",
          level: "error",
          detail: "not installed",
          rules: lefthook.map((rule) => rule.id),
        })
      } else {
        results.push({ what: "lefthook", level: "ok", detail: shown(command), rules: [] })
        const dump = await lefthookDump(command, top, input.signal)
        const byJob = new Map<string, string[]>()
        for (const rule of lefthook)
          byJob.set(rule.config.lefthook!, [...(byJob.get(rule.config.lefthook!) ?? []), rule.id])
        for (const [job, rules] of byJob) {
          if (findLefthookJob(dump, job) !== null) continue
          results.push({
            what: `lefthook job "${job}"`,
            level: "error",
            detail: "no such job with a run command",
            rules,
          })
        }
      }
    }
    const hk = input.rules.filter((rule) => rule.config.hk !== undefined)
    const hkMissing = hk.length > 0 ? await missingManager(top, "hk") : null
    if (hkMissing !== null) {
      results.push({ what: "hk", level: "error", detail: hkMissing, rules: hk.map((rule) => rule.id) })
    } else if (hk.length > 0) {
      const command = await hkCommand(input.cwd, top, input.signal)
      if (command === null) {
        results.push({ what: "hk", level: "error", detail: "not installed", rules: hk.map((rule) => rule.id) })
        return results
      }
      results.push({ what: "hk", level: "ok", detail: shown(command), rules: [] })
      const bySpec = new Map<string, string[]>()
      for (const rule of hk) bySpec.set(rule.config.hk!, [...(bySpec.get(rule.config.hk!) ?? []), rule.id])
      // hk is asked for its plan only when that needs no network: a Pkl package already in its
      // cache, and never the pre-push plan, which asks the git remote.
      const network = await hkNeedsNetwork(top, input.env)
      if (network !== null) {
        results.push({ what: "hk steps", level: "warning", detail: `not checked: ${network}`, rules: [] })
        return results
      }
      const plans = new Map<string, HkPlan>()
      for (const [spec, rules] of bySpec) {
        const slash = spec.indexOf("/")
        const [hook, name] = [spec.slice(0, slash), spec.slice(slash + 1)]
        if (hook === "pre-push") {
          results.push({ what: `hk step "${spec}"`, level: "warning", detail: HK_PRE_PUSH_UNREAD, rules })
          continue
        }
        if (!plans.has(hook)) plans.set(hook, await hkPlan(command, top, hook, input.signal))
        const plan = plans.get(hook)!
        if ("missing" in plan) {
          results.push({ what: `hk hook "${hook}"`, level: "error", detail: "not in hk.pkl", rules })
        } else if ("error" in plan) {
          results.push({
            what: `hk hook "${hook}"`,
            level: "error",
            detail: `hk could not plan it: ${plan.error}`,
            rules,
          })
        } else {
          const step = plan.steps.find((one) => one.name === name)
          const never = step === undefined ? null : hkStepNeverRuns(step)
          if (step === undefined) {
            results.push({ what: `hk step "${spec}"`, level: "error", detail: "no such step", rules })
          } else if (never !== null) {
            results.push({
              what: `hk step "${spec}"`,
              level: "error",
              detail: `hk never runs it to check: ${never}`,
              rules,
            })
          }
        }
      }
    }
    return results
  },
}
