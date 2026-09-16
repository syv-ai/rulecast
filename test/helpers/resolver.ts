import { fnv1a } from "../../src/core/baseline/hash"
import type { ReferenceResolver } from "../../src/core/delivery/resolve"

/**
 * In-memory resolver. `files` maps "path" or "path#anchor" to content.
 * `children` maps "path#anchor" to the anchors it contains (besides itself).
 */
export function fakeResolver(
  files: Record<string, string>,
  children: Record<string, string[]> = {},
): ReferenceResolver {
  const key = (path: string, anchor: string | null) => (anchor === null ? path : `${path}#${anchor}`)
  return {
    async resolve(spec) {
      const content = files[key(spec.path, spec.anchor)]
      if (content === undefined) return { spec, found: false }
      return { spec, found: true, content, hash: fnv1a(content), bytes: Buffer.byteLength(content) }
    },
    async currentHash(path, anchor) {
      const content = files[key(path, anchor)]
      return content === undefined ? null : fnv1a(content)
    },
    async contains(path, parent, child) {
      if (parent === null) return true
      if (child === null) return false
      return parent === child || (children[`${path}#${parent}`] ?? []).includes(child)
    },
  }
}
