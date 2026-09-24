import { sectionContains, sectionRange, sectionText } from "../anchors"
import { fnv1a } from "../baseline/hash"
import { readSourceFile } from "../detection/per-rule"
import type { ReferenceSpec } from "../references"
import type { ResolvedReference } from "../types"

export type ResolvedRef =
  | { spec: ReferenceSpec; found: true; content: string; hash: number; bytes: number }
  | { spec: ReferenceSpec; found: false }

export interface ReferenceResolver {
  resolve(spec: ReferenceSpec): Promise<ResolvedRef>
  /** Hash of the current content of a path or section, null when it no longer exists. */
  currentHash(path: string, anchor: string | null): Promise<number | null>
  /** Whether content delivered as `parent` includes `child`. null means the whole file. */
  contains(path: string, parent: string | null, child: string | null): Promise<boolean>
}

/**
 * A rule's `context` specs, resolved to the references a detector run is given. Missing ones are
 * left out: a detector is handed what exists, and compile has already reported what does not.
 */
export async function resolveRuleContext(
  resolver: ReferenceResolver,
  context: readonly ReferenceSpec[],
): Promise<ResolvedReference[]> {
  const references: ResolvedReference[] = []
  for (const spec of context) {
    const resolved = await resolver.resolve(spec)
    if (resolved.found) references.push({ ref: spec.ref, content: resolved.content })
  }
  return references
}

/** Reads each file at most once; create one per event. */
export function createReferenceResolver(root: string): ReferenceResolver {
  const texts = new Map<string, Promise<string | null>>()
  const read = (path: string) => {
    let text = texts.get(path)
    if (!text) {
      text = readSourceFile(root, path)
      texts.set(path, text)
    }
    return text
  }

  const contentOf = async (path: string, anchor: string | null): Promise<string | null> => {
    const text = await read(path)
    if (text === null) return null
    if (anchor === null) return text.trimEnd()
    const section = sectionRange(text, anchor)
    return section ? sectionText(text, section) : null
  }

  return {
    async resolve(spec) {
      const content = await contentOf(spec.path, spec.anchor)
      if (content === null) return { spec, found: false }
      return { spec, found: true, content, hash: fnv1a(content), bytes: Buffer.byteLength(content) }
    },
    async currentHash(path, anchor) {
      const content = await contentOf(path, anchor)
      return content === null ? null : fnv1a(content)
    },
    async contains(path, parent, child) {
      if (parent === null) return true
      if (child === null) return false
      const text = await read(path)
      return text !== null && sectionContains(text, parent, child)
    },
  }
}
