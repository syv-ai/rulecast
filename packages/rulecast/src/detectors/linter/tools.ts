import path from "node:path"

import type { DetectorEvent } from "../../core/types"
import type { ToolName } from "./schema"

export interface LinterFinding {
  file: string
  line: number
  column: number
  endLine: number
  /** Exclusive, 1-based; null when the tool did not say. */
  endColumn: number | null
  /** "" when the tool reported none (a syntax error, say). */
  ruleId: string
  message: string
}

export interface LinterTool {
  events: DetectorEvent[]
  args(files: string[]): string[]
  parse(stdout: string, root: string): LinterFinding[]
}

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function json(tool: ToolName, stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`${tool} output is not JSON`)
  }
}

function relative(file: string, root: string): string {
  return (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join("/")
}

const number = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback)
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** oxlint reports "eslint(no-debugger)"; the rule id people write is the part inside. */
function oxlintRuleId(code: unknown): string {
  const raw = text(code)
  return /^[\w-]+\((?<rule>[^)]+)\)$/.exec(raw)?.groups?.rule ?? raw
}

export const TOOLS: Record<ToolName, LinterTool> = {
  ruff: {
    events: ["edit", "verify"],
    args: (files) => ["check", "--output-format", "json", "--force-exclude", "--", ...files],
    parse(stdout, root) {
      const parsed = json("ruff", stdout)
      if (!Array.isArray(parsed)) throw new Error("ruff output is not a JSON array of diagnostics")
      return parsed.filter(isObject).map((result) => {
        const start = isObject(result.location) ? result.location : {}
        const end = isObject(result.end_location) ? result.end_location : {}
        const line = number(start.row, 1)
        return {
          file: relative(text(result.filename), root),
          line,
          column: number(start.column, 1),
          endLine: number(end.row, line),
          endColumn: typeof end.column === "number" ? end.column : null,
          ruleId: text(result.code),
          message: text(result.message),
        }
      })
    },
  },
  oxlint: {
    events: ["edit", "verify"],
    args: (files) => ["--format=json", "--", ...files],
    parse(stdout, root) {
      const parsed = json("oxlint", stdout)
      if (!isObject(parsed) || !Array.isArray(parsed.diagnostics)) {
        throw new Error("oxlint output is not JSON with diagnostics")
      }
      return parsed.diagnostics.filter(isObject).map((diagnostic) => {
        const label = Array.isArray(diagnostic.labels) ? diagnostic.labels[0] : undefined
        const span = isObject(label) && isObject(label.span) ? label.span : {}
        const line = number(span.line, 1)
        return {
          file: relative(text(diagnostic.filename), root),
          line,
          column: number(span.column, 1),
          endLine: line,
          endColumn: null,
          ruleId: oxlintRuleId(diagnostic.code),
          message: text(diagnostic.message),
        }
      })
    },
  },
  eslint: {
    // eslint is the slow one: spec §6 keeps it off the edit hook by default.
    events: ["verify"],
    args: (files) => ["--format=json", "--no-error-on-unmatched-pattern", "--", ...files],
    parse(stdout, root) {
      const parsed = json("eslint", stdout)
      if (!Array.isArray(parsed)) throw new Error("eslint output is not a JSON array of file results")
      const findings: LinterFinding[] = []
      for (const file of parsed.filter(isObject)) {
        const messages = Array.isArray(file.messages) ? file.messages : []
        for (const message of messages.filter(isObject)) {
          const line = number(message.line, 1)
          findings.push({
            file: relative(text(file.filePath), root),
            line,
            column: number(message.column, 1),
            endLine: number(message.endLine, line),
            endColumn: typeof message.endColumn === "number" ? message.endColumn : null,
            ruleId: text(message.ruleId),
            message: text(message.message),
          })
        }
      }
      return findings
    },
  },
}
