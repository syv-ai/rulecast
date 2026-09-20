import { readSourceFile } from "../../core/detection/per-rule"
import { errorMessage } from "../../core/errors"
import type { Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import type { Language } from "./languages"
import { parserFor } from "./load"
import { type Metavariable, metavariables } from "./metavars"
import { type AstGrepConfig, astGrepSchema, captureNames, matcher } from "./schema"

// A node of the parsed tree. Typed structurally so this module never imports @ast-grep/napi for a
// value: the entry bundle must reach the native module only through load.ts's dynamic import.
interface Node {
  text(): string
  isNamed(): boolean
  range(): { start: { line: number; column: number }; end: { line: number; column: number } }
  getMatch(name: string): Node | null
  getMultipleMatches(name: string): Node[]
  findAll(matcher: unknown): Node[]
}

function capturesOf(node: Node, variables: Metavariable[]): Record<string, string> {
  const captures: Record<string, string> = {}
  for (const variable of variables) {
    captures[variable.name] = variable.multi
      ? node
          .getMultipleMatches(variable.name)
          // tree-sitter hands back the separators between the matched nodes too.
          .filter((match) => match.isNamed())
          .map((match) => match.text())
          .join(", ")
      : (node.getMatch(variable.name)?.text() ?? "")
  }
  return captures
}

function matchOf(file: string, node: Node, variables: Metavariable[]): Match {
  const range = node.range()
  return {
    file,
    line: range.start.line + 1,
    endLine: range.end.line + 1,
    column: range.start.column + 1,
    text: node.text(),
    captures: capturesOf(node, variables),
  }
}

export const astGrepDetector: Detector<AstGrepConfig> = {
  kind: "ast-grep",
  schema: astGrepSchema,
  captures: captureNames,
  events: () => ["edit", "verify"],
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const byLanguage = new Map<Language, DetectorRuleInput<AstGrepConfig>[]>()
    for (const rule of input.rules) {
      byLanguage.set(rule.config.language, [...(byLanguage.get(rule.config.language) ?? []), rule])
    }

    await Promise.all(
      [...byLanguage].map(async ([language, rules]) => {
        let parser: Awaited<ReturnType<typeof parserFor>>
        try {
          parser = await parserFor(language)
        } catch (error) {
          // The language is unusable, so every rule that names it is: one error each, never a
          // whole-run error, which would also disable the rules of the other languages.
          for (const rule of rules) result.errors.push({ rule: rule.id, message: errorMessage(error) })
          return
        }
        // Scanned once per rule, not once per matched node: the perf fixture has eight of these.
        const variables = new Map(rules.map((rule) => [rule.id, metavariables(matcher(rule.config))]))
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        for (const file of files) {
          input.signal.throwIfAborted()
          const source = await readSourceFile(input.cwd, file)
          if (source === null) continue
          const root = parser.parse(source).root() as unknown as Node
          for (const rule of rules) {
            if (!rule.files.includes(file)) continue
            try {
              for (const node of root.findAll(matcher(rule.config))) {
                result.findings.push({ rule: rule.id, match: matchOf(file, node, variables.get(rule.id)!) })
              }
            } catch (error) {
              if (input.signal.aborted) throw error
              if (!result.errors.some((existing) => existing.rule === rule.id)) {
                result.errors.push({ rule: rule.id, message: errorMessage(error) })
              }
            }
          }
        }
      }),
    )
    return result
  },
}
