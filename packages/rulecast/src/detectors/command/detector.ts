import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { perRule } from "../../core/detection/per-rule"
import { isNotFound } from "../../core/errors"
import type { Detector } from "../../core/types"
import { matchesFromJson, matchesFromSarif } from "./results"
import { type CommandConfig, commandSchema } from "./schema"

const exec = promisify(execFile)

const FILES = "{{files}}"

/** The rule's files replace the "{{files}}" element, or are appended when there is none. */
export function argvFor(run: string[], files: string[]): string[] {
  if (!run.includes(FILES)) return [...run, ...files]
  return run.flatMap((argument) => (argument === FILES ? files : [argument]))
}

export const commandDetector: Detector<CommandConfig> = {
  kind: "command",
  schema: commandSchema,
  captures: (config) => config.captures,
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    if (rule.files.length === 0) return []
    const [command, ...rest] = argvFor(rule.config.run, rule.files)
    let stdout: string
    try {
      // The exit code says "I found something", not "I failed": the output is the answer.
      const result = await exec(command!, rest, { cwd: input.cwd, signal: input.signal, maxBuffer: 64 * 1024 * 1024 })
      stdout = result.stdout
    } catch (error) {
      if (input.signal.aborted) throw error
      if (isNotFound(error)) throw new Error(`command not found: ${command}`)
      const failure = error as { stdout?: string }
      if (typeof failure.stdout !== "string") throw error
      stdout = failure.stdout
    }
    return rule.config.output === "sarif"
      ? matchesFromSarif(stdout, rule.config.captures, input.cwd)
      : matchesFromJson(stdout, rule.config.captures, input.cwd)
  }),
}
