import { execFileSync } from "node:child_process"
import { appendFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CONTENT_PATHS, CONTENT_REF_ENV, REPO_ROOT } from "./sources"

/**
 * Replaces the site's content (CONTENT_PATHS) in the working tree with a release's, so a build
 * documents what that release installs. Each path is removed first and then checked out from the
 * release, so the content is exactly the release's: a file main has and the release does not is
 * gone, not served beside it, and a path the release does not have at all is not there. The ref it
 * resolved goes to the build in CONTENT_REF_ENV, for the site's links to GitHub: in CI through
 * $GITHUB_ENV, so only the steps after this one in that job see it; anywhere else it is printed, to
 * be passed by hand. It is never written to a file a later local run would read.
 *
 * What stays main's is the site's own code, packages/site, which a release cannot provide for main's
 * site: its components, its styles, and its two hand-written pages, the landing page and How it
 * works. Where main's code expects content an older release lacks, it copes: a page with no source
 * is left off (sources.ts, availablePages), the Commands page falls back to the release's README
 * table without recorded help, and no install.sh is served without one.
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
  git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`)
  for (const file of CONTENT_PATHS) rmSync(path.join(REPO_ROOT, file), { recursive: true, force: true })
  const present = CONTENT_PATHS.filter((file) => has(ref, file))
  git("checkout", ref, "--", ...present)
  const missing = CONTENT_PATHS.filter((file) => !present.includes(file))
  process.stdout.write(`site content from ${ref}: ${present.join(", ")}\n`)
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${CONTENT_REF_ENV}=${ref}\n`)
  else process.stdout.write(`build with ${CONTENT_REF_ENV}=${ref} for links to GitHub at ${ref}\n`)
  if (missing.length > 0) process.stdout.write(`not in ${ref}, so not on the site: ${missing.join(", ")}\n`)
}
