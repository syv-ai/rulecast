import { z } from "zod"

import { perRule, readSourceFile } from "../core/detection/per-rule"
import type { Detector, Match } from "../core/types"

const schema = z.object({}).strict()

export const pathDetector: Detector<z.infer<typeof schema>> = {
  kind: "path",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    const matches: Match[] = []
    for (const file of rule.files) {
      input.signal.throwIfAborted()
      const text = await readSourceFile(input.cwd, file)
      if (text === null) continue
      // The whole file, so any change in it counts as new (spec §8).
      matches.push({ file, line: 1, endLine: text.split(/\r?\n/).length, column: 1, text: file, captures: {} })
    }
    return matches
  }),
}
