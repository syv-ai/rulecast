import {
  ZodDefault,
  type ZodError,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodPipe,
  ZodPrefault,
  ZodTransform,
  type ZodType,
  z,
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
export function formatZodError(error: ZodError, options: { prefix?: string; schema?: ZodType } = {}): string {
  const where = (path: readonly PropertyKey[]) =>
    [options.prefix, ...path.map(String)].filter((part) => part !== undefined && part !== "").join(".")
  const describe = (issue: Issue): string => {
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
    return `${label}${wording(issue)}`
  }
  // zod checks a length on anything with one, so `[]` for a string is both the wrong type and empty.
  const wrongTypeAt = new Set(
    error.issues.filter((issue) => issue.code === "invalid_type").map((issue) => where(issue.path)),
  )
  const issues = error.issues.filter((issue) => issue.code !== "too_small" || !wrongTypeAt.has(where(issue.path)))
  const ordered = [
    ...issues.filter((issue) => issue.code === "unrecognized_keys"),
    ...issues.filter((issue) => issue.code !== "unrecognized_keys"),
  ]
  return ordered.map(describe).join("; ")
}

type Issue = z.core.$ZodIssue

/** How zod's stock message reports a value of the wrong type, the one place that says what it got. */
const WRONG_TYPE = /^Invalid input: expected (\w+), received (\w+)$/

/**
 * What an issue says, in rulecast's own words. A message a schema wrote itself is left alone, which
 * is why this matches zod's stock text instead of the issue's code: the two cannot otherwise be
 * told apart. Wording zod has none for here, and any locale but English, passes through.
 */
function wording(issue: Issue): string {
  const { message } = issue
  if (isMissing(issue)) return "required"
  const wrongType = WRONG_TYPE.exec(message)
  if (wrongType !== null) {
    const [, expected, received] = wrongType
    if (expected === "int") return "Expected integer, received float"
    if (/^-?Infinity$/.test(received!)) {
      if (expected === "number") return "Expected integer, received float"
      return `Expected ${expected === "record" ? "object" : expected}, received number`
    }
    return `Expected ${expected === "record" ? "object" : expected}, received ${received!.toLowerCase()}`
  }
  if (issue.code === "invalid_value" && /^Invalid (input|option): expected /.test(message)) {
    if (issue.values.length === 1) return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`
    const expected = issue.values.map((value) => `'${String(value)}'`).join(" | ")
    if (!("input" in issue)) return `Invalid enum value. Expected ${expected}`
    return typeof issue.input === "string"
      ? `Invalid enum value. Expected ${expected}, received '${issue.input}'`
      : `Expected ${expected}, received ${z.core.util.getParsedType(issue.input)}`
  }
  const size = /^Too (small|big): expected (\w+) to (?:have|be) (>=|>|<=|<)(\S+)(?: \w+)?$/.exec(message)
  if (size !== null) {
    const [, side, origin, relation, bound] = size
    if (side === "small" && origin === "string") return `String must contain at least ${bound} character(s)`
    if (side === "small" && origin === "array") return `Array must contain at least ${bound} element(s)`
    if (origin === "number" || origin === "int") {
      const comparison = side === "small" ? "greater than" : "less than"
      return `Number must be ${comparison} ${relation!.includes("=") ? "or equal to " : ""}${bound}`
    }
  }
  return message
}

/** A required key that is absent. Enum and literal issues only say so when the input was reported. */
function isMissing(issue: Issue): boolean {
  if (issue.code === "invalid_type") return WRONG_TYPE.exec(issue.message)?.[2] === "undefined"
  return issue.code === "invalid_value" && "input" in issue && issue.input === undefined
}

/** The keys an object schema accepts at `path`, through optional, default, nullable and transforms. */
function keysAt(schema: ZodType, path: readonly PropertyKey[]): string[] {
  let current: ZodType | undefined = schema
  const unwrap = (type: ZodType): ZodType => {
    if (type instanceof ZodOptional || type instanceof ZodNullable) return unwrap(type.unwrap() as ZodType)
    if (type instanceof ZodDefault || type instanceof ZodPrefault) return unwrap(type.unwrap() as ZodType)
    if (type instanceof ZodPipe) return unwrap((type.in instanceof ZodTransform ? type.out : type.in) as ZodType)
    return type
  }
  for (const segment of path) {
    const object: ZodType | undefined = current === undefined ? undefined : unwrap(current)
    current = object instanceof ZodObject ? (object.shape[String(segment)] as ZodType | undefined) : undefined
  }
  const object = current === undefined ? undefined : unwrap(current)
  return object instanceof ZodObject ? Object.keys(object.shape) : []
}

/** Keys reported as required-but-missing directly under `path`. */
function missingAt(issues: readonly Issue[], path: readonly PropertyKey[]): string[] {
  return issues
    .filter(
      (issue) =>
        isMissing(issue) &&
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
