import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export type Env = Readonly<Record<string, string | undefined>>

/** $RULECAST_HOME, else $XDG_CACHE_HOME/rulecast, else ~/.cache/rulecast. Empty values count as unset. */
export function cacheHome(env: Env): string {
  if (env.RULECAST_HOME) return path.resolve(env.RULECAST_HOME)
  if (env.XDG_CACHE_HOME) return path.join(path.resolve(env.XDG_CACHE_HOME), "rulecast")
  return path.join(homedir(), ".cache", "rulecast")
}

/**
 * <home>/projects/<first 16 hex of sha256(realpath(root))>. Keyed by the real path, so separate checkouts and
 * worktrees of one repository get separate directories and a symlinked path shares its target's.
 */
export function projectStateDir(home: string, root: string): string {
  const hash = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16)
  return path.join(home, "projects", hash)
}

/** Creates the project's state directory and its "root" file (the project path, for doctor and clean). */
export function ensureProjectState(home: string, root: string): string {
  const dir = projectStateDir(home, root)
  const file = path.join(dir, "root")
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `${realpathSync(root)}\n`)
  }
  return dir
}

/** Appends timestamped lines to <stateDir>/debug.log. Best effort: never throws. */
export function debugLogger(stateDir: string, now: () => Date = () => new Date()): (line: string) => void {
  const file = path.join(stateDir, "debug.log")
  return (line) => {
    try {
      appendFileSync(file, `${now().toISOString()} ${line}\n`)
    } catch {
      // A hook must not fail because its log could not be written.
    }
  }
}
