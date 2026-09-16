import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export function stateDir(root: string): string {
  return path.join(root, ".rulecast", ".state")
}

/** Creates .rulecast/.state with a .gitignore that ignores everything in it. */
export function ensureStateDir(root: string): string {
  const dir = stateDir(root)
  const ignore = path.join(dir, ".gitignore")
  if (!existsSync(ignore)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(ignore, "*\n")
  }
  return dir
}

/** Appends timestamped lines to .rulecast/.state/debug.log. Best effort: never throws. */
export function debugLogger(root: string, now: () => Date = () => new Date()): (line: string) => void {
  const file = path.join(stateDir(root), "debug.log")
  return (line) => {
    try {
      appendFileSync(file, `${now().toISOString()} ${line}\n`)
    } catch {
      // A hook must not fail because its log could not be written.
    }
  }
}
