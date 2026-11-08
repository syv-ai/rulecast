import { repoRelativeFrom } from "../../core/detection/paths"
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
  /** What the project's own config makes of it. Only the detector filters on it. */
  level: "error" | "warning"
  /** The tool's page for the lint rule, as the tool's output gives it; null when it gives none. */
  docs: string | null
}

export interface LinterTool {
  events: DetectorEvent[]
  /**
   * `select`: the rule ids to turn on for this run, on top of whatever the project's config
   * enables, so a rule fires even where the config leaves it off. Empty: the config decides.
   */
  args(files: string[], select: string[]): string[]
  /**
   * One file's content on stdin, linted as if it were at `file` (repo-relative). Absent: the tool
   * has no such mode, so content that is not on disk reaches it as a scratch copy.
   */
  stdinArgs?(file: string, select: string[]): string[]
  /**
   * Files that hold the tool's config. A file is linted from the nearest directory above it that
   * has one, as the tool would find its config from there (`runDirFor`).
   */
  markers: string[]
  /**
   * `cwd` is where the tool ran; the findings' files come back relative to `root`, the project's.
   * "" for a finding's file when the tool names none, as gitleaks does for stdin.
   */
  parse(stdout: string, cwd: string, root?: string): LinterFinding[]
  /** The source a finding points at is itself sensitive (a secret), so `{{text}}` must not carry it. */
  redacts?: boolean
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

const number = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback)
const text = (value: unknown): string => (typeof value === "string" ? value : "")
/**
 * A doc url as the tool gave it, kept only when it is printable ASCII of a sane length: it goes into
 * the agent's context as-is, so a plugin's multi-line, huge or control-character "url" must not.
 */
const DOC_URL = /^https?:\/\/[!-~]{1,300}$/
const url = (value: unknown): string | null => (typeof value === "string" && DOC_URL.test(value) ? value : null)

/** oxlint reports "eslint(no-debugger)"; the rule id people write is the part inside. */
function oxlintRuleId(code: unknown): string {
  const raw = text(code)
  return /^[\w-]+\((?<rule>[^)]+)\)$/.exec(raw)?.groups?.rule ?? raw
}

const ruffSelect = (select: string[]): string[] => (select.length ? ["--extend-select", select.join(",")] : [])
const eslintRules = (select: string[]): string[] => select.flatMap((rule) => ["--rule", `${rule}: error`])
const GITLEAKS_FLAGS = ["--no-banner", "--log-level", "error", "--report-format", "json", "--report-path", "-"]
// gitleaks runs every rule of its config by default; --enable-rule narrows the run to the ones asked for.
const gitleaksRules = (select: string[]): string[] => select.flatMap((rule) => ["--enable-rule", rule])

