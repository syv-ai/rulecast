import { z } from "zod"

import type { ReferenceMode } from "./types"

export const referenceInputSchema = z.union([
  z.string(),
  z.object({ path: z.string(), mode: z.enum(["inject", "read"]).optional() }).strict(),
])

export type ReferenceInput = z.infer<typeof referenceInputSchema>

export interface ReferenceSpec {
  /** Path plus optional "#anchor", without "@". */
  ref: string
  path: string
  anchor: string | null
  mode: ReferenceMode
}

export class ReferenceSyntaxError extends Error {}

export function parseReference(input: ReferenceInput, defaultMode: ReferenceMode): ReferenceSpec {
  const raw = typeof input === "string" ? input : input.path
  const mode = typeof input === "string" ? defaultMode : (input.mode ?? defaultMode)
  if (!raw.startsWith("@")) throw new ReferenceSyntaxError(`reference "${raw}" must start with "@"`)
  const body = raw.slice(1)
  const hash = body.indexOf("#")
  const path = hash === -1 ? body : body.slice(0, hash)
  const anchor = hash === -1 ? null : body.slice(hash + 1)
  if (!path) throw new ReferenceSyntaxError(`reference "${raw}" has no path`)
  if (anchor === "") throw new ReferenceSyntaxError(`reference "${raw}" has an empty anchor`)
  if (anchor !== null && !/\.mdx?$/.test(path)) {
    throw new ReferenceSyntaxError(`anchors are only supported in .md and .mdx files: "${raw}"`)
  }
  return { ref: body, path, anchor, mode }
}
