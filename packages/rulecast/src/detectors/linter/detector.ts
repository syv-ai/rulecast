import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { readSourceFile } from "../../core/detection/per-rule"
import { lineStarts, offsetAt } from "../../core/detection/positions"
import { errorMessage, isNotFound } from "../../core/errors"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import { describeTool, resolveTool } from "./resolve"
import { type LinterConfig, linterSchema, type ToolName } from "./schema"
import { type LinterFinding, TOOLS } from "./tools"

const exec = promisify(execFile)

/** Reads each file of the union once, for {{text}}. */
function sourceReader(cwd: string): (file: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>()
  return (file) => {
    let source = cache.get(file)
    if (source === undefined) {
      source = readSourceFile(cwd, file)
      cache.set(file, source)
    }
    return source
  }
}

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

async function runTool(tool: ToolName, files: string[], cwd: string, signal: AbortSignal): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, cwd)
  const args = [...resolved.prefix, ...TOOLS[tool].args(files)]
  let stdout: string
  try {
    // Linters exit non-zero when they find something; the output is the answer, not the exit code.
    const result = await exec(resolved.command, args, { cwd, signal, maxBuffer: 64 * 1024 * 1024 })
    stdout = result.stdout
  } catch (error) {
    if (signal.aborted) throw error
    if (isNotFound(error)) throw new Error(`${tool} is not installed`)
    const failure = error as { stdout?: string }
    if (typeof failure.stdout !== "string") throw error
    stdout = failure.stdout
  }
  return TOOLS[tool].parse(stdout, cwd)
}

export const linterDetector: Detector<LinterConfig> = {
  kind: "linter",
  schema: linterSchema,
  captures: () => ["message", "ruleId"],
  // A copy: compileRule stores this as the rule's stages, and module-level data must not escape into it.
  events: (config) => [...TOOLS[config.tool].events],
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const byTool = new Map<ToolName, DetectorRuleInput<LinterConfig>[]>()
    for (const rule of input.rules) {
      byTool.set(rule.config.tool, [...(byTool.get(rule.config.tool) ?? []), rule])
    }
    const read = sourceReader(input.cwd)

    await Promise.all(
      [...byTool].map(async ([tool, rules]) => {
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        if (files.length === 0) return
        // Everything that can fail for this tool is inside one guard, reading the files for
        // {{text}} included: an unreadable file must not escape as a whole-run error and take the
        // other tools down with it (spec §14).
        try {
          const findings = await runTool(tool, files, input.cwd, input.signal)
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
          if (input.signal.aborted) throw error
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
