import { existsSync } from "node:fs"
import path from "node:path"

/** Nearest ancestor of cwd containing .rulecast/, or cwd itself. */
export function findRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".rulecast"))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

export function hasProject(root: string): boolean {
  return existsSync(path.join(root, ".rulecast"))
}

/** A file as a repo-relative path with forward slashes, or null when it is not inside root. */
export function toProjectPath(root: string, cwd: string, file: string): string | null {
  const relative = path.relative(root, path.resolve(cwd, file))
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return relative.split(path.sep).join("/")
}
