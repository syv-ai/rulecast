import { access, constants } from "node:fs/promises"
import path from "node:path"

import { readOutput, type ToolFinding } from "../../core/detection/outputs"
import { pastDeadline } from "../../core/detection/per-rule"
import { excerpt } from "../../core/detection/positions"
import { runTool } from "../../core/detection/tool"
import { errorMessage } from "../../core/errors"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import { onPath } from "../../core/which"
import { isToolError, streamText, toolFailure } from "./exit"
import { type CommandConfig, commandSchema } from "./schema"

const FILES = "{{files}}"

/** The rule's files replace the "{{files}}" element, or are appended when there is none. */
export function argvFor(run: string[], files: string[]): string[] {
  if (!run.includes(FILES)) return [...run, ...files]
  return run.flatMap((argument) => (argument === FILES ? files : [argument]))
}

/** What every finding carries, whatever the tool: a rule's message can always use them. */
const ALWAYS = ["message", "ruleId", "severity"] as const

/**
 * Spec §6 and §14: "every declared capture must be a string field of every result; a missing one
 * is a rule error". Unlike a pattern's unmatched group, a checker that does not emit a field it
 * was told it emits is misconfigured, and silently delivering "" would hide it.
 */
function capturesOf(finding: ToolFinding, names: string[], where: string): Record<string, string> {
  const captures: Record<string, string> = {
    message: finding.message,
    ruleId: finding.ruleId,
    severity: finding.severity,
  }
  for (const name of names) {
    if ((ALWAYS as readonly string[]).includes(name)) continue
    const value = finding.properties[name]
    if (typeof value !== "string") throw new Error(`${where}: capture "${name}" is not a string`)
    captures[name] = value
  }
  return captures
}

/** A tool's finding as a match; `{{text}}` is the source at its range unless the tool gave its own. */
export async function toMatch(
  finding: ToolFinding,
  index: number,
  captures: string[],
  read: (file: string) => Promise<string | null>,
): Promise<Match> {
  return {
    file: finding.file,
    line: finding.line,
    endLine: finding.endLine,
    column: finding.column,
    text: finding.text ?? excerpt(await read(finding.file), finding),
    captures: capturesOf(finding, captures, `result ${index + 1}`),
    ...(finding.wholeFile && { wholeFile: true }),
  }
}

/**
 * Can argv[0] be run? A name carrying a separator is a path in the project and is tested directly;
 * a bare name is a PATH lookup. Nothing is executed: doctor must not run a project's checker just
 * to find out whether it exists.
 */
async function reachable(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{ level: "ok" | "error"; detail: string }> {
  if (!command.includes("/")) {
    return (await onPath(command, signal))
      ? { level: "ok", detail: `${command} (PATH)` }
      : { level: "error", detail: "not installed" }
  }
  const full = path.resolve(cwd, command)
  try {
    await access(full, constants.F_OK)
  } catch {
    return { level: "error", detail: "no such file" }
  }
  try {
    await access(full, constants.X_OK)
  } catch {
    return { level: "error", detail: "not executable" }
  }
  return { level: "ok", detail: full }
}

/**
 * Rules that make the same call share one run: same argv before the files are put in, and the
 * output read the same way. Three semgrep rules with different `rules:` scan once.
 */
export function runKey(config: CommandConfig): string {
  return JSON.stringify([
    config.run,
    config.output,
    config.stream ?? "stdout",
    config.scope ?? "files",
    config.exit_codes,
  ])
}

/**
 * A tool's findings handed to every rule of the run that selected the finding's file and whose
 * `rules` admit its rule id. Shared with `hook`, which reads its runs the same way.
 */
export async function distribute(
  findings: ToolFinding[],
  rules: DetectorRuleInput<{ rules?: string[]; captures: string[] }>[],
  read: (file: string) => Promise<string | null>,
  result: DetectorResult,
): Promise<void> {
  for (const rule of rules) {
    const files = new Set(rule.files)
    try {
      const matches: Match[] = []
      for (const [index, finding] of findings.entries()) {
        if (!files.has(finding.file)) continue
        if (rule.config.rules && !rule.config.rules.includes(finding.ruleId)) continue
        matches.push(await toMatch(finding, index, rule.config.captures, read))
      }
      for (const match of matches) result.findings.push({ rule: rule.id, match })
    } catch (error) {
      result.errors.push({ rule: rule.id, message: errorMessage(error) })
    }
  }
}

export const commandDetector: Detector<CommandConfig> = {
  kind: "command",
  schema: commandSchema,
  captures: (config) => [...new Set([...ALWAYS, ...config.captures])],
  // A whole-project tool is too slow for an edit, as eslint is: `stages: [edit, verify]` opts in.
  events: (config) => (config.scope === "project" ? ["verify"] : ["edit", "verify"]),
  wholeProject: (config) => config.scope === "project",
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const groups = new Map<string, DetectorRuleInput<CommandConfig>[]>()
    for (const rule of input.rules) {
      const key = runKey(rule.config)
      const group = groups.get(key)
      if (group) group.push(rule)
      else groups.set(key, [rule])
    }
    await Promise.all(
      [...groups.values()].map(async (rules) => {
        const config = rules[0]!.config
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        if (files.length === 0) return
        // A project-scope tool is given no files; which findings matter is the rules' files.
        const [command, ...rest] = argvFor(config.run, config.scope === "project" ? [] : files)
        try {
          const ran = await runTool(command!, rest, {
            cwd: input.cwd,
            signal: input.signal,
            notFound: `command not found: ${command}`,
          })
          if (isToolError(ran.exitCode, config)) throw new Error(toolFailure(command!, ran))
          const findings = readOutput(config.output, streamText(ran, config.stream), input.cwd)
          await distribute(findings, rules, input.read, result)
        } catch (error) {
          if (pastDeadline(error, input)) throw error
          // One error per rule of this run: the other runs are not affected.
          const message = errorMessage(error)
          for (const rule of rules) result.errors.push({ rule: rule.id, message })
        }
      }),
    )
    return result
  },
  async check(input) {
    // One result per distinct command, not per rule: two rules calling the same script share a fate.
    const byCommand = new Map<string, string[]>()
    for (const rule of input.rules) {
      const command = rule.config.run[0]!
      const group = byCommand.get(command)
      if (group) group.push(rule.id)
      else byCommand.set(command, [rule.id])
    }
    return Promise.all(
      [...byCommand].map(async ([command, rules]): Promise<CheckResult> => {
        const { level, detail } = await reachable(command, input.cwd, input.signal)
        return { what: command, level, detail, rules: level === "ok" ? [] : rules }
      }),
    )
  },
}
