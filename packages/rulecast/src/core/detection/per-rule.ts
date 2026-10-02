import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { DeadlineError, errorMessage, isNotFound } from "../errors"
import type { Detector, DetectorResult, DetectorRuleInput, DetectorRun, Match } from "../types"

/**
 * Whether this error is the clock rather than the rule.
 *
 * It decides which of two very different things a detector reports. Rethrowing lets the core record
 * a timeout, which is logged and tried again at the next verify; swallowing it into
 * `DetectorResult.errors` is a rule error, which disables the rule for the whole session (§14).
 *
 * The signal alone cannot tell the two apart. Its abort timer only runs when the event loop is free,
 * and synchronous work — `ast-grep` parses in native code that no timeout interrupts — is what keeps
 * it busy. So the wall clock is the authority, and every detector that catches its own errors has to
 * ask this rather than `signal.aborted`.
 */
export function pastDeadline(error: unknown, input: Pick<DetectorRun<unknown>, "signal" | "deadlineAt">): boolean {
  return error instanceof DeadlineError || input.signal.aborted || Date.now() > input.deadlineAt
}

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
          if (pastDeadline(error, input)) throw error
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
