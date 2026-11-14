import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { GIT_HOOK_ARGS } from "../../scripts/sync-version"
import { GIT_HOOK_MISSING, gitHookCommand, probeRulecast } from "../../src/core/binary-home"
import { childEnv, markOwnEnv, unmarkOwnEnv } from "../../src/core/child-env"
import { git } from "../helpers/git"
import { breakPathRulecast, LOOKUP_FIXTURES, lookupEnv, lookupSetup } from "../helpers/lookup"
import { createProject } from "../helpers/project"

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))

const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

describe("probeRulecast", () => {
  test("a file the OS cannot execute is none, not a crash", async () => {
    const setup = lookupSetup(["path"], await createProject({}))
    expect(await probeRulecast(setup.file.path)).toEqual({ version: "0.8.2" })
    breakPathRulecast(setup)
    expect(await probeRulecast(setup.file.path)).toBeNull()
  })
})

describe("childEnv", () => {
  test("drops what rulecast set for itself, and keeps a value the user set", () => {
    markOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH", "/ours/napi.node")
    try {
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node", A: "1" })).toEqual({ A: "1" })
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node" })).toEqual({
        NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node",
      })
    } finally {
      unmarkOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH")
    }
    expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node" })).toEqual({
      NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node",
    })
  })
})

describe("gitHookCommand", () => {
  test(".pre-commit-hooks.yaml runs rulecast as the agent hooks find it", () => {
    const hooks = parse(readFileSync(path.join(repoRoot, ".pre-commit-hooks.yaml"), "utf8")) as {
      id: string
      entry: string
    }[]
    expect(Object.fromEntries(hooks.map((hook) => [hook.id, hook.entry]))).toEqual({
      rulecast: gitHookCommand("run"),
      "rulecast-push": gitHookCommand('run --from-ref "$PRE_COMMIT_FROM_REF" --to-ref "$PRE_COMMIT_TO_REF"'),
      "rulecast-commit-msg": gitHookCommand('run --commit-msg "$1"'),
    })
  })

  test("every pre-commit entry is verbose: a hook that finds no rulecast passes, and its warning must show (#84)", () => {
    const hooks = parse(readFileSync(path.join(repoRoot, ".pre-commit-hooks.yaml"), "utf8")) as { verbose?: boolean }[]
    expect(hooks.map((hook) => hook.verbose)).toEqual([true, true, true])
  })

  test.each(LOOKUP_FIXTURES)(
    "the git-hook resolver prefers the project's, then the PATH, then install.sh's: $name",
    async ({ places, runs, installedOnPath, brokenPath }) => {
      const root = await createProject({})
      const setup = lookupSetup(places, root)
      if (brokenPath) breakPathRulecast(setup)
      // pre-commit's entry is split like a shell would; the command is `sh -c <script> --`.
      const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
      const result = spawnSync("/bin/sh", ["-c", script, "--"], {
        cwd: root,
        env: lookupEnv(setup, installedOnPath, BASE_PATH),
        encoding: "utf8",
      })
      expect(result.stdout).toBe(`{"${runs}":true}\n`)
      expect(readFileSync(path.join(root, `ran-${runs}`), "utf8")).toBe("run\n")
    },
  )

  test.each([
    { name: "with no rulecast anywhere", places: [] as const, brokenPath: false },
    { name: "when the only rulecast cannot run", places: ["path"] as const, brokenPath: true },
  ])("the git hook warns and lets the commit through $name (#84)", async ({ places, brokenPath }) => {
    const root = await createProject({})
    const setup = lookupSetup([...places], root)
    if (brokenPath) breakPathRulecast(setup)
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const result = spawnSync("/bin/sh", ["-c", script, "--"], {
      cwd: root,
      env: lookupEnv(setup, undefined, BASE_PATH),
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    // A PATH rulecast that cannot run makes the shell say so first; the warning ends it either way.
    expect(result.stderr.endsWith(`${GIT_HOOK_MISSING}\n`)).toBe(true)
  })

  test("a project rulecast that cannot run (node missing from a GUI client's PATH) falls through, and then warns", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["project", "path"], root)
    writeFileSync(setup.file.project, '#!/bin/sh\nexec node-that-is-not-there "$0" "$@"\n')
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const run = () =>
      spawnSync("/bin/sh", ["-c", script, "--"], {
        cwd: root,
        env: lookupEnv(setup, undefined, BASE_PATH),
        encoding: "utf8",
      })
    const fallback = run()
    expect(fallback.stdout).toBe('{"path":true}\n')
    // One line says which rulecast could not run and which one runs instead.
    expect(fallback.stderr).toContain(
      `./node_modules/.bin/rulecast could not run (exit 127), so this hook runs ${setup.file.path} instead\n`,
    )
    writeFileSync(setup.file.path, "#!/bin/sh\nexit 127\n")
    const none = run()
    expect(none.status).toBe(0)
    expect(none.stderr.endsWith(`${GIT_HOOK_MISSING}\n`)).toBe(true)
  })

  test("a normal lookup says nothing on stderr: the fallback line is for a project rulecast that could not run", async () => {
    for (const places of [["project", "path"], ["path"]] as const) {
      const root = await createProject({})
      const setup = lookupSetup([...places], root)
      const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
      const result = spawnSync("/bin/sh", ["-c", script, "--"], {
        cwd: root,
        env: { ...lookupEnv(setup, undefined, BASE_PATH), skipped: "set by someone else" },
        encoding: "utf8",
      })
      expect(result.status).toBe(0)
      expect(result.stderr, places.join()).toBe("")
    }
  })

  test("a project rulecast that runs and finds something fails the hook with its own code", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["project", "path"], root)
    writeFileSync(setup.file.project, "#!/bin/sh\nexit 1\n")
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const result = spawnSync("/bin/sh", ["-c", script, "--"], {
      cwd: root,
      env: lookupEnv(setup, undefined, BASE_PATH),
      encoding: "utf8",
    })
    expect(result.status).toBe(1)
    expect(existsSync(path.join(root, "ran-path"))).toBe(false)
  })

  test("install.sh's rulecast that runs and finds something still fails the hook", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["installed"], root)
    writeFileSync(setup.file.installed, "#!/bin/sh\nexit 3\n")
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const result = spawnSync("/bin/sh", ["-c", script, "--"], {
      cwd: root,
      env: lookupEnv(setup, undefined, BASE_PATH),
      encoding: "utf8",
    })
    expect(result.status).toBe(3)
    expect(result.stderr).toBe("")
  })
})

