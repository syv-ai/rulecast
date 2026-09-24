import type { ZodError } from "zod"

/**
 * A detector stopped because `DetectorRun.deadlineAt` passed, not because anything was wrong with
 * the rule. The distinction decides what happens next: a deadline miss is logged and tried again at
 * the next verify, a rule error disables the rule for the whole session (§14).
 *
 * It exists as a type rather than a clock comparison because a detector that bounds itself stops a
 * moment *before* the deadline, so asking the clock afterwards gives the wrong answer by a
 * millisecond — and silently disables a working rule.
 */
export class DeadlineError extends Error {}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ")
}
