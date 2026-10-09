import { access, constants } from "node:fs/promises"
import path from "node:path"

import { perRule } from "../../core/detection/per-rule"
import { runTool } from "../../core/detection/tool"
import type { CheckResult, Detector } from "../../core/types"
import { onPath } from "../../core/which"
import { matchesFromJson, matchesFromSarif } from "./results"
import { type CommandConfig, commandSchema } from "./schema"

const FILES = "{{files}}"

/** The rule's files replace the "{{files}}" element, or are appended when there is none. */
export function argvFor(run: string[], files: string[]): string[] {
  if (!run.includes(FILES)) return [...run, ...files]
  return run.flatMap((argument) => (argument === FILES ? files : [argument]))
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

export const commandDetector: Detector<CommandConfig> = {
  kind: "command",
  schema: commandSchema,
  captures: (config) => config.captures,
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    if (rule.files.length === 0) return []
    const [command, ...rest] = argvFor(rule.config.run, rule.files)
    // The exit code says "I found something", not "I failed": the output is the answer.
    const stdout = await runTool(command!, rest, {
      cwd: input.cwd,
      signal: input.signal,
      notFound: `command not found: ${command}`,
    })
    return rule.config.output === "sarif"
      ? matchesFromSarif(stdout, rule.config.captures, input.cwd)
      : matchesFromJson(stdout, rule.config.captures, input.cwd)
  }),
  async check(input) {
    // One result per distinct command, not per rule: two rules calling the same script share a fate.
    const byCommand = new Map<string, string[]>()
    for (const rule of input.rules) {
      const command = rule.config.run[0]!
      byCommand.set(command, [...(byCommand.get(command) ?? []), rule.id])
    }
    return Promise.all(
      [...byCommand].map(async ([command, rules]): Promise<CheckResult> => {
        const { level, detail } = await reachable(command, input.cwd, input.signal)
        return { what: command, level, detail, rules: level === "ok" ? [] : rules }
      }),
    )
  },
}
