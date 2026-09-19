import path from "node:path"
import { z } from "zod"

import type { ReferenceMode } from "./types"

export const referenceInputSchema = z.union([
  z.string(),
  z.object({ path: z.string(), mode: z.enum(["inject", "read"]).optional() }).strict(),
])

export type ReferenceInput = z.infer<typeof referenceInputSchema>

/** Where "@" paths resolve: the project, or a rule repo checked out in the cache. */
export interface ReferenceRoot {
  /** Absolute directory. */
  dir: string
  /** null for the project; the rule repo label ("syv-ai/rulecast@v0.2.0") for a rule repo. */
  label: string | null
}

export interface ReferenceSpec {
  /** Identity and display. Project: "docs/api.md#errors". Rule repo: "syv-ai/rulecast@v0.2.0:docs/api.md#errors". */
  ref: string
  /** Project references: repo-relative with forward slashes. Rule repo references: absolute path in the cache. */
  path: string
  anchor: string | null
  mode: ReferenceMode
}

export class ReferenceSyntaxError extends Error {}

export function parseReference(input: ReferenceInput, defaultMode: ReferenceMode, root: ReferenceRoot): ReferenceSpec {
  const raw = typeof input === "string" ? input : input.path
  const mode = typeof input === "string" ? defaultMode : (input.mode ?? defaultMode)
  if (!raw.startsWith("@")) throw new ReferenceSyntaxError(`reference "${raw}" must start with "@"`)
  const body = raw.slice(1)
  const hash = body.indexOf("#")
  const file = hash === -1 ? body : body.slice(0, hash)
  const anchor = hash === -1 ? null : body.slice(hash + 1)
  if (!file) throw new ReferenceSyntaxError(`reference "${raw}" has no path`)
  if (anchor === "") throw new ReferenceSyntaxError(`reference "${raw}" has an empty anchor`)
  if (anchor !== null && !/\.mdx?$/.test(file)) {
    throw new ReferenceSyntaxError(`anchors are only supported in .md and .mdx files: "${raw}"`)
  }
  const relative = path.posix.normalize(file)
  if (path.posix.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) {
    throw new ReferenceSyntaxError(`reference "${raw}" leaves its root`)
  }
  const suffix = anchor === null ? "" : `#${anchor}`
  if (root.label === null) return { ref: `${relative}${suffix}`, path: relative, anchor, mode }
  return { ref: `${root.label}:${relative}${suffix}`, path: path.join(root.dir, relative), anchor, mode }
}
