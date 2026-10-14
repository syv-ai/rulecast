import type { ToolFinding } from "."

/**
 * The line formats most tools can print, so a rule names one instead of writing a pattern:
 *
 * - `gcc`: `file:line:col: [severity[rule]:] message [(rule)|[rule]]` — mypy `--show-column-numbers`,
 *   ty `--output-format concise`, shellcheck `-f gcc`, staticcheck, golangci-lint, deadcode, tflint `-f compact`.
 * - `gcc-nocol`: the same without a column — vulture, mypy without columns.
 * - `msbuild`: `file(line,col): severity CODE: message` — tsc, dotnet, MSBuild.
 *
 * reviewdog's errorformat covers more, but it is a Go binary with no JavaScript port; these and a
 * rule's own `pattern` are rulecast's answer instead.
 */
export const LINE_PRESETS = ["gcc", "gcc-nocol", "msbuild"] as const

type Preset = (typeof LINE_PRESETS)[number]

/** A drive letter, then anything up to the separator; never leading whitespace, which is a continuation line. */
const FILE = "(?<file>(?:[A-Za-z]:)?[^:\\s][^:]*?)"
const HEADS: Record<Preset, RegExp> = {
  gcc: new RegExp(`^${FILE}:(?<line>\\d+):(?<col>\\d+):\\s*(?<rest>.*)$`),
  "gcc-nocol": new RegExp(`^${FILE}:(?<line>\\d+):\\s*(?<rest>.*)$`),
  msbuild:
    /^(?<file>(?:[A-Za-z]:)?[^(\s][^(]*?)\((?<line>\d+)(?:,(?<col>\d+))?(?:,(?<endLine>\d+),(?<endCol>\d+))?\)\s*:\s*(?<rest>.*)$/,
}

/** `error:`, ty's `error[rule]`, tflint's `Warning - `. */
const SEVERITY =
  /^(?<severity>fatal error|error|warning|warn|note|info|information|hint|style|remark)(?:\[(?<rule>[^\]\s]+)\]:?|\s*:|\s+-)\s+/i
/** A trailing `(U1000)` or `[SC2115]`: no spaces inside, so `(90% confidence)` stays in the message. */
const TRAILING_RULE = /\s+[[(](?<rule>[\w.:/@-]+)[\])]$/
/** `error TS2322: message`, `warning CA1822: message`, or a bare `error: message`. */
const MSBUILD_REST =
  /^(?:(?<severity>fatal error|error|warning|info|message|hint)\s*)?(?<rule>[A-Za-z][\w-]*\d+)?\s*:\s*(?<message>.*)$/i
/** dotnet appends the project: `[C:\src\App.csproj]`. */
const MSBUILD_PROJECT = /\s+\[[^\]]*proj\]$/

const ESCAPE = String.fromCharCode(27)
const ANSI = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "g")

/** The named groups a pattern may use; any other group is a property, for captures. */
const GROUPS = {
  file: "file",
  line: "line",
  col: "column",
  column: "column",
  endLine: "endLine",
  endCol: "endColumn",
  endColumn: "endColumn",
  rule: "ruleId",
  ruleId: "ruleId",
  message: "message",
  severity: "severity",
} as const
const REQUIRED = ["file", "line", "message"]

/** A rule's pattern, compiled; `problem` says why it cannot be used, for the schema to report. */
export function compilePattern(pattern: string): { regex: RegExp | null; problem: string | null } {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error) {
    return { regex: null, problem: `the pattern does not compile: ${(error as Error).message}` }
  }
  const names = new Set([...pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map((match) => match[1]!))
  const missing = REQUIRED.filter((name) => !names.has(name))
  if (missing.length > 0) {
    return {
      regex: null,
      problem: `the pattern needs named groups ${missing.map((name) => `(?<${name}>…)`).join(", ")}`,
    }
  }
  return { regex, problem: null }
}

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value === "") return null
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : null
}

function finding(
  groups: Record<string, string | undefined>,
  relative: (file: string) => string,
  properties: Record<string, string> = {},
): ToolFinding {
  const line = Math.max(toNumber(groups.line) ?? 1, 1)
  return {
    file: relative(groups.file!.trim()),
    line,
    column: Math.max(toNumber(groups.column) ?? 1, 1),
    endLine: toNumber(groups.endLine) ?? line,
    endColumn: toNumber(groups.endColumn),
    ruleId: groups.ruleId ?? "",
    message: (groups.message ?? "").trim(),
    severity: (groups.severity ?? "").toLowerCase(),
    text: null,
    properties,
  }
}

function fromPreset(preset: Preset, line: string, relative: (file: string) => string): ToolFinding | null {
  const head = HEADS[preset].exec(line)?.groups
  if (!head) return null
  let rest = head.rest!.trim()
  let severity: string | undefined
  let rule: string | undefined
  if (preset === "msbuild") {
    rest = rest.replace(MSBUILD_PROJECT, "")
    const parts = MSBUILD_REST.exec(rest)?.groups
    if (parts) {
      severity = parts.severity
      rule = parts.rule
      rest = parts.message!
    }
  } else {
    const lead = SEVERITY.exec(rest)
    if (lead) {
      severity = lead.groups!.severity
      rule = lead.groups!.rule
      rest = rest.slice(lead[0].length)
    }
    if (rule === undefined) {
      const trailing = TRAILING_RULE.exec(rest)
      if (trailing) {
        rule = trailing.groups!.rule
        rest = rest.slice(0, trailing.index)
      }
    }
  }
  return finding(
    {
      file: head.file,
      line: head.line,
      column: head.col,
      endLine: head.endLine,
      endColumn: head.endCol,
      ruleId: rule,
      severity,
      message: rest,
    },
    relative,
  )
}

function fromPattern(regex: RegExp, line: string, relative: (file: string) => string): ToolFinding | null {
  const groups = regex.exec(line)?.groups
  if (!groups?.file) return null
  const known: Record<string, string | undefined> = {}
  const properties: Record<string, string> = {}
  for (const [name, value] of Object.entries(groups)) {
    const field = GROUPS[name as keyof typeof GROUPS]
    if (field) known[field] = value
    else if (value !== undefined) properties[name] = value
  }
  return finding(known, relative, properties)
}

/**
 * One finding per line that matches; every other line is ignored, because tools interleave source
 * excerpts, continuation lines and summaries with their findings.
 */
export function readLines(
  format: Preset | { pattern: string },
  output: string,
  relative: (file: string) => string,
): ToolFinding[] {
  const read =
    typeof format === "string"
      ? (line: string) => fromPreset(format, line, relative)
      : (() => {
          const { regex, problem } = compilePattern(format.pattern)
          if (!regex) throw new Error(problem!)
          return (line: string) => fromPattern(regex, line, relative)
        })()
  const findings: ToolFinding[] = []
  for (const raw of output.replace(ANSI, "").split(/\r?\n/)) {
    const found = read(raw)
    if (found) findings.push(found)
  }
  return findings
}
