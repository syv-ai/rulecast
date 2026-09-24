import { createContext, Script } from "node:vm"
import { z } from "zod"

import { lineStarts, positionAt } from "../core/detection/positions"
import { DeadlineError, errorMessage } from "../core/errors"
import type { Detector, DetectorResult } from "../core/types"

const schema = z
  .object({
    pattern: z.string().min(1),
    flags: z
      .string()
      .regex(/^[dimsuvy]*$/, "allowed flags: d i m s u v y")
      .default(""),
  })
  .strict()
  .superRefine((config, ctx) => {
    try {
      new RegExp(config.pattern, config.flags)
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: errorMessage(error) })
    }
  })

type RegexConfig = z.infer<typeof schema>

const NAMED_GROUP = /\(\?<([A-Za-z_$][\w$]*)>/g

function groupNames(pattern: string): string[] {
  return [...new Set([...pattern.matchAll(NAMED_GROUP)].map((match) => match[1]!))]
}

/**
 * Matching under a deadline V8 can actually enforce.
 *
 * A regex is matched synchronously, and a single `matchAll` over one file is one uninterruptible
 * call: `signal` cannot stop it, because the timer that would fire the signal only runs once the
 * event loop is free, and this is what keeps it busy. A pattern that backtracks exponentially —
 * `(a+)+$` over a run of `a`s — therefore blocked the edit hook and the `PreToolUse` guard with
 * nothing able to interrupt it, and the run was then reported as on time (§13).
 *
 * `vm.Script#runInContext` takes a `timeout`, and V8 interrupts a running regex for it. No sandbox
 * is being claimed — `vm` is not a security boundary and nothing here pretends otherwise; the
 * timeout is the only thing being borrowed.
 *
 * Nothing awaits between filling the scope and reading the result, so two files being matched
 * concurrently cannot interleave through it.
 */
interface MatchScope {
  text: string | null
  res: RegExp[] | null
  out: RegExpExecArray[][] | null
}

const SCOPE: MatchScope = { text: null, res: null, out: null }
const MATCH_CONTEXT = createContext(SCOPE)
const MATCH_SCRIPT = new Script("out = res.map((re) => [...text.matchAll(re)])", {
  filename: "rulecast-regex-match.js",
})

/**
 * Every rule's matches in one file, or `DeadlineError` if V8 had to interrupt the attempt.
 *
 * Every pattern for the file goes in one call because the timeout is the expensive part: it costs a
 * watchdog thread, ~54 µs, and a project with 500 rules over 200 files would otherwise pay it
 * 100,000 times — 5.4 seconds of pure overhead, which is more than the verify budget.
 *
 * The context and the compiled script are built once. Neither holds anything derived from a rule, a
 * project or an event beyond the call: the scope is cleared in `finally`, so a file's text is not
 * kept alive until the next event (§6 forbids the rest).
 */
function matchAllWithin(text: string, patterns: RegExp[], budgetMs: number): RegExpExecArray[][] {
  SCOPE.text = text
  SCOPE.res = patterns
  SCOPE.out = null
  try {
    MATCH_SCRIPT.runInContext(MATCH_CONTEXT, { timeout: Math.max(1, Math.trunc(budgetMs)) })
    return SCOPE.out ?? []
  } catch (error) {
    throw new DeadlineError(errorMessage(error))
  } finally {
    SCOPE.text = null
    SCOPE.res = null
    SCOPE.out = null
  }
}

export const regexDetector: Detector<RegexConfig> = {
  kind: "regex",
  schema,
  captures: (config) => groupNames(config.pattern),
  events: () => ["edit", "verify"],
  guards: true,
  /**
   * Driven by file rather than by rule, so one file is read once and scanned once however many
   * rules select it. `perRule` would read and match it once per rule — 100,000 reads for 500 rules
   * over 200 files — and there is nothing for `perRule` to isolate here: a pattern the schema
   * accepted cannot fail at run time, which is why the contract fixture has no failing case.
   */
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const names = new Map(input.rules.map((rule) => [rule.id, groupNames(rule.config.pattern)]))

    const byFile = new Map<string, typeof input.rules>()
    for (const rule of input.rules) {
      for (const file of rule.files) {
        const group = byFile.get(file)
        if (group === undefined) byFile.set(file, [rule])
        else group.push(rule)
      }
    }

    for (const [file, rules] of byFile) {
      input.signal.throwIfAborted()
      const text = await input.read(file)
      if (text === null) continue
      const starts = lineStarts(text)
      const patterns = rules.map((rule) => new RegExp(rule.config.pattern, `${rule.config.flags}g`))
      const perPattern = matchAllWithin(text, patterns, input.deadlineAt - Date.now())

      for (const [index, rule] of rules.entries()) {
        const captured = names.get(rule.id) ?? []
        for (const found of perPattern[index] ?? []) {
          const start = found.index
          const end = start + found[0].length
          const from = positionAt(starts, start)
          const to = positionAt(starts, Math.max(start, end - 1))
          result.findings.push({
            rule: rule.id,
            match: {
              file,
              line: from.line,
              endLine: to.line,
              column: from.column,
              text: found[0],
              captures: Object.fromEntries(captured.map((name) => [name, found.groups?.[name] ?? ""])),
            },
          })
        }
      }
    }
    return result
  },
}
