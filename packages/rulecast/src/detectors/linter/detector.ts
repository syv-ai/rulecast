import { pastDeadline, sourceReader } from "../../core/detection/per-rule"
import { lineStarts, offsetAt } from "../../core/detection/positions"
import { runTool } from "../../core/detection/tool"
import { errorMessage } from "../../core/errors"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import { describeTool, resolveTool } from "./resolve"
import { type LinterConfig, linterSchema, type ToolName } from "./schema"
import { type LinterFinding, TOOLS } from "./tools"

/** The source a finding points at; "" when the file is gone or the range is empty. */
function excerpt(source: string | null, finding: LinterFinding): string {
  if (source === null) return ""
  const starts = lineStarts(source)
  const from = offsetAt(starts, finding.line, finding.column, source.length)
  let to: number
  if (finding.endColumn === null) {
    // No end column: take the rest of the line. Not the start of the next one — a last line with
    // no trailing newline has no next line to start, and offsetAt would clamp back to this line's
    // start, leaving the excerpt empty.
    const newline = source.indexOf("\n", from)
    to = newline === -1 ? source.length : newline
  } else {
    to = offsetAt(starts, finding.endLine, finding.endColumn, source.length)
  }
  return source.slice(from, Math.max(from, to)).replace(/\n$/, "")
}

async function runLinter(tool: ToolName, files: string[], cwd: string, signal: AbortSignal): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, cwd)
  const args = [...resolved.prefix, ...TOOLS[tool].args(files)]
  // Linters exit non-zero when they find something; the output is the answer, not the exit code.
  const stdout = await runTool(resolved.command, args, { cwd, signal, notFound: `${tool} is not installed` })
  return TOOLS[tool].parse(stdout, cwd)
}

/**
 * Content that is not on disk (a staged run, `--to-ref`), one file per process on stdin under the
 * file's real path, so path-keyed configuration — eslint `files:` globs, ruff `per-file-ignores`,
 * a nested pyproject.toml — applies exactly as it would to the file on disk.
 */
async function runLinterOnContent(
  tool: ToolName,
  files: string[],
  read: (file: string) => Promise<string | null>,
  cwd: string,
  signal: AbortSignal,
): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, cwd)
  const findings: LinterFinding[] = []
  for (const file of files) {
    const stdin = await read(file)
    if (stdin === null) continue
    const args = [...resolved.prefix, ...TOOLS[tool].stdinArgs!(file)]
    const stdout = await runTool(resolved.command, args, { cwd, signal, notFound: `${tool} is not installed`, stdin })
    findings.push(...TOOLS[tool].parse(stdout, cwd))
  }
  return findings
}

export const linterDetector: Detector<LinterConfig> = {
  kind: "linter",
  schema: linterSchema,
  captures: () => ["message", "ruleId"],
  // A copy: compileRule stores this as the rule's stages, and module-level data must not escape into it.
  events: (config) => [...TOOLS[config.tool].events],
  takesContent: (config) => TOOLS[config.tool].stdinArgs !== undefined,
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const byTool = new Map<ToolName, DetectorRuleInput<LinterConfig>[]>()
    for (const rule of input.rules) {
      byTool.set(rule.config.tool, [...(byTool.get(rule.config.tool) ?? []), rule])
    }
    const onDisk = input.fromDisk !== false
    const read = onDisk ? sourceReader(input.cwd) : input.read

    await Promise.all(
      [...byTool].map(async ([tool, rules]) => {
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        if (files.length === 0) return
        // Everything that can fail for this tool is inside one guard, reading the files for
        // {{text}} included: an unreadable file must not escape as a whole-run error and take the
        // other tools down with it (spec §14).
        try {
          const findings = onDisk
            ? await runLinter(tool, files, input.cwd, input.signal)
            : await runLinterOnContent(tool, files, read, input.cwd, input.signal)
          for (const finding of findings) {
            const match: Match = {
              file: finding.file,
              line: finding.line,
              endLine: finding.endLine,
              column: finding.column,
              text: excerpt(await read(finding.file), finding),
              captures: { message: finding.message, ruleId: finding.ruleId },
            }
            for (const rule of rules) {
              if (!rule.files.includes(finding.file)) continue
              if (rule.config.rules && !rule.config.rules.includes(finding.ruleId)) continue
              result.findings.push({ rule: rule.id, match })
            }
          }
        } catch (error) {
          if (pastDeadline(error, input)) throw error
          // One error per rule: a whole-run error would disable the other tools too.
          const message = errorMessage(error)
          for (const rule of rules) result.errors.push({ rule: rule.id, message })
        }
      }),
    )
    return result
  },
  async check(input) {
    // One result per tool, in first-use order: every rule naming a tool shares its fate.
    const byTool = new Map<ToolName, string[]>()
    for (const rule of input.rules) {
      byTool.set(rule.config.tool, [...(byTool.get(rule.config.tool) ?? []), rule.id])
    }
    return Promise.all(
      [...byTool].map(async ([tool, rules]): Promise<CheckResult> => {
        const described = await describeTool(tool, input.cwd, { signal: input.signal })
        if (!described.found) return { what: tool, level: "error", detail: "not installed", rules }
        const detail = described.how === "path" ? `${described.command} (PATH)` : described.command
        return { what: tool, level: "ok", detail, rules: [] }
      }),
    )
  },
}