export const TOOLS: Record<ToolName, LinterTool> = {
  gitleaks: {
    events: ["edit", "verify"],
    markers: [".gitleaks.toml"],
    // The project's .gitleaks.toml, .gitleaksignore and `gitleaks:allow` comments apply in both modes.
    args: (files, select) => ["dir", ...GITLEAKS_FLAGS, ...gitleaksRules(select), "--", ...files],
    // gitleaks stdin takes no file name: its findings come back with File "", and the detector
    // gives them the file it piped in.
    stdinArgs: (_file, select) => ["stdin", ...GITLEAKS_FLAGS, ...gitleaksRules(select)],
    redacts: true,
    parse(stdout, cwd, root = cwd) {
      const parsed = json("gitleaks", stdout)
      if (!Array.isArray(parsed)) throw new Error("gitleaks output is not a JSON array of findings")
      const relative = repoRelativeFrom(cwd, root)
      return parsed.filter(isObject).map((leak) => {
        const line = number(leak.StartLine, 1)
        return {
          file: text(leak.File) === "" ? "" : relative(text(leak.File)),
          line,
          column: number(leak.StartColumn, 1),
          endLine: number(leak.EndLine, line),
          // gitleaks's end column is inclusive; a finding's is exclusive.
          endColumn: typeof leak.EndColumn === "number" ? leak.EndColumn + 1 : null,
          ruleId: text(leak.RuleID),
          message: text(leak.Description),
          // Every leak is a secret: there is no lesser level, and gitleaks links no page.
          level: "error",
          docs: null,
        }
      })
    },
  },
  ruff: {
    events: ["edit", "verify"],
    markers: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
    // --extend-select adds to the config's selection; per-file-ignores and `# noqa` still apply.
    args: (files, select) => [
      "check",
      "--output-format",
      "json",
      "--force-exclude",
      ...ruffSelect(select),
      "--",
      ...files,
    ],
    stdinArgs: (file, select) => [
      "check",
      "--output-format",
      "json",
      "--force-exclude",
      ...ruffSelect(select),
      "--stdin-filename",
      file,
      "-",
    ],
    parse(stdout, cwd, root = cwd) {
      const parsed = json("ruff", stdout)
      if (!Array.isArray(parsed)) throw new Error("ruff output is not a JSON array of diagnostics")
      const relative = repoRelativeFrom(cwd, root)
      return parsed.filter(isObject).map((result) => {
        const start = isObject(result.location) ? result.location : {}
        const end = isObject(result.end_location) ? result.end_location : {}
        const line = number(start.row, 1)
        return {
          file: relative(text(result.filename)),
          line,
          column: number(start.column, 1),
          endLine: number(end.row, line),
          endColumn: typeof end.column === "number" ? end.column : null,
          ruleId: text(result.code),
          message: text(result.message),
          // ruff has no levels: every rule the project's config selects is an error.
          level: "error",
          docs: url(result.url),
        }
      })
    },
  },
  oxlint: {
    events: ["edit", "verify"],
    markers: [".oxlintrc.json"],
    // -D turns a rule on as an error over the config; inline disable comments still apply.
    args: (files, select) => ["--format=json", ...select.flatMap((rule) => ["-D", rule]), "--", ...files],
    parse(stdout, cwd, root = cwd) {
      const parsed = json("oxlint", stdout)
      if (!isObject(parsed) || !Array.isArray(parsed.diagnostics)) {
        throw new Error("oxlint output is not JSON with diagnostics")
      }
      const relative = repoRelativeFrom(cwd, root)
      return parsed.diagnostics.filter(isObject).map((diagnostic) => {
        const label = Array.isArray(diagnostic.labels) ? diagnostic.labels[0] : undefined
        const span = isObject(label) && isObject(label.span) ? label.span : {}
        const line = number(span.line, 1)
        return {
          file: relative(text(diagnostic.filename)),
          line,
          column: number(span.column, 1),
          endLine: line,
          endColumn: null,
          ruleId: oxlintRuleId(diagnostic.code),
          message: text(diagnostic.message),
          level: diagnostic.severity === "error" ? "error" : "warning",
          docs: url(diagnostic.url),
        }
      })
    },
  },
  eslint: {
    // eslint is the slow one: spec §6 keeps it off the edit hook by default.
    events: ["verify"],
    markers: [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      "eslint.config.mts",
      "eslint.config.cts",
    ],
    // --rule wins over the config, its per-file settings included; inline disable comments still
    // apply. A plugin rule needs its plugin loaded by the project's config.
    // json-with-metadata is plain json plus each fired rule's meta, where its doc url is: the same
    // single process, no extra run.
    args: (files, select) => [
      "--format=json-with-metadata",
      "--no-error-on-unmatched-pattern",
      ...eslintRules(select),
      "--",
      ...files,
    ],
    stdinArgs: (file, select) => [
      "--format=json-with-metadata",
      ...eslintRules(select),
      "--stdin",
      "--stdin-filename",
      file,
    ],
    parse(stdout, cwd, root = cwd) {
      const parsed = json("eslint", stdout)
      if (!isObject(parsed) || !Array.isArray(parsed.results)) {
        throw new Error("eslint output is not JSON with results")
      }
      const meta = isObject(parsed.metadata) && isObject(parsed.metadata.rulesMeta) ? parsed.metadata.rulesMeta : {}
      const docsOf = (ruleId: string): string | null => {
        const rule = ruleId ? meta[ruleId] : undefined
        return isObject(rule) && isObject(rule.docs) ? url(rule.docs.url) : null
      }
      const relative = repoRelativeFrom(cwd, root)
      const findings: LinterFinding[] = []
      for (const file of parsed.results.filter(isObject)) {
        const messages = Array.isArray(file.messages) ? file.messages : []
        for (const message of messages.filter(isObject)) {
          const line = number(message.line, 1)
          const ruleId = text(message.ruleId)
          findings.push({
            file: relative(text(file.filePath)),
            line,
            column: number(message.column, 1),
            endLine: number(message.endLine, line),
            endColumn: typeof message.endColumn === "number" ? message.endColumn : null,
            ruleId,
            message: text(message.message),
            // 2 is "error" in the project's config; 1 is "warn", and also eslint's own notices.
            level: message.severity === 2 ? "error" : "warning",
            docs: docsOf(ruleId),
          })
        }
      }
      return findings
    },
  },
}
