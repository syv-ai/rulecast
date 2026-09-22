import { readSourceFile } from "../../core/detection/per-rule"
import { errorMessage } from "../../core/errors"
import type { ChangeSet, Detector, DetectorResult, DetectorRuleInput, LlmSettings, Match } from "../../core/types"
import { askCached, callKey } from "./call"
import { resolveModel } from "./models"
import { buildPrompt, type PromptRule } from "./prompt"
import { providerByName } from "./providers/index"
import { type LlmFinding, type LlmProvider, LlmUnavailableError } from "./providers/types"
import { type LlmConfig, llmSchema } from "./schema"

/** One prompt: a file, a model, and every rule that asked about that file with that model. */
interface Call {
  file: string
  source: string
  changedLines: [number, number][] | null
  model: string
  rules: DetectorRuleInput<LlmConfig>[]
}

/** Reads each file of the run once. */
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

/**
 * Spec §6: files whose change set is empty are not sent; a file with no change set at all is
 * judged whole. The detector applies this itself rather than leaning on the pipeline, which only
 * filters empty change sets for session verifies — `run --from-ref` and the contract suite reach
 * the detector unfiltered.
 */
function changedLinesOf(changes: ReadonlyMap<string, ChangeSet>, file: string): [number, number][] | null | "skip" {
  const change = changes.get(file)
  if (change === undefined) return null
  return change.changedLines.length === 0 ? "skip" : change.changedLines
}

async function groupCalls(
  rules: DetectorRuleInput<LlmConfig>[],
  changes: ReadonlyMap<string, ChangeSet>,
  read: (file: string) => Promise<string | null>,
): Promise<Call[]> {
  const calls = new Map<string, Call>()
  for (const rule of rules) {
    for (const file of rule.files) {
      const changedLines = changedLinesOf(changes, file)
      if (changedLines === "skip") continue
      const source = await read(file)
      if (source === null) continue
      const key = `${file}\u0000${rule.config.model}`
      const call = calls.get(key)
      if (call) call.rules.push(rule)
      else calls.set(key, { file, source, changedLines, model: rule.config.model, rules: [rule] })
    }
  }
  return [...calls.values()]
}

function promptRules(rules: DetectorRuleInput<LlmConfig>[]): PromptRule[] {
  return rules.map((rule) => ({
    id: rule.id,
    question: rule.config.question,
    // Spec §6: the rule's resolved references, whatever their delivery mode.
    grounding: rule.config.grounding ? rule.context.map((ref) => ({ ref: ref.ref, content: ref.content })) : [],
  }))
}

/**
 * An answered finding becomes a match only when the file supports it. A model will occasionally
 * name a rule that was not in the call, a line past the end of the file, or a line it was told to
 * ignore; none of those is worth disabling a rule over, and an unknown rule id would become a
 * *whole-run* error in core/detection/run.ts, taking every llm rule down with it.
 */
function toFindings(call: Call, answered: LlmFinding[]): { rule: string; match: Match }[] {
  const lines = call.source.replace(/\n$/, "").split("\n")
  const ids = new Set(call.rules.map((rule) => rule.id))
  const findings: { rule: string; match: Match }[] = []
  for (const finding of answered) {
    if (!ids.has(finding.rule)) continue
    if (finding.line < 1 || finding.line > lines.length) continue
    if (call.changedLines !== null && !call.changedLines.some(([a, b]) => finding.line >= a && finding.line <= b)) {
      continue
    }
    findings.push({
      rule: finding.rule,
      match: {
        file: call.file,
        line: finding.line,
        endLine: finding.line,
        column: 1,
        // The file's own line, not the model's quote: {{text}} is the matched source everywhere else.
        text: lines[finding.line - 1]!,
        captures: { reason: finding.reason },
      },
    })
  }
  return findings
}

async function runCall(
  call: Call,
  provider: LlmProvider,
  settings: LlmSettings,
  input: Parameters<Detector<LlmConfig>["run"]>[0],
): Promise<{ rule: string; match: Match }[]> {
  const model = resolveModel(call.model, settings.provider)
  if (model === null) {
    throw new Error(
      `model "${call.model}" has no name for the ${settings.provider} provider; use that provider's own model name`,
    )
  }
  const rules = promptRules(call.rules)
  const key = callKey({
    file: call.file,
    source: call.source,
    changedLines: call.changedLines,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model,
    rules: call.rules.map((rule, index) => ({
      id: rule.id,
      config: rule.config,
      grounding: rules[index]!.grounding,
    })),
  })
  const answered = await askCached(provider, input.cache, key, {
    model,
    prompt: buildPrompt({ file: call.file, source: call.source, changedLines: call.changedLines, rules }),
    settings,
    env: process.env,
    cwd: input.cwd,
    signal: input.signal,
  })
  return toFindings(call, answered)
}

export const llmDetector: Detector<LlmConfig> = {
  kind: "llm",
  schema: llmSchema,
  captures: () => ["reason"],
  // verify only by default (spec §6): a model call is far too slow for an edit hook. A rule opts
  // in with `stages: [edit, verify]`.
  events: () => ["verify"],
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const settings = input.settings.llm

    let provider: LlmProvider
    try {
      provider = providerByName(settings.provider)
    } catch (error) {
      return { findings: [], errors: [{ rule: null, message: errorMessage(error) }] }
    }

    const calls = await groupCalls(input.rules, input.changes, sourceReader(input.cwd))
    const outcomes = await Promise.all(
      calls.map(async (call) => {
        try {
          return { call, findings: await runCall(call, provider, settings, input) }
        } catch (error) {
          if (input.signal.aborted) throw error
          return { call, error }
        }
      }),
    )

    for (const outcome of outcomes) {
      // Spec §14: no credentials, no binary — the run itself cannot proceed, so one warning
      // disables every llm rule rather than one per rule.
      if ("error" in outcome && outcome.error instanceof LlmUnavailableError) {
        return { findings: [], errors: [{ rule: null, message: outcome.error.message }] }
      }
    }
    for (const outcome of outcomes) {
      if ("error" in outcome) {
        const message = errorMessage(outcome.error)
        for (const rule of outcome.call.rules) result.errors.push({ rule: rule.id, message })
        continue
      }
      result.findings.push(...outcome.findings)
    }
    return result
  },
}