describe("the commit-msg hook entries (#79)", () => {
  /**
   * In a linked worktree git passes the message file as an absolute path, which can hold a space.
   * lefthook and hk put it into the command as it is, unquoted (lefthook 2.1, hk 2.12).
   */
  test("pass a message path with a space whole: lefthook, hk and pre-commit, in a worktree", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "rulecast hooks "))
    const main = path.join(parent, "main repo")
    mkdirSync(main)
    await git(main, "init", "-q", "-b", "main")
    await git(main, "commit", "-q", "--allow-empty", "-m", "initial")
    const worktree = path.join(parent, "a worktree")
    await git(main, "worktree", "add", "-q", "-b", "wt", worktree)
    const messageFile = path.resolve(worktree, await git(worktree, "rev-parse", "--git-path", "COMMIT_EDITMSG"))
    expect(messageFile).toContain(" ")
    writeFileSync(messageFile, "fix\n")
    const judged = path.join(worktree, "judged")
    const stub = path.join(worktree, "node_modules", ".bin", "rulecast")
    mkdirSync(path.dirname(stub), { recursive: true })
    writeFileSync(stub, `#!/bin/sh\n[ "$#" = 3 ] && [ -f "$3" ] || exit 9\necho "$3" >> "${judged}"\n`)
    chmodSync(stub, 0o755)
    const env = { PATH: `${path.dirname(process.execPath)}:${BASE_PATH}`, HOME: parent }
    const sh = (args: string[]) => spawnSync("/bin/sh", args, { cwd: worktree, env, encoding: "utf8" })

    // pre-commit: the entry split as a shell would, with the message file appended.
    const preCommit = gitHookCommand(GIT_HOOK_ARGS.commitMsg).slice("sh -c '".length, -"' --".length)
    expect(sh(["-c", preCommit, "--", messageFile]).status).toBe(0)
    // hk: the placeholder replaced by the path, then run by a shell.
    const hk = gitHookCommand(GIT_HOOK_ARGS.hkCommitMsg).replaceAll("{{commit_msg_file}}", messageFile)
    expect(sh(["-c", hk]).status).toBe(0)
    // lefthook itself, as its commit-msg hook calls it.
    writeFileSync(
      path.join(worktree, "lefthook.yml"),
      `commit-msg:\n  jobs:\n    - name: rulecast\n      run: ${gitHookCommand(GIT_HOOK_ARGS.lefthookCommitMsg)}\n`,
    )
    const lefthook = spawnSync(
      path.join(repoRoot, "node_modules", ".bin", "lefthook"),
      ["run", "commit-msg", messageFile],
      {
        cwd: worktree,
        env: { ...env, NO_COLOR: "1" },
        encoding: "utf8",
      },
    )
    expect(lefthook.status, lefthook.stdout + lefthook.stderr).toBe(0)
    expect(readFileSync(judged, "utf8")).toBe(`${messageFile}\n`.repeat(3))
  })
})
