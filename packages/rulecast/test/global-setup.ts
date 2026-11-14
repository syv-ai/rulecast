import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * One temp directory per test run, removed when the run ends. Tests make hundreds of fixtures,
 * homes and repos with `mkdtemp(tmpdir())` and leave them; left in the shared temp directory they
 * pile up by the hundred thousand, and a tool that lists its project's parent (oxlint looking for
 * configs) then slows down for every fixture and for `pnpm perf`. Workers and the processes they
 * spawn inherit TMPDIR, so every `tmpdir()` lands in here. Made under the platform's own temp
 * directory, so a path still goes through macOS's /tmp → /private/tmp symlink as before.
 */
export default function setup(): () => void {
  const run = mkdtempSync(path.join(tmpdir(), "rulecast-tests-"))
  process.env.RULECAST_TEST_TMPDIR = run
  process.env.TMPDIR = run
  return () => rmSync(run, { recursive: true, force: true })
}
