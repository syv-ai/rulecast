import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * A directory reachable through a symlink, and its real path.
 *
 * The symlink is made here rather than relying on the platform's temp directory being one. On
 * macOS /tmp is a symlink to /private/tmp, so `mkdtemp(tmpdir())` happens to give a path whose
 * realpath differs; on Linux it does not, and a test written against the macOS behaviour fails
 * there for the wrong reason — which is exactly what CI found the first time it ran on Linux.
 */
export async function symlinkedDir(prefix: string): Promise<{ root: string; real: string }> {
  const base = await mkdtemp(path.join(tmpdir(), `${prefix}-`))
  await mkdir(path.join(base, "actual"), { recursive: true })
  const root = path.join(base, "linked")
  await symlink(path.join(base, "actual"), root)
  // Fully resolved, which is what a tool that calls realpath reports — on macOS that also
  // resolves /var to /private/var, and a half-resolved path would not match what the tool says.
  return { root, real: realpathSync(root) }
}
