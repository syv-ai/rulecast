import { fileAtCommit } from "../git"
import type { RemovedDefinition } from "../types"

/**
 * A line that defines something, in the languages people write: `class X`, `def f`, `function f`,
 * `interface X`, `type X =`, `struct`, `enum`, `trait`, `fn`, `func`, `const X`. Leading `export`,
 * `pub`, `async`, `abstract` and decorators' targets are allowed. A heuristic: it only has to find
 * the names a model needs to tell a moved definition from a new one.
 */
const DEFINITION =
  /^\s*(?:export\s+(?:default\s+)?)?(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?(?:abstract\s+)?(?:class|def|function|interface|type|struct|enum|trait|fn|func|const|object|record|module)\s+[\w$]+/

/** More than this many lines would cost more than they tell: a change that removed that much is a rewrite. */
export const MAX_REMOVED_DEFINITIONS = 60

/**
 * The definitions `files` held at `commit` that they no longer hold: deleted files' all of them,
 * changed files' those whose line is no longer anywhere in the file (#72). Read from the commit,
 * since a session's snapshots keep line hashes, not text; a file new since then has none.
 */
export async function removedDefinitions(
  root: string,
  files: readonly string[],
  commit: string,
  read: (file: string) => Promise<string | null>,
): Promise<RemovedDefinition[]> {
  const removed: RemovedDefinition[] = []
  for (const file of [...files].sort()) {
    const before = await fileAtCommit(root, commit, file)
    if (before === null) continue
    const now = new Set(((await read(file)) ?? "").split("\n").map((line) => line.trim()))
    for (const line of before.split("\n")) {
      if (!DEFINITION.test(line) || now.has(line.trim())) continue
      removed.push({ file, line: line.trim() })
      if (removed.length === MAX_REMOVED_DEFINITIONS) return removed
    }
  }
  return removed
}
