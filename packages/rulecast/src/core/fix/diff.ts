import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff"

/** A unified diff of one file, with git's `a/` and `b/` headers; empty when nothing changed. */
export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return ""
  return labelledDiff(`a/${file}`, `b/${file}`, before, after)
}

/** A unified diff between two texts under the given names; for an expected and a produced result. */
export function labelledDiff(from: string, to: string, before: string, after: string): string {
  return createTwoFilesPatch(from, to, before, after, undefined, undefined, { headerOptions: FILE_HEADERS_ONLY })
}
