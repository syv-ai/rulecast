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

/** A parse that passed, with its data, or failed, with what to tell the person who wrote the input. */
export type Reported<T> = { success: true; data: T } | { success: false; message: string }

/**
 * Parses `data` for a person to read the result: the one way rulecast validates what someone wrote
 * (a config, a rule, a detector's settings, the baseline). The failure is in rulecast's wording,
 * passed to zod for this parse alone (`error`), so it never touches the zod settings of a program
 * that imports rulecast, and none of those settings reach it: zod uses a schema's own message
 * first, then this parse's, before any global one. It reaches a schema from any copy of zod 4 for
 * the same reason. `prefix` goes before every path, as `detect.llm`.
 */
export function parseReported<T extends ZodType>(schema: T, data: unknown, prefix?: string): Reported<z.output<T>> {
  return reported(schema.safeParse(data, PARSE), schema, prefix)
}

/** parseReported for a schema that refines asynchronously, as a detector's may. */
export async function parseReportedAsync<T extends ZodType>(
  schema: T,
  data: unknown,
  prefix?: string,
): Promise<Reported<z.output<T>>> {
  return reported(await schema.safeParseAsync(data, PARSE), schema, prefix)
}

function reported<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
  schema: ZodType,
  prefix: string | undefined,
): Reported<T> {
  if (result.success) return { success: true, data: result.data }
  return { success: false, message: formatZodError(result.error, { prefix, schema }) }
}

/**
 * A validation error as a person can act on it. Paths are joined onto `prefix` (`detect.llm`), and
 * an issue at the root of what was parsed prints the prefix alone — never `(root)`, which named
 * nothing a reader could find. An unknown key says so and, given the `schema` that was parsed, names
 * the closest key it accepts: `unknown key "prompt" (did you mean "question"?)`. Unknown keys come
 * first, because a misspelt key is usually also why a required one is "missing".
 */
function formatZodError(error: ZodError, options: { prefix?: string; schema?: ZodType } = {}): string {
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
    return `${label}${issue.message}`
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
type RawIssue = z.core.$ZodRawIssue

/** zod's English, for every issue rulecast has no wording of its own for. */
const english = z.locales.en().localeError!

/**
 * Rulecast's wording, for each parse parseReported makes. zod asks it only when the schema wrote no
 * message of its own, so a schema's own message always wins. The wording is built from the issue's
 * code and fields, which are zod's API, so a later zod changing its English text changes nothing a
 * rule author reads.
 */
function rulecastLocale(issue: RawIssue): ReturnType<typeof english> {
  if (issue.code === "invalid_type") return typeWording(issue) ?? english(issue)
  if (issue.code === "invalid_value") return valueWording(issue.values, issue.input)
  if (issue.code === "too_small" || issue.code === "too_big") return sizeWording(issue) ?? english(issue)
  return english(issue)
}

/** Every parse a person reads the result of: the input reported, for isMissing, and rulecast's wording. */
const PARSE = { reportInput: true, error: rulecastLocale } as const

/** A value of the wrong type, or a key that is not there. Null: zod's own words. */
function typeWording(issue: z.core.$ZodRawIssue<z.core.$ZodIssueInvalidType>): string | null {
  const { input } = issue
  if (input === undefined) return "required"
  // zod's own spellings, as its English names the two types.
  const expected = issue.expected === "nan" ? "NaN" : issue.expected
  const received = z.core.util.parsedType(input)
  if (!/^\w+$/.test(expected) || !/^\w+$/.test(received)) return null
  if (expected === "int") return "Expected integer, received float"
  // YAML's .inf and -.inf: a number, though not one any integer setting can take. NaN is "nan".
  if (received === "number" && !Number.isFinite(input)) {
    if (expected === "number") return "Expected integer, received float"
    return `Expected ${expected === "record" ? "object" : expected}, received number`
  }
  return `Expected ${expected === "record" ? "object" : expected}, received ${received.toLowerCase()}`
}

/** A literal or enum value that is not one of those allowed, or none at all. */
function valueWording(values: readonly unknown[], input: unknown): string {
  if (input === undefined) return "required"
  if (values.length === 1) {
    const [value] = values
    // JSON.stringify throws on a bigint, and a locale that throws breaks the parse itself.
    return `Invalid literal value, expected ${typeof value === "bigint" ? `${value}n` : JSON.stringify(value)}`
  }
  const expected = values.map((value) => `'${String(value)}'`).join(" | ")
  if (typeof input === "string") return `Invalid enum value. Expected ${expected}, received '${input}'`
  return `Expected ${expected}, received ${z.core.util.getParsedType(input)}`
}

/** A string, list or number out of its bounds. Null: zod's own words, as for an exact size. */
function sizeWording(
  issue: z.core.$ZodRawIssue<z.core.$ZodIssueTooSmall> | z.core.$ZodRawIssue<z.core.$ZodIssueTooBig>,
): string | null {
  if (issue.exact) return null
  const small = issue.code === "too_small"
  const bound = String(small ? issue.minimum : issue.maximum)
  if (small && issue.origin === "string") return `String must contain at least ${bound} character(s)`
  if (small && issue.origin === "array") return `Array must contain at least ${bound} element(s)`
  if (issue.origin === "number" || issue.origin === "int") {
    const comparison = small ? "greater than" : "less than"
    return `Number must be ${comparison} ${issue.inclusive ? "or equal to " : ""}${bound}`
  }
  return null
}

/**
 * A required key that is absent: rulecast's "required", or an enum or literal given no input,
 * whatever message its schema gave it.
 */
function isMissing(issue: Issue): boolean {
  if (issue.code === "invalid_type") return issue.message === "required"
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
