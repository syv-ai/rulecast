import { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * A path an external tool reported, made repo-relative with forward slashes.
 *
 * Two things a tool does that naive relativisation gets wrong. SARIF requires `uri` to be
 * percent-encoded, so a `file://` URI has to be decoded rather than sliced. And resolving a path —
 * Python's `Path.resolve()`, eslint — follows symlinks, so a project under a symlinked root, which
 * is every macOS temp directory and plenty of real checkouts, comes back as a realpath that does
 * not sit under `cwd`. Either way the finding would be attributed to a path no rule selected and
 * silently dropped, so the realpath of the root is tried before giving up.
 *
 * `command` and `linter` each carried a byte-identical copy of the root-and-realpath half of this.
 *
 * A factory, because the realpath is a filesystem call: a tool that reports thousands of findings
 * resolves its root once, not once per finding.
 */
export function repoRelativeTo(cwd: string): (file: string) => string {
  const roots = rootsOf(cwd)
  return (file) => {
    const withoutScheme = file.startsWith("file://") ? fileURLToPath(file) : file
    if (!path.isAbsolute(withoutScheme)) return withoutScheme.split(path.sep).join("/")
    for (const root of roots) {
      const relative = path.relative(root, withoutScheme)
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative.split(path.sep).join("/")
    }
    return path.relative(cwd, withoutScheme).split(path.sep).join("/")
  }
}

/** One path; for many from the same tool, take `repoRelativeTo(cwd)` once. */
export function repoRelative(file: string, cwd: string): string {
  return repoRelativeTo(cwd)(file)
}

/** A root and its realpath, so repoRelative can try both. */
function rootsOf(root: string): string[] {
  try {
    const real = realpathSync(root)
    return real === root ? [root] : [root, real]
  } catch {
    return [root]
  }
}
