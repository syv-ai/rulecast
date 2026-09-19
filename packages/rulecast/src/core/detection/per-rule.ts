import { readFile } from "node:fs/promises"
import path from "node:path"

import { errorMessage, isNotFound } from "../errors"
import type { Detector, DetectorResult, DetectorRuleInput, DetectorRun, Match } from "../types"

/** Turns a per-rule function into a detector run; an error in one rule does not affect the others. */
export function perRule<Config>(
  detect: (rule: DetectorRuleInput<Config>, input: DetectorRun<Config>) => Promise<Match[]>,
): Detector<Config>["run"] {
  return async (input) => {
    const result: DetectorResult = { findings: [], errors: [] }
    await Promise.all(
      input.rules.map(async (rule) => {
        try {
          for (const match of await detect(rule, input)) result.findings.push({ rule: rule.id, match })
        } catch (error) {
          if (input.signal.aborted) throw error
          result.errors.push({ rule: rule.id, message: errorMessage(error) })
        }
      }),
    )
    return result
  }
}

/** Reads a repo-relative (or absolute) file; null when it no longer exists. */
export async function readSourceFile(cwd: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(cwd, file), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}
