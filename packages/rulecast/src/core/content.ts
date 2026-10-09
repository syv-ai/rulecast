import { readSourceFile } from "./detection/per-rule"
import { fileAtCommit, fileInIndex } from "./git"
import type { ContentSource } from "./types"

export const WORKTREE: ContentSource = { kind: "worktree" }

/**
 * How a run reads a file's current content, owned in one place.
 *
 * The baseline diff and the detectors must read the same thing: a change set computed against the
 * working tree and findings taken from the index would disagree about which lines are new. So the
 * pipeline builds one reader per run from here and hands it to both.
 */
export function contentReader(root: string, source: ContentSource): (file: string) => Promise<string | null> {
  switch (source.kind) {
    case "worktree":
      return (file) => readSourceFile(root, file)
    case "index":
      return (file) => fileInIndex(root, file)
    case "commit":
      return (file) => fileAtCommit(root, source.ref, file)
  }
}
