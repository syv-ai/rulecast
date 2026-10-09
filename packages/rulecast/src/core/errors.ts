import {
  ZodDefault,
  ZodEffects,
  type ZodError,
  type ZodIssue,
  ZodNullable,
  ZodObject,
  ZodOptional,
  type ZodTypeAny,
} from "zod"

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

/**
 * A validation error as a person can act on it. Paths are joined onto `prefix` (`detect.llm`), and
 * an issue at the root of what was parsed prints the prefix alone — never `(root)`, which named
 * nothing a reader could find. An unknown key says so and, given the `schema` that was parsed, names
 * the closest key it accepts: `unknown key "prompt" (did you mean "question"?)`. Unknown keys come
 * first, because a misspelt key is usually also why a required one is "missing".
 */
export function formatZodError(error: ZodError, options: { prefix?: string; schema?: ZodTypeAny } = {}): string {
  const where = (path: readonly (string | number)[]) =>
    [options.prefix, ...path.map(String)].filter((part) => part !== undefined && part !== "").join(".")
  const describe = (issue: ZodIssue): string => {
    const at = where(issue.path)
    const label = at === "" ? "" : `${at}: `
    if (issue.code === "unrecognized_keys") {
      const known = options.schema === undefined ? [] : keysAt(options.schema, issue.path)
      // One unknown key where exactly one required key is missing: that is the key it stands for,
      // however differently it is spelt ("prompt" for "question").
      const missing = missingAt(error.issues, issue.path)
      const standIn = issue.keys.length === 1 && missing.length === 1 ? missing[0]! : null
      return issue.keys
        .map((key) => {
          const guess = closest(key, known) ?? standIn
          return `${label}unknown key "${key}"${guess === null ? "" : ` (did you mean "${guess}"?)`}`
        })
        .join("; ")
    }
    const message = issue.message === "Required" ? "required" : issue.message
    return `${label}${message}`
  }
  const ordered = [
    ...error.issues.filter((issue) => issue.code === "unrecognized_keys"),
    ...error.issues.filter((issue) => issue.code !== "unrecognized_keys"),
  ]
  return ordered.map(describe).join("; ")
}

/** The keys an object schema accepts at `path`, through optional, default, nullable and refinements. */
function keysAt(schema: ZodTypeAny, path: readonly (string | number)[]): string[] {
  let current: ZodTypeAny | undefined = schema
  const unwrap = (type: ZodTypeAny): ZodTypeAny => {
    if (type instanceof ZodOptional || type instanceof ZodNullable) return unwrap(type.unwrap())
    if (type instanceof ZodDefault) return unwrap(type._def.innerType)
    if (type instanceof ZodEffects) return unwrap(type.innerType())
    return type
  }
  for (const segment of path) {
    const object: ZodTypeAny | undefined = current === undefined ? undefined : unwrap(current)
    current = object instanceof ZodObject ? object.shape[String(segment)] : undefined
  }
  const object = current === undefined ? undefined : unwrap(current)
  return object instanceof ZodObject ? Object.keys(object.shape) : []
}

/** Keys reported as required-but-missing directly under `path`. */
function missingAt(issues: readonly ZodIssue[], path: readonly (string | number)[]): string[] {
  return issues
    .filter(
      (issue) =>
        issue.code === "invalid_type" &&
        issue.received === "undefined" &&
        issue.path.length === path.length + 1 &&
        path.every((segment, index) => issue.path[index] === segment),
    )
    .map((issue) => String(issue.path.at(-1)))
}

/** The known key at most two edits from `key`, or null. */
function closest(key: string, known: readonly string[]): string | null {
  let best: { key: string; distance: number } | null = null
  for (const candidate of known) {
    const distance = levenshtein(key, candidate)
    if (distance <= 2 && (best === null || distance < best.distance)) best = { key: candidate, distance }
  }
  return best?.key ?? null
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = above
    }
  }
  return row[b.length]!
}
