import { execFile, execFileSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { beforeAll, describe, expect, test } from "vitest"

import { withoutInheritedGitEnv } from "../../src/core/git"
import { localConfig } from "../helpers/config"
import { git } from "../helpers/git"
import { createProject } from "../helpers/project"

const exec = promisify(execFile)

/**
 * The shipped `.pre-commit-hooks.yaml`, installed the way a team installs it: a real
 * `pre-commit install` in a scratch repository, real commits and real pushes to a bare remote.
 * Opt-in: it needs the `pre-commit` tool, which CI does not have.
 */
function hasPreCommit(): boolean {
  try {
    execFileSync("pre-commit", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const packageDir = fileURLToPath(new URL("../../", import.meta.url))
const repoRoot = path.resolve(packageDir, "../..")

const SERVICE = "app/services/users.py"
const OLD = "def get():\n    raise HTTPException(404)\n"

const RULE = {
  id: "backend/no-httpexception",
  name: "No HTTPException in services",
  files: "^app/services/.*\\.py$",
  detect: { regex: { pattern: "raise HTTPException" } },
  message: "{{file}}:{{line}} raises HTTPException",
}

interface Result {
  code: number
  output: string
}

describe.skipIf(!hasPreCommit())("the shipped pre-commit hooks", () => {
  let hookRepo: string
  let hookRev: string
  let preCommitHome: string

  beforeAll(async () => {
    // A hook repo holding only the shipped file, so the test needs neither the network nor this
    // repository's uncommitted state.
    hookRepo = await createProject({
      ".pre-commit-hooks.yaml": await readFile(path.join(repoRoot, ".pre-commit-hooks.yaml"), "utf8"),
    })
    await git(hookRepo, "init", "-q", "-b", "main")
    await git(hookRepo, "add", "-A")
    await git(hookRepo, "commit", "-q", "-m", "hooks")
    hookRev = await git(hookRepo, "rev-parse", "HEAD")
    preCommitHome = await mkdtemp(path.join(tmpdir(), "rulecast-pre-commit-home-"))
  })

  /** git with the repository's own hooks, which `git()` turns off. */
  async function hooked(cwd: string, ...args: string[]): Promise<Result> {
    const env = { ...withoutInheritedGitEnv(process.env), PRE_COMMIT_HOME: preCommitHome }
    try {
      const { stdout, stderr } = await exec(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args],
        { cwd, env },
      )
      return { code: 0, output: stdout + stderr }
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string }
      return { code: failed.code ?? 1, output: (failed.stdout ?? "") + (failed.stderr ?? "") }
    }
  }

  /** A project with rulecast "installed" (a bin that runs this source) and both hooks installed. */
  async function project(): Promise<{ root: string; remote: string }> {
    const root = await createProject({
      ".rulecast-config.yaml": localConfig([RULE]),
      ".pre-commit-config.yaml": [
        'minimum_pre_commit_version: "3.2.0"',
        "repos:",
        `  - repo: ${hookRepo}`,
        `    rev: ${hookRev}`,
        "    hooks:",
        "      - id: rulecast",
        "      - id: rulecast-push",
        "",
      ].join("\n"),
      ".gitignore": "node_modules/\n",
      "package.json": '{ "name": "scratch", "private": true }\n',
      [SERVICE]: OLD,
    })
    const bin = path.join(root, "node_modules/.bin/rulecast")
    await mkdir(path.dirname(bin), { recursive: true })
    const tsx = path.join(packageDir, "node_modules/.bin/tsx")
    await writeFile(bin, `#!/bin/sh\nexec "${tsx}" "${path.join(packageDir, "src/cli.ts")}" "$@"\n`)
    await chmod(bin, 0o755)

    const remote = await mkdtemp(path.join(tmpdir(), "rulecast-remote-"))
    await git(remote, "init", "-q", "--bare", "-b", "main")
    await git(root, "init", "-q", "-b", "main")
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "initial")
    await git(root, "remote", "add", "origin", remote)
    await git(root, "push", "-q", "origin", "main")
    const installed = await exec("pre-commit", ["install", "-t", "pre-commit", "-t", "pre-push"], {
      cwd: root,
      env: { ...withoutInheritedGitEnv(process.env), PRE_COMMIT_HOME: preCommitHome },
    })
    expect(installed.stdout).toContain("pre-push")
    return { root, remote }
  }

  const write = (root: string, file: string, text: string) => writeFile(path.join(root, file), text)

  test("a commit is judged as staged, against HEAD", { timeout: 120_000 }, async () => {
    const { root } = await project()

    // The review's H1: a docstring above an existing violation is not a new violation.
    await write(root, SERVICE, `def get():\n    """Get."""\n    raise HTTPException(404)\n`)
    await git(root, "add", SERVICE)
    const docstring = await hooked(root, "commit", "-q", "-m", "docstring")
    expect(docstring.output).not.toContain("raises HTTPException")
    expect(docstring.code).toBe(0)

    // A new violation fails the commit.
    await write(root, "app/services/orders.py", "def put():\n    raise HTTPException(409)\n")
    await git(root, "add", "app/services/orders.py")
    const added = await hooked(root, "commit", "-q", "-m", "orders")
    expect(added.code).not.toBe(0)
    expect(added.output).toContain("app/services/orders.py:2 raises HTTPException")

    // H2: staged, then fixed only in the working tree. What is committed is the staged version.
    await write(root, "app/services/orders.py", "def put():\n    raise Conflict()\n")
    const stagedOnly = await hooked(root, "commit", "-q", "-m", "orders")
    expect(stagedOnly.code).not.toBe(0)
  })

  test("a branch's first push judges only the branch's commits", { timeout: 120_000 }, async () => {
    const { root } = await project()
    await git(root, "checkout", "-q", "-b", "feature")
    await write(root, "app/services/clean.py", "def ok():\n    return 1\n")
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "clean")
    // No upstream yet; main's old violation is not the branch's.
    const clean = await hooked(root, "push", "-q", "-u", "origin", "feature")
    expect(clean.output).not.toContain("raises HTTPException")
    expect(clean.code).toBe(0)

    await git(root, "checkout", "-q", "-b", "feature-2", "main")
    await write(root, "app/services/bad.py", "def bad():\n    raise HTTPException(500)\n")
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "bad")
    const bad = await hooked(root, "push", "-q", "-u", "origin", "feature-2")
    expect(bad.code).not.toBe(0)
    expect(bad.output).toContain("app/services/bad.py:2 raises HTTPException")
  })

  test("a later push judges only the new commits", { timeout: 120_000 }, async () => {
    const { root } = await project()
    await git(root, "checkout", "-q", "-b", "feature")
    await write(root, "app/services/bad.py", "def bad():\n    raise HTTPException(500)\n")
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "bad")
    // Pushed past the hook: the violation is now on the remote.
    expect((await hooked(root, "push", "-q", "--no-verify", "-u", "origin", "feature")).code).toBe(0)

    await write(root, "app/services/clean.py", "def ok():\n    return 1\n")
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "clean")
    const later = await hooked(root, "push", "-q", "origin", "feature")
    expect(later.output).not.toContain("raises HTTPException")
    expect(later.code).toBe(0)
  })
})
