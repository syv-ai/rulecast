import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { CONFIG_FILE } from "../core/config/load"
import { configRootsAbove } from "../core/projects"

/** Nearest ancestor of cwd containing .rulecast-config.yaml, or cwd itself (home rule: see configRootsAbove). */
export function findRoot(cwd: string, home: string = homedir()): string {
  return configRootsAbove(cwd, home)[0] ?? path.resolve(cwd)
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
