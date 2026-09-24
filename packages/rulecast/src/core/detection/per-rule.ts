import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { DeadlineError, errorMessage, isNotFound } from "../errors"
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
          // The clock, not the rule: rethrowing lets the core record a timeout, which is logged
          // and tried again at the next verify, rather than a rule error, which would disable the
          // rule for the whole session (§14). The signal alone cannot tell the two apart —
          // synchronous work keeps its own abort timer from ever firing.
          if (error instanceof DeadlineError || input.signal.aborted || Date.now() > input.deadlineAt) throw error
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

/**
 * How large a file is, without reading it; null when it is not there.
 *
 * A file that cannot be stat'ed at all is null too, and so is never skipped: the size ceiling
 * decides whether to do less work, and a doubt there resolves the way the rest of the hook does,
 * by going ahead (§14).
 */
export async function fileBytes(cwd: string, file: string): Promise<number | null> {
  try {
    return (await stat(path.resolve(cwd, file))).size
  } catch {
    return null
  }
}
