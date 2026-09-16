import { readFile } from "node:fs/promises"
import path from "node:path"
import { glob } from "tinyglobby"
import { parse } from "yaml"
import { z } from "zod"

import { errorMessage } from "../errors"
import { referenceInputSchema } from "../references"

export const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, "must be lowercase segments separated by /"),
    files: z.union([z.string(), z.array(z.string()).nonempty()]),
    ignore: z.array(z.string()).default([]),
    severity: z.enum(["error", "warning"]).default("error"),
    on: z.array(z.enum(["touch", "violation"])).nonempty().default(["violation"]),
    detect: z
      .record(z.unknown())
      .refine((value) => Object.keys(value).length === 1, "must name exactly one detector")
      .optional(),
    events: z.array(z.enum(["edit", "verify"])).nonempty().optional(),
    message: z.string().optional(),
    context: z.array(referenceInputSchema).default([]),
  })
  .strict()

export type RuleData = z.infer<typeof ruleSchema>

export type RuleFile = { source: string; ok: true; data: unknown } | { source: string; ok: false; message: string }

export async function loadRuleFiles(root: string, pattern: string): Promise<RuleFile[]> {
  const sources = (await glob([pattern], { cwd: root, dot: true })).sort()
  return Promise.all(
    sources.map(async (source): Promise<RuleFile> => {
      const text = await readFile(path.join(root, source), "utf8")
      try {
        return { source, ok: true, data: parse(text) }
      } catch (error) {
        return { source, ok: false, message: errorMessage(error) }
      }
    }),
  )
}
