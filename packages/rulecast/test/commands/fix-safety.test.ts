import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { writeFixed } from "../../src/commands/fix"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"

const fix = (cwd: string, ...argv: string[]) => runCli(cwd, ["fix", ...argv])
const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")

const LOGGER = {
  id: "py/logger",
  name: "Logger",
  files: "\\.py$",
  detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)", fix: "log.info({{args}})" } },
  message: "{{file}}:{{line}} uses print. Use the logger.",
  examples: { bad: [{ path: "a.py", code: 'print("hi")\n', fixed: 'log.info("hi")\n' }] },
}

/** A regex rule `from` → `to`, proven on one example. */
const replace = (id: string, pattern: string, to: string, code: string, fixed: string) => ({
  id,
  name: id,
  files: "\\.py$",
  detect: { regex: { pattern, fix: to } },
  message: `{{file}}:{{line}} ${id}`,
  examples: { bad: [{ path: "a.py", code, fixed }] },
})

const repo = (rules: Record<string, unknown>[], files: Record<string, string>) =>
  createRepo({ ".rulecast-config.yaml": localConfig(rules), ...files })

describe("rulecast fix: what it will not write", () => {
  test("a symlinked file is never written through, inside the project or out of it", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "rulecast-outside-"))
    await writeFile(path.join(outside, "target.py"), 'print("outside")\n')
    await mkdir(path.join(outside, "dir"))
    await writeFile(path.join(outside, "dir", "x.py"), 'print("dir")\n')
    const root = await repo([LOGGER], { "real.py": 'print("real")\n', "keep.py": 'print("keep")\n' })
    await symlink(path.join(outside, "target.py"), path.join(root, "link.py"))
    await symlink("real.py", path.join(root, "inner.py"))
    await symlink(path.join(outside, "dir"), path.join(root, "sub"))
    await git(root, "add", "link.py", "inner.py")
    await git(root, "commit", "-q", "-m", "links")

    for (const dryRun of [["--dry-run"], []]) {
      const result = await fix(root, "--files", "link.py", "inner.py", "sub/x.py", "keep.py", ...dryRun)
      expect(result.stdout).toContain("link.py: a symlink; left unchanged")
      expect(result.stdout).toContain("inner.py: a symlink; left unchanged")
      expect(result.stdout).toContain("sub/x.py: outside the project; left unchanged")
      expect(result.stdout).toContain(`${dryRun.length > 0 ? "would fix" : "fixed"} 1 finding in 1 file`)
      expect(result.stdout).not.toContain("+++ b/link.py")
    }
    expect(await readFile(path.join(outside, "target.py"), "utf8")).toBe('print("outside")\n')
    expect(await readFile(path.join(outside, "dir", "x.py"), "utf8")).toBe('print("dir")\n')
    expect(await read(root, "real.py")).toBe('print("real")\n')
    expect(await read(root, "keep.py")).toBe('log.info("keep")\n')
  })

  test("a file that is not UTF-8 is left out of --dry-run's diff and count, as a real run leaves it", async () => {
    const root = await repo([LOGGER], { "ok.py": 'print("ok")\n' })
    await writeFile(
      path.join(root, "latin.py"),
      Buffer.from([...Buffer.from('print("caf'), 0xe9, ...Buffer.from('")\n')]),
    )
    const dry = await fix(root, "--all-files", "--dry-run")
    expect(dry.stdout).toContain("latin.py: not UTF-8; left unchanged")
    expect(dry.stdout).not.toContain("latin.py\n+++")
    expect(dry.stdout).toContain("would fix 1 finding in 1 file")
    const real = await fix(root, "--all-files")
    expect(real.stdout).toContain("latin.py: not UTF-8; left unchanged")
    expect(real.stdout).toContain("fixed 1 finding in 1 file")
    expect(dry.code).toBe(real.code)
  })

  test("a file that cannot be written is reported and the rest are still written", async () => {
    const root = await repo([LOGGER], { "ro/a.py": 'print("a")\n', "b.py": 'print("b")\n' })
    await chmod(path.join(root, "ro"), 0o555)
    try {
      const result = await fix(root, "--all-files", "--format", "json")
      expect(result.code).toBe(1)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.changedFiles).toEqual(["b.py"])
      expect(parsed.fixed.map((site: { file: string }) => site.file)).toEqual(["b.py"])
      expect(parsed.warnings).toEqual([expect.stringMatching(/^ro\/a\.py: could not write it \(.*\); left unchanged$/)])
      expect(await read(root, "ro/a.py")).toBe('print("a")\n')
      expect(await read(root, "b.py")).toBe('log.info("b")\n')
    } finally {
      await chmod(path.join(root, "ro"), 0o755)
    }
  })

  test("a file that changed after it was read is left alone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rulecast-write-"))
    await writeFile(path.join(root, "a.py"), "edited by someone else\n")
    expect(await writeFixed(root, "a.py", "before\n", "after\n")).toBe("a.py: changed while fixing; left unchanged")
    expect(await read(root, "a.py")).toBe("edited by someone else\n")
    expect(await writeFixed(root, "a.py", "edited by someone else\n", "after\n")).toBeNull()
    expect(await read(root, "a.py")).toBe("after\n")
  })

  test("fixes that never settle leave the file as it was and report its findings unresolved", async () => {
    const rules = [
      replace("py/ab", "aa", "bb", "aa\n", "bb\n"),
      replace("py/bc", "bb", "cc", "bb\n", "cc\n"),
      replace("py/ca", "cc", "aa", "cc\n", "aa\n"),
      LOGGER,
    ]
    const root = await repo(rules, { "cycle.py": "aa\n", "ok.py": 'print("a")\n' })
    for (const dryRun of [["--dry-run"], [], []]) {
      const result = await fix(root, "--all-files", "--format", "json", ...dryRun)
      expect(result.code).toBe(1)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.changedFiles).toEqual(dryRun.length > 0 || parsed.fixed.length > 0 ? ["ok.py"] : [])
      expect(parsed.fixed.every((site: { file: string }) => site.file === "ok.py")).toBe(true)
      expect(parsed.unresolved).toEqual([expect.objectContaining({ rule: "py/ab", file: "cycle.py", line: 1 })])
      expect(parsed.warnings).toContain(
        "fixes were still pending after 10 passes, so cycle.py was left unchanged: two rules' fixes may undo each other",
      )
      if (dryRun.length > 0) expect(parsed.diff).not.toContain("cycle.py")
      expect(await read(root, "cycle.py")).toBe("aa\n")
    }
    expect(await read(root, "ok.py")).toBe('log.info("a")\n')
  })

  test("a finding ignored before the fixes stays unfixed when another fix moves its ignore away", async () => {
    const blank = replace("py/blank", "(?<=\\S)\\n(?=print)", "\n\n", 'x = 1\nprint("a")\n', 'x = 1\n\nprint("a")\n')
    const source = 'x = 1\n# rulecast-ignore: py/logger keep this one\nprint("keep")\n'
    const root = await repo([LOGGER, blank], { "app.py": source })
    await fix(root, "--all-files")
    expect(await read(root, "app.py")).toBe('x = 1\n# rulecast-ignore: py/logger keep this one\n\nprint("keep")\n')
  })

  test("adjacent fixes whose results merge into a new match are applied, not reverted", async () => {
    const shorten = replace("py/shorten", "aa", "a", "aa\n", "a\n")
    const root = await repo([shorten], { "app.py": "aaaa\n" })
    const result = await fix(root, "--all-files", "--format", "json")
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).unresolved).toEqual([])
    expect(await read(root, "app.py")).toBe("a\n")
  })
})
