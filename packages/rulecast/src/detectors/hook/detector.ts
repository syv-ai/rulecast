import path from "node:path"

import { readOutput, type ToolFinding } from "../../core/detection/outputs"
import { pastDeadline } from "../../core/detection/per-rule"
import { runTool, type ToolResult } from "../../core/detection/tool"
import { errorMessage } from "../../core/errors"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, DetectorRun } from "../../core/types"
import { distribute } from "../command/detector"
import { isToolError, toolFailure } from "../command/exit"
import { stripRunnerFraming } from "./framing"
import { restoreChanged, snapshot } from "./modified"
import {
  findLefthookJob,
  findPreCommitHook,
  lefthookCommand,
  lefthookDump,
  PRE_COMMIT_CONFIG,
  preCommitRunner,
  repositoryTop,
  substituteFiles,
} from "./resolve"
import { type HookConfig, hookName, hookSchema } from "./schema"

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
}

/** The rule's files as paths from `dir`. */
const from = (dir: string, files: string[], input: DetectorRun<HookConfig>) =>
  files.map((file) => path.relative(dir, path.join(input.cwd, file)))

/** The repository declares and runs the hook, from its top; the files are the project's. */
async function runPreCommit(id: string, files: string[], input: DetectorRun<HookConfig>): Promise<HookRun> {
  const top = await repositoryTop(input.cwd)
  const hook = await findPreCommitHook(top, id)
  if (hook === null) throw new Error(`no hook with id "${id}" in ${PRE_COMMIT_CONFIG}`)
  const found = await preCommitRunner(input.cwd, top, input.signal)
  if (found === null) throw new Error("neither prek nor pre-commit is installed")
  const stage = hook.stage === "pre-commit" ? [] : ["--hook-stage", hook.stage]
  // `--files` runs on exactly these files and never stashes (pre-commit and prek both).
  const ran = await runTool(found.command, ["run", id, ...stage, "--files", ...from(top, files, input)], {
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
  const ran: ToolResult = await runTool("/bin/sh", ["-c", substituteFiles(job.run, from(dir, files, input))], {
    cwd: dir,
    signal: input.signal,
    notFound: "/bin/sh is not available",
  })
  return { exitCode: ran.exitCode, failed: ran.exitCode !== 0, output: `${ran.stdout}\n${ran.stderr}`, dir }
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
            : await runLefthook(config.lefthook!, files, input)
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
        const findings = readOutput(config.output, ran.output, ran.dir).map((finding) =>
          ran.dir === input.cwd
            ? finding
            : { ...finding, file: path.relative(input.cwd, path.join(ran.dir, finding.file)) },
        )
        await distribute(findings, rules, input.read, result)
        if (ran.failed && changed.length === 0) {
          // The hook failed and nothing it said reached a rule — no format reads it, or it is all
          // about files the rule did not select: the agent still hears that it failed, and what it said.
          const said = ran.output.trim().split(/\r?\n/).slice(0, OUTPUT_LINES).join("\n")
          const told = new Set(result.findings.map((finding) => finding.rule))
          for (const rule of forHook(rules, name).filter((rule) => !told.has(rule.id))) {
            const finding = await hookFinding(
              rule.files[0]!,
              name,
              `${name} failed${said ? `: ${said}` : ""}`,
              input.read,
            )
            await distribute([finding], [rule], input.read, result)
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
    if (preCommit.length > 0) {
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
    if (lefthook.length > 0) {
      const command = await lefthookCommand(input.cwd, top, input.signal)
      if (command === null) {
        results.push({
          what: "lefthook",
          level: "error",
          detail: "not installed",
          rules: lefthook.map((rule) => rule.id),
        })
        return results
      }
      results.push({ what: "lefthook", level: "ok", detail: shown(command), rules: [] })
      const dump = await lefthookDump(command, top, input.signal)
      const byJob = new Map<string, string[]>()
      for (const rule of lefthook)
        byJob.set(rule.config.lefthook!, [...(byJob.get(rule.config.lefthook!) ?? []), rule.id])
      for (const [job, rules] of byJob) {
        if (findLefthookJob(dump, job) !== null) continue
        results.push({ what: `lefthook job "${job}"`, level: "error", detail: "no such job with a run command", rules })
      }
    }
    return results
  },
}
