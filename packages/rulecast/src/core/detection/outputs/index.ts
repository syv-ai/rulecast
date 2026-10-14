import { z } from "zod"

import { repoRelativeTo } from "../paths"
import { readCheckstyle } from "./checkstyle"
import { readGitlab } from "./gitlab"
import { readJson } from "./json"
import { compilePattern, LINE_PRESETS, readLines } from "./lines"
import { readRdjson } from "./rdjson"
import { readSarif } from "./sarif"

/**
 * One finding as a tool reported it, in rulecast's terms: the file repo-relative, line and column
 * 1-based, the end column exclusive.
 */
export interface ToolFinding {
  file: string
  line: number
  column: number
  endLine: number
  /** Exclusive, 1-based; null when the tool did not say. */
  endColumn: number | null
  /** "" when the tool reported none. */
  ruleId: string
  message: string
  /** The tool's own word ("error", "major", "note"); "" when it gave none. */
  severity: string
  /** The finding's text when the format carries it; null: the source at the range is the text. */
  text: string | null
  /** The tool's other string fields on the finding, for a rule's `captures`. */
  properties: Record<string, string>
}

export type LinePreset = (typeof LINE_PRESETS)[number]

export type OutputFormat =
  | "json"
  | "sarif"
  | "checkstyle"
  | "gitlab"
  | "rdjson"
  | { lines: LinePreset }
  | { lines: { pattern: string } }

const patternSchema = z
  .object({ pattern: z.string().min(1) })
  .strict()
  .superRefine(({ pattern }, ctx) => {
    const problem = compilePattern(pattern).problem
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["pattern"] })
  })

/** How a tool's output is read. Shared by every detector that runs a tool it does not know. */
export const outputSchema: z.ZodType<OutputFormat, z.ZodTypeDef, unknown> = z.union([
  z.enum(["json", "sarif", "checkstyle", "gitlab", "rdjson"]),
  z.object({ lines: z.union([z.enum(LINE_PRESETS), patternSchema]) }).strict(),
])

/**
 * Turns a tool's output into findings: the single owner of that, for `command` and `hook`.
 *
 * Output that is only whitespace is no findings in every format: a clean tool may print nothing.
 * Whether the tool failed is the exit code's question, not this one's.
 */
export function readOutput(format: OutputFormat, text: string, cwd: string): ToolFinding[] {
  const relative = repoRelativeTo(cwd)
  if (typeof format === "object") return readLines(format.lines, text, relative)
  if (text.trim() === "") return []
  switch (format) {
    case "json":
      return readJson(text, relative)
    case "sarif":
      return readSarif(text, relative)
    case "checkstyle":
      return readCheckstyle(text, relative)
    case "gitlab":
      return readGitlab(text, relative)
    case "rdjson":
      return readRdjson(text, relative)
  }
}
