import { z } from "zod"

import { perRule, readSourceFile } from "../core/detection/per-rule"
import { lineStarts, positionAt } from "../core/detection/positions"
import { errorMessage } from "../core/errors"
import type { Detector, Match } from "../core/types"

const schema = z
  .object({
    pattern: z.string().min(1),
    flags: z.string().regex(/^[dimsuvy]*$/, "allowed flags: d i m s u v y").default(""),
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

export const regexDetector: Detector<RegexConfig> = {
  kind: "regex",
  schema,
  captures: (config) => groupNames(config.pattern),
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    const names = groupNames(rule.config.pattern)
    const matches: Match[] = []
    for (const file of rule.files) {
      input.signal.throwIfAborted()
      const text = await readSourceFile(input.cwd, file)
      if (text === null) continue
      const starts = lineStarts(text)
      for (const found of text.matchAll(new RegExp(rule.config.pattern, `${rule.config.flags}g`))) {
        const start = found.index
        const end = start + found[0].length
        const from = positionAt(starts, start)
        const to = positionAt(starts, Math.max(start, end - 1))
        matches.push({
          file,
          line: from.line,
          endLine: to.line,
          column: from.column,
          text: found[0],
          captures: Object.fromEntries(names.map((name) => [name, found.groups?.[name] ?? ""])),
        })
      }
    }
    return matches
  }),
}
