import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { CONFIG_FILE } from "../core/config/load"

/**
 * Nearest ancestor of cwd containing .rulecast-config.yaml, or cwd itself. A config in the home
 * directory counts only from the home directory: below it, every repository without its own config
 * would otherwise become part of one project rooted at `~`.
 */
export function findRoot(cwd: string, home: string = homedir()): string {
  const start = path.resolve(cwd)
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, CONFIG_FILE)) && (dir !== path.resolve(home) || dir === start)) return dir
    if (path.dirname(dir) === dir) return start
  }
}

export function hasProject(root: string): boolean {
  return existsSync(path.join(root, CONFIG_FILE))
}

/** A file as a repo-relative path with forward slashes, or null when it is not inside root. */
export function toProjectPath(root: string, cwd: string, file: string): string | null {
  const relative = path.relative(root, path.resolve(cwd, file))
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return relative.split(path.sep).join("/")
}
