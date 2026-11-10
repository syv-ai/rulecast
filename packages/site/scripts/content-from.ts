import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { CONTENT_PATHS, REPO_ROOT } from "./sources"

/**
 * Replaces the site's content (CONTENT_PATHS) in the working tree with a release's, so a build
 * documents what that release installs. The site's own code is left as it is.
 *
 *   tsx scripts/content-from.ts latest     the newest vX.Y.Z tag
 *   tsx scripts/content-from.ts v0.6.0     that tag
 *   tsx scripts/content-from.ts main       main itself: a docs fix that cannot wait for a release
 *
 * It runs in CI only, on a fresh checkout. Locally it would overwrite README.md and agents/.
 */
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

/** Whether `ref` has `file`, a file or a directory. */
function has(ref: string, file: string): boolean {
  try {
    git("cat-file", "-e", `${ref}:${file}`)
    return true
  } catch {
    return false
  }
}

export function latestTag(): string {
  const tag = git("tag", "--list", "v*.*.*", "--sort=-v:refname").split("\n")[0]
  if (!tag) throw new Error("no vX.Y.Z tag in this checkout: fetch with tags (fetch-depth: 0)")
  return tag
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const requested = process.argv[2] ?? "latest"
  const ref = requested === "latest" ? latestTag() : requested
  // A path the release does not have yet (it came after it) keeps main's copy.
  const present = CONTENT_PATHS.filter((file) => has(ref, file))
  git("checkout", ref, "--", ...present)
  const missing = CONTENT_PATHS.filter((file) => !present.includes(file))
  process.stdout.write(`site content from ${ref}: ${present.join(", ")}\n`)
  if (missing.length > 0) process.stdout.write(`not in ${ref}, kept from main: ${missing.join(", ")}\n`)
}
