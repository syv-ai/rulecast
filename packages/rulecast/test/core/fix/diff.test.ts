import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { labelledDiff, unifiedDiff } from "../../../src/core/fix/diff"

/** Runs a command in `cwd` with `input` on stdin, without blocking the worker. */
function run(
  command: string,
  args: string[],
  cwd: string,
  input = "",
): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd })
    let out = ""
    child.stdout.on("data", (chunk) => {
      out += chunk
    })
    child.stderr.on("data", (chunk) => {
      out += chunk
    })
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, out }))
    child.stdin.end(input)
  })
}

/** A git repository holding `name` with "one\n", and the diff that makes it "two\n". */
async function project(name: string): Promise<{ dir: string; diff: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "rulecast-diff-"))
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
  writeFileSync(path.join(dir, name), "one\n")
  await run("git", ["init", "-q"], dir)
  return { dir, diff: unifiedDiff(name, "one\n", "two\n") }
}

// macOS's own patch: what `rulecast fix --dry-run | patch -p1` runs there.
const APPLE_PATCH = "/usr/bin/patch"
const hasApplePatch = process.platform === "darwin" && existsSync(APPLE_PATCH)

describe("unifiedDiff's file names", () => {
  test("an ordinary name is written as it is", () => {
    expect(unifiedDiff("src/x.ts", "a\n", "b\n")).toBe("--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n")
  })

  test.each(["å.ts", 'a"b.ts', "x/日本.ts", "a\\b.ts"])(
    "%s is not quoted, and applies with git apply",
    async (name) => {
      const { dir, diff } = await project(name)
      expect(diff.split("\n").slice(0, 2)).toEqual([`--- a/${name}`, `+++ b/${name}`])
      const git = await run("git", ["apply", "--check", "-"], dir, diff)
      expect(git.status, git.out).toBe(0)
    },
  )

  test.runIf(hasApplePatch).each(["å.ts", 'a"b.ts'])("%s applies with macOS's patch", async (name) => {
    const { dir, diff } = await project(name)
    const patched = await run(APPLE_PATCH, ["-p1"], dir, diff)
    expect(patched.status, patched.out).toBe(0)
    expect(readFileSync(path.join(dir, name), "utf8")).toBe("two\n")
  })

  test.each(["a\tb.ts", "a\nb.ts", "a\rb.ts"])(
    "%j, which ends a name unquoted, is quoted as git quotes it",
    async (name) => {
      const { dir, diff } = await project(name)
      expect(diff.startsWith('--- "a/a\\')).toBe(true)
      const git = await run("git", ["apply", "--check", "-"], dir, diff)
      expect(git.status, git.out).toBe(0)
    },
  )

  test("labels other than file names are written as they are", () => {
    expect(labelledDiff("expected", "got", "a\n", "b\n").split("\n").slice(0, 2)).toEqual(["--- expected", "+++ got"])
  })
})
