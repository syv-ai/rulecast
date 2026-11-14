import { existsSync } from "node:fs"
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { stringify } from "yaml"

import { HOOK_COMMAND } from "../../src/adapters/claude-code/hook-script"
import { INSTALL_COMMAND, pinnedInstallCommand } from "../../src/core/binary-home"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"
import { stateDirFor, TEST_HOME, testEnv } from "../helpers/home"
import { linkTool } from "../helpers/linters"
import { stubAgentCli } from "../helpers/llm"
import {
  breakPathRulecast,
  type InstalledOnPath,
  LOOKUP_FIXTURES,
  lookupEnv,
  lookupSetup,
  type Place,
} from "../helpers/lookup"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

/** doctor reads a real environment; nothing the machine happens to have installed may decide a test. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  // The hooks' last resort is install.sh's rulecast under $HOME/.local/bin (core/binary-home.ts).
  vi.stubEnv("HOME", "/nonexistent-home")
  return () => vi.unstubAllEnvs()
})

const doctor = (cwd: string) => runCli(cwd, ["doctor"])

const MANIFEST = stringify([
  {
    id: "demo/no-print",
    name: "No print calls",
    files: "\\.py$",
    detect: { regex: { pattern: "print\\(" } },
    message: "{{file}}:{{line}} prints.",
  },
])

const RULE = (id: string) => ({
  id,
  name: id,
  files: "\\.ts$",
  detect: { regex: { pattern: "forbidden" } },
  message: "{{file}}:{{line}} is forbidden.",
})

describe("rulecast doctor", () => {
  test("reports the mode and where it came from", async () => {
    const mode = async (settings: Record<string, unknown>, env: Record<string, string> = {}) => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")], settings) })
      const result = await runCli(root, ["doctor"], "", { ...testEnv, ...env })
      return result.stdout.split("\n").find((text) => text.startsWith("mode "))
    }
    expect(await mode({})).toBe(
      "mode       attended — default (no RULECAST_MODE, mode or CI); up to 1 blocked stop per prompt",
    )
    expect(await mode({}, { RULECAST_MODE: "unattended" })).toBe(
      "mode       unattended — from RULECAST_MODE=unattended; up to 10 blocked stops per prompt",
    )
    expect(await mode({ mode: "unattended", unattended: { max_blocks: 4 } })).toBe(
      "mode       unattended — from mode: unattended in .rulecast-config.yaml; up to 4 blocked stops per prompt",
    )
    expect(await mode({ mode: "attended" }, { RULECAST_MODE: "unattended" })).toContain("from RULECAST_MODE=unattended")
    expect(await mode({}, { CI: "true" })).toBe(
      "mode       unattended — detected from CI=true; up to 10 blocked stops per prompt",
    )
  })

  test("an unknown RULECAST_MODE is a warning", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    const result = await runCli(root, ["doctor"], "", { ...testEnv, RULECAST_MODE: "headless" })
    expect(result.stdout).toContain("mode       attended — default (RULECAST_MODE ignored; no mode or CI)")
    expect(result.stdout).toContain(
      "  warning  RULECAST_MODE=headless is ignored — use attended, interactive or unattended",
    )
  })

  test("reports the project, a clean config and the cache paths, and exits 0", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a"), RULE("b")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain(`project    ${root}`)
    expect(result.stdout).toContain(".rulecast-config.yaml — 2 rules, 0 errors, 0 warnings")
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stdout).toContain(`project    ${stateDirFor(root)}`)
    expect(result.stdout).toContain("no problems found")
    expect(result.code).toBe(0)
  })

  test("creates the project's state directory, so the printed path is real", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    await doctor(root)
    expect(existsSync(path.join(stateDirFor(root), "root"))).toBe(true)
  })

  test("an error diagnostic is printed, counted and exits 2", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([{ ...RULE("a"), files: "[" }]),
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("error    .rulecast-config.yaml (a):")
    expect(result.stdout).toContain("invalid regex")
    expect(result.stdout).toContain("0 rules, 1 error, 0 warnings")
    // No rules compiled, so the dry run says so rather than printing a bare heading.
    expect(result.stdout).toContain("dry run\n  nothing to run\n")
    // The summary counts the config's error together with the hooks warning.
    expect(result.stdout).toContain("1 error, 1 warning")
    expect(result.code).toBe(2)
  })

  test("a warning is printed and counted but does not fail", async () => {
    // compile's one warning: a branch-like rev. The repo is a real local bare repository, so the
    // fetch succeeds and the warning is the only diagnostic.
    const repo = await createRuleRepo([{ tag: "main", files: { ".rulecast-rules.yaml": MANIFEST } }])
    const root = await createRepo({
      ".rulecast-config.yaml": stringify({
        repos: [{ repo, rev: "main", rules: [{ id: "demo/no-print" }] }],
      }),
      "src/x.ts": "const x = 1\n",
      "app.py": "value = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("looks like a branch")
    expect(result.stdout).toContain("ok       demo/no-print — tried app.py (1 of 1 matching file): no match")
    expect(result.stdout).toContain("1 rule, 0 errors, 1 warning")
    // The summary, not the config line: the config's warning plus the uninstalled hooks. Asserted
    // on the final line so it cannot be satisfied by the substring inside "0 errors, 1 warning".
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("0 errors, 2 warnings")
    expect(result.code).toBe(0)
  })

  test("the environment section reports each detector's own checks", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "lint",
          name: "Lint",
          files: "\\.ts$",
          detect: { linter: { tool: "oxlint" } },
          message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
        },
        {
          id: "shell",
          name: "Shell",
          files: "\\.ts$",
          detect: { command: { run: ["./check.sh", "{{files}}"] } },
          message: "{{file}}:{{line}} bad.",
        },
      ]),
      "src/x.ts": "const x = 1\n",
      "check.sh": "#!/bin/sh\necho '[]'\n",
    })
    await linkTool(root, "oxlint")
    await chmod(path.join(root, "check.sh"), 0o755)
    const result = await doctor(root)
    expect(result.stdout).toContain("environment\n")
    expect(result.stdout).toContain("ok       oxlint — node_modules/.bin/oxlint")
    expect(result.stdout).toContain(`ok       ./check.sh — ${path.join(root, "check.sh")}`)
  })

  describe("a linter installed only in a package", () => {
    const RUFF = {
      id: "lint",
      name: "Lint",
      files: "\\.py$",
      detect: { linter: { tool: "ruff" } },
      message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
    }
    async function stubRuff(dir: string) {
      const bin = path.join(dir, "node_modules", ".bin")
      await mkdir(bin, { recursive: true })
      await writeFile(path.join(bin, "ruff"), "#!/bin/sh\necho '[]'\n")
      await chmod(path.join(bin, "ruff"), 0o755)
    }

    test("is found from the package its files are linted from", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RUFF]),
        "backend/pyproject.toml": "[project]\nname = 'x'\n",
        "backend/app.py": "x = 1\n",
      })
      await stubRuff(path.join(root, "backend"))
      const result = await doctor(root)
      expect(result.stdout).toContain("ok       ruff — backend/node_modules/.bin/ruff")
    })

    test("missing where some of its files are linted from is an error naming those directories", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RUFF]),
        "backend/pyproject.toml": "[project]\nname = 'x'\n",
        "backend/app.py": "x = 1\n",
        "frontend/ruff.toml": "",
        "frontend/tool.py": "x = 1\n",
      })
      await stubRuff(path.join(root, "backend"))
      const result = await doctor(root)
      expect(result.stdout).toContain("error    ruff — not installed for frontend")
      expect(result.stdout).toContain("(lint)")
    })
  })

  test("a command that is not executable is an error naming its rule, and exits 2", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([
        {
          id: "shell",
          name: "Shell",
          files: "\\.ts$",
          detect: { command: { run: ["./check.sh"] } },
          message: "{{file}}:{{line}} bad.",
        },
      ]),
      "src/x.ts": "const x = 1\n",
      "check.sh": "#!/bin/sh\necho '[]'\n",
    })
    await chmod(path.join(root, "check.sh"), 0o644)
    const result = await doctor(root)
    expect(result.stdout).toContain("error    ./check.sh — not executable (shell)")
    expect(result.code).toBe(2)
  })

  test("more than three rules sharing a failure are truncated", async () => {
    const rules = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: id,
      files: "\\.ts$",
      detect: { command: { run: ["definitely-not-a-real-binary-9x7"] } },
      message: "{{file}}:{{line}} bad.",
    }))
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(rules),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("not installed (a, b, c and 2 more)")
  })

  test("a project with no hooks installed warns and still exits 0", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
    })
    const result = await doctor(root)
    expect(result.stdout).toContain("warning  Claude Code — not installed (run rulecast install)")
    expect(result.code).toBe(0)
  })

  test("installed hooks are reported with the file they are in", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      // The hook command resolves from here, which is what makes it ok rather than a warning.
      "node_modules/.bin/rulecast": "#!/bin/sh\necho 0.8.2\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain(
      "ok       Claude Code — .claude/settings.json — runs node_modules/.bin/rulecast 0.8.2\n",
    )
  })

  /** doctor with a stub rulecast in each of `places`, in a cache home and an install directory of its own. */
  async function doctorWith(
    places: Place[],
    settings: Record<string, unknown> = {},
    versions = {},
    installedOnPath?: InstalledOnPath,
    edit: (setup: ReturnType<typeof lookupSetup>) => void = () => {},
  ) {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")], settings), "src/x.ts": "" })
    const setup = lookupSetup(places, root, versions)
    edit(setup)
    const env = { RULECAST_HOME: setup.home, ...lookupEnv(setup, installedOnPath) }
    expect(await runCli(root, ["install"], "", env)).toMatchObject({ code: 0 })
    return { ...(await runCli(root, ["doctor"], "", env)), setup }
  }

  test.each(LOOKUP_FIXTURES)(
    "doctor names the rulecast the hooks run: $name",
    async ({ places, runs, installedOnPath, brokenPath }) => {
      const { stdout, setup } = await doctorWith(places, {}, {}, installedOnPath, (setup) => {
        if (brokenPath) breakPathRulecast(setup)
      })
      const label = {
        project: "node_modules/.bin/rulecast",
        path: `rulecast on the PATH (${setup.file.path})`,
        installed: installedOnPath
          ? `install.sh's rulecast at ${setup.file.installed}, on the PATH`
          : `install.sh's rulecast at ${setup.file.installed}, which is not on the PATH`,
      }[runs]
      expect(stdout).toContain(`ok       Claude Code — .claude/settings.json — runs ${label} 0.8.2\n`)
    },
  )

  test("a PATH rulecast that cannot run, ahead of install.sh's directory: install.sh's runs, and is on the PATH", async () => {
    const { stdout, setup } = await doctorWith(["path", "installed"], {}, {}, "after", breakPathRulecast)
    expect(stdout).toContain(
      `ok       Claude Code — .claude/settings.json — runs install.sh's rulecast at ${setup.file.installed}, on the PATH 0.8.2\n`,
    )
  })

  test("a PATH rulecast that cannot run on this machine is none: no rules run", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "" })
    const setup = lookupSetup(["path"], root)
    breakPathRulecast(setup)
    const env = { RULECAST_HOME: setup.home, PATH: `${setup.pathDir}:/usr/bin:/bin` }
    expect(await runCli(root, ["install"], "", env)).toMatchObject({ code: 0 })
    expect((await runCli(root, ["doctor"], "", env)).stdout).toContain("so no rules run")
  })

  describe("no rulecast can run and something else is wrong too", () => {
    /** Installed hooks, then `edit` to what they are on disk, with no rulecast anywhere it could run. */
    async function ciDoctor(edit: (root: string) => Promise<void>) {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "" })
      const setup = lookupSetup([], root)
      const env = {
        RULECAST_HOME: setup.home,
        RULECAST_INSTALL_DIR: setup.installDir,
        PATH: `${setup.pathDir}:/usr/bin:/bin`,
      }
      expect(await runCli(root, ["install"], "", env)).toMatchObject({ code: 0 })
      await edit(root)
      const { stdout } = await runCli(root, ["doctor", "--ci"], "", env)
      return { stdout, setup }
    }

    const CAN_NOT_RUN = (dir: string) =>
      `error    Claude Code — .claude/settings.json — but rulecast is not in node_modules/.bin, on the PATH or in ${dir}, so no rules run. ` +
      `Install rulecast: ${INSTALL_COMMAND}, or add it to the project (pnpm add -D @syv-ai/rulecast).`

    const setCommands = async (root: string, command: string) => {
      const settings = JSON.parse(await readFile(path.join(root, ".claude/settings.json"), "utf8"))
      for (const groups of Object.values(settings.hooks) as { hooks: { command: string }[] }[][]) {
        for (const group of groups) for (const hook of group.hooks) hook.command = command
      }
      await writeFile(path.join(root, ".claude/settings.json"), JSON.stringify(settings))
    }

    test("stale hooks: says nothing can run, then that the hooks are out of date", async () => {
      const { stdout, setup } = await ciDoctor((root) =>
        setCommands(root, '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'),
      )
      expect(stdout).toContain(
        `${CAN_NOT_RUN(setup.installDir)} Also: the hooks are out of date; run rulecast install.\n`,
      )
    })

    test("a script that differs: says nothing can run, then names the script", async () => {
      const { stdout, setup } = await ciDoctor((root) =>
        writeFile(path.join(root, ".claude/hooks/rulecast.sh"), "echo edited\n"),
      )
      expect(stdout).toContain(
        `${CAN_NOT_RUN(setup.installDir)} Also: .claude/hooks/rulecast.sh is out of date; run rulecast install.\n`,
      )
    })

    test("a missing script stays first, since every hook fails, and the missing rulecast is said too", async () => {
      const { stdout, setup } = await ciDoctor((root) => rm(path.join(root, ".claude/hooks/rulecast.sh")))
      expect(stdout).toContain(
        "error    Claude Code — .claude/settings.json — but .claude/hooks/rulecast.sh is missing, so every hook fails; run rulecast install. " +
          `And rulecast is not in node_modules/.bin, on the PATH or in ${setup.installDir}, so no rules run. ` +
          `Install rulecast: ${INSTALL_COMMAND}, or add it to the project (pnpm add -D @syv-ai/rulecast).\n`,
      )
    })

    test("nothing else wrong: only the message that nothing can run", async () => {
      const { stdout, setup } = await ciDoctor(async () => {})
      expect(stdout).toContain(`${CAN_NOT_RUN(setup.installDir)}\n`)
    })
  })

  test("a hook rulecast older than minimum_rulecast_version is a warning with the command that would update it", async () => {
    const { stdout, setup } = await doctorWith(["path"], { minimum_rulecast_version: "0.8.0" }, { path: "0.1.0" })
    const before = await readdir(setup.home, { recursive: true })
    expect(stdout).toContain(
      `warning  Claude Code — .claude/settings.json — runs rulecast on the PATH (${setup.file.path}) 0.1.0, ` +
        `older than minimum_rulecast_version 0.8.0; install a newer one: ${INSTALL_COMMAND}, or update the global npm install\n`,
    )
    // doctor says what to run, and runs nothing: the cache is as it was.
    expect(await readdir(setup.home, { recursive: true })).toEqual(before)
    // A minimum newer than this rulecast: the install command of that release.
    const newer = await doctorWith(["path"], { minimum_rulecast_version: "99.0.0" }, { path: "0.1.0" })
    expect(newer.stdout).toContain(
      `older than minimum_rulecast_version 99.0.0; install a newer one: ${pinnedInstallCommand("99.0.0")}, or update the global npm install\n`,
    )
    // install.sh's, off the PATH: the install command alone.
    const installed = await doctorWith(["installed"], { minimum_rulecast_version: "0.8.0" }, { installed: "0.1.0" })
    expect(installed.stdout).toContain(
      `older than minimum_rulecast_version 0.8.0; install a newer one: ${INSTALL_COMMAND}\n`,
    )
    // install.sh's, found on the PATH: still install.sh's, so the install command alone.
    const onPath = await doctorWith(
      ["installed"],
      { minimum_rulecast_version: "0.8.0" },
      { installed: "0.1.0" },
      "after",
    )
    expect(onPath.stdout).toContain(
      `runs install.sh's rulecast at ${onPath.setup.file.installed}, on the PATH 0.1.0, older than minimum_rulecast_version 0.8.0; ` +
        `install a newer one: ${INSTALL_COMMAND}\n`,
    )
    // A global npm install ahead of install.sh's directory on the PATH: install.sh would put a newer
    // one behind it, and the hooks would still run this one.
    const ahead = await doctorWith(
      ["path", "installed"],
      { minimum_rulecast_version: "0.8.0" },
      { path: "0.1.0", installed: "0.1.0" },
      "after",
    )
    expect(ahead.stdout).toContain(
      `runs rulecast on the PATH (${ahead.setup.file.path}) 0.1.0, older than minimum_rulecast_version 0.8.0; ` +
        `update the global npm install: npm install -g @syv-ai/rulecast. It comes before ${ahead.setup.installDir} on the PATH, so install.sh's would not run\n`,
    )
    // install.sh's directory first on the PATH, and empty: what install.sh puts there runs first.
    const behind = await doctorWith(["path"], { minimum_rulecast_version: "0.8.0" }, { path: "0.1.0" }, "before")
    expect(behind.stdout).toContain(
      `older than minimum_rulecast_version 0.8.0; install a newer one: ${INSTALL_COMMAND}, or update the global npm install\n`,
    )
    // A devDependency is updated where it came from.
    const local = await doctorWith(["project"], { minimum_rulecast_version: "0.8.0" }, { project: "0.1.0" })
    expect(local.stdout).toContain("older than minimum_rulecast_version 0.8.0; update @syv-ai/rulecast in package.json")
  })

  test("an install from before the Bash hooks names what is missing, and install fixes it", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const file = path.join(root, ".claude/settings.json")
    const settings = JSON.parse(await readFile(file, "utf8"))
    for (const event of ["PreToolUse", "PostToolUse"]) {
      settings.hooks[event] = settings.hooks[event].filter((group: { matcher: string }) => group.matcher !== "Bash")
    }
    delete settings.hooks.PostToolUseFailure
    await writeFile(file, JSON.stringify(settings))
    expect((await doctor(root)).stdout).toContain(
      "warning  Claude Code — .claude/settings.json — but hooks for Bash missing; run rulecast install",
    )
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    expect((await doctor(root)).stdout).toContain("ok       Claude Code — .claude/settings.json")
  })

  test("an old rulecast is named with the other problems, not only when there are none", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")], { minimum_rulecast_version: "0.8.0" }),
      "src/x.ts": "",
    })
    const setup = lookupSetup(["path"], root, { path: "0.1.0" })
    const env = { RULECAST_HOME: setup.home, ...lookupEnv(setup) }
    expect(await runCli(root, ["install"], "", env)).toMatchObject({ code: 0 })
    const file = path.join(root, ".claude/settings.json")
    const settings = JSON.parse(await readFile(file, "utf8"))
    settings.hooks.Stop[0].hooks[0].timeout = 1
    await writeFile(file, JSON.stringify(settings))
    expect((await runCli(root, ["doctor"], "", env)).stdout).toContain(
      "warning  Claude Code — .claude/settings.json — but the hooks are out of date; run rulecast install. " +
        `Also: it runs rulecast on the PATH (${setup.file.path}) 0.1.0, older than minimum_rulecast_version 0.8.0; ` +
        `install a newer one: ${INSTALL_COMMAND}, or update the global npm install\n`,
    )
  })

  test("a missing script fails only the hooks that run it, and other files are named outright", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    await rm(path.join(root, ".claude/hooks/rulecast.sh"))
    // The personal file still runs 0.10's inline command, which needs no script.
    const personal = JSON.parse(await readFile(path.join(root, ".claude/settings.json"), "utf8"))
    for (const groups of Object.values(personal.hooks) as { hooks: { command: string }[] }[][]) {
      for (const group of groups)
        for (const hook of group.hooks)
          hook.command = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    }
    await writeFile(path.join(root, ".claude/settings.local.json"), JSON.stringify(personal))
    expect((await doctor(root)).stdout).toContain(
      "error    Claude Code — .claude/settings.json — but .claude/hooks/rulecast.sh is missing, so every hook that runs it fails; " +
        "run rulecast install. Also: the hooks in .claude/settings.local.json are out of date\n",
    )
  })

  test("a settings file that is not JSON is reported on the hooks line, and the report goes on", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    await writeFile(path.join(root, ".claude/settings.local.json"), "{ not json")
    const result = await doctor(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(
      /warning {2}Claude Code — cannot read the hooks: \.claude\/settings\.local\.json: .+; fix it, then run rulecast install\n/,
    )
    expect(result.stdout).toContain("\ndry run\n")
  })

  test("hooks missing in one settings file and stale in another: both files are named", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const file = path.join(root, ".claude/settings.json")
    const settings = JSON.parse(await readFile(file, "utf8"))
    delete settings.hooks.PostToolUseFailure
    await writeFile(file, JSON.stringify(settings))
    const stop = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const personal = { hooks: { Stop: [{ hooks: [{ type: "command", command: stop, timeout: 70 }] }] } }
    await writeFile(path.join(root, ".claude/settings.local.json"), JSON.stringify(personal))
    expect((await doctor(root)).stdout).toContain(
      "warning  Claude Code — .claude/settings.json — but hooks for Bash missing, " +
        "and the hooks in .claude/settings.local.json are out of date; run rulecast install\n",
    )
    const install = await runCli(root, ["install"])
    expect(install.stdout).toContain("updated Claude Code hooks in .claude/settings.local.json: Stop\n")
    expect((await doctor(root)).stdout).toContain("ok       Claude Code — .claude/settings.json")
  })

  /** A project with rulecast in node_modules and the hooks installed, so only the hook files decide. */
  async function installed() {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\necho 0.8.2\n",
    })
    await chmod(path.join(root, "node_modules/.bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    return root
  }

  test("settings committed without the script is an error: every hook fails", async () => {
    const root = await installed()
    await rm(path.join(root, ".claude/hooks/rulecast.sh"))
    const result = await doctor(root)
    expect(result.stdout).toContain(
      "error    Claude Code — .claude/settings.json — but .claude/hooks/rulecast.sh is missing, so every hook fails; run rulecast install\n",
    )
    expect(result.code).toBe(2)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    expect((await doctor(root)).stdout).toContain("ok       Claude Code — .claude/settings.json — runs")
  })

  test("a script that differs from what install writes is a warning", async () => {
    const root = await installed()
    await writeFile(path.join(root, ".claude/hooks/rulecast.sh"), "#!/bin/sh\nexit 0\n")
    const result = await doctor(root)
    expect(result.stdout).toContain(
      "warning  Claude Code — .claude/settings.json — but .claude/hooks/rulecast.sh is out of date; run rulecast install\n",
    )
    expect(result.code).toBe(0)
  })

  test("0.10's settings and no script: the hooks are out of date, and nothing worse, even under --ci", async () => {
    const root = await installed()
    await rm(path.join(root, ".claude/hooks"), { recursive: true })
    const file = path.join(root, ".claude/settings.json")
    const older = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    const text = await readFile(file, "utf8")
    await writeFile(file, text.replaceAll(JSON.stringify(HOOK_COMMAND), JSON.stringify(older)))
    for (const args of [[], ["--ci"]]) {
      const result = await runCli(root, ["doctor", ...args])
      expect(result.stdout).toContain(
        "warning  Claude Code — .claude/settings.json — but the hooks are out of date; run rulecast install\n",
      )
      expect(result.stdout).not.toContain("rulecast.sh")
      expect(result.stdout).not.toMatch(/error {4}Claude Code/)
    }
  })

  test("hooks installed but pointing at a rulecast nothing can find are a warning", async () => {
    // How a repository that *is* rulecast looks: no node_modules/.bin/rulecast, nothing on the
    // PATH, hooks written into settings and silently doing nothing on every event.
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
    })
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    // The install directory is this machine's ~/.local/bin: the doctor here runs with the real HOME.
    expect(result.stdout).toMatch(
      /warning {2}Claude Code — \.claude\/settings\.json — but rulecast is not in node_modules\/\.bin, on the PATH or in \/.+\/\.local\/bin, so no rules run\. /,
    )
    expect(result.stdout).toContain(
      `Install rulecast: ${INSTALL_COMMAND}, or add it to the project (pnpm add -D @syv-ai/rulecast).\n`,
    )
    // A warning, not an error: the installation is wrong, not broken beyond use.
    expect(result.code).toBe(0)
  })

  test("a rulecast on the PATH runs the hooks, but npx's own temporary one does not", async () => {
    // The setup docs run `npx @syv-ai/rulecast doctor`, and npx puts its own bin on the PATH of what
    // it runs. The hooks never run under npx, so that rulecast is not one they will find (#1, plan 21).
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "npm-cache/_npx/0123abcd/node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
      "global/bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    await chmod(path.join(root, "npm-cache/_npx/0123abcd/node_modules/.bin/rulecast"), 0o755)
    await chmod(path.join(root, "global/bin/rulecast"), 0o755)
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const npx = { ...testEnv, PATH: `${path.join(root, "npm-cache/_npx/0123abcd/node_modules/.bin")}:/usr/bin:/bin` }
    expect((await runCli(root, ["doctor"], "", npx)).stdout).toContain("so no rules run")
    // bunx, yarn dlx, and the node_modules/.bin a runner such as pnpm exec puts first: the hook
    // looks only in the project's own node_modules, so none of them counts either.
    for (const bin of [
      "tmp/bunx-501-rulecast/node_modules/.bin",
      "tmp/xfs-1a2b/dlx-4242/node_modules/.bin",
      "node_modules/.bin",
    ]) {
      await mkdir(path.join(root, "elsewhere", bin), { recursive: true })
      await writeFile(path.join(root, "elsewhere", bin, "rulecast"), "#!/bin/sh\nexit 0\n")
      await chmod(path.join(root, "elsewhere", bin, "rulecast"), 0o755)
      const runner = { ...testEnv, PATH: `${path.join(root, "elsewhere", bin)}:/usr/bin:/bin` }
      expect((await runCli(root, ["doctor"], "", runner)).stdout, bin).toContain("so no rules run")
    }
    const global = { ...testEnv, PATH: `${path.join(root, "global/bin")}:/usr/bin:/bin` }
    expect((await runCli(root, ["doctor"], "", global)).stdout).toContain(
      "ok       Claude Code — .claude/settings.json",
    )
  })

  /** #29: what a fresh environment gets wrong, checked as the hooks and `rulecast run --from-ref` meet it. */
  describe("--ci", () => {
    const ci = (cwd: string, ...args: string[]) => runCli(cwd, ["doctor", "--ci", ...args])
    const ciLines = (stdout: string) => stdout.slice(stdout.indexOf("\nci\n"), stdout.indexOf("\ndry run\n"))

    test("a pinned repo the hooks would not find fails, and doctor does not fetch it, so a retry fails too", async () => {
      const repo = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": MANIFEST } }])
      const root = await createRepo({
        ".rulecast-config.yaml": stringify({ repos: [{ repo, rev: "v1.0.0", rules: [{ id: "demo/no-print" }] }] }),
        "a.py": "x = 1\n",
      })
      const missing = `error    ${repo}@v1.0.0 not in the cache — hooks never fetch, so 1 rule would not run; run rulecast install before the agent starts`
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await ci(root)
        expect(ciLines(result.stdout)).toContain(missing)
        expect(result.code).toBe(2)
      }
      expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
      const installed = await ci(root)
      expect(installed.stdout).toContain(".rulecast-config.yaml — 1 rule, 0 errors")
      expect(ciLines(installed.stdout)).toContain("ok       rule repos cached")
      // Without --ci doctor fetches what is missing: at a desk that is enough.
      expect((await doctor(root)).stdout).not.toContain("\nci\n")
    })

    test("hooks installed but unrunnable are an error, a warning without --ci", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "const x = 1\n" })
      expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
      const result = await ci(root)
      expect(result.stdout).toContain("error    Claude Code — .claude/settings.json")
      expect(result.code).toBe(2)
      expect((await doctor(root)).stdout).toContain("warning  Claude Code — .claude/settings.json")
    })

    test("a committed guard without node_modules runs a rulecast on the PATH; with neither, --ci fails", async () => {
      // A global install is what a project without a package.json has (plan 21).
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const x = 1\n",
        "node_modules/.bin/rulecast": "",
      })
      expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
      await rm(path.join(root, "node_modules"), { recursive: true })
      const bin = await createProject({ rulecast: "#!/bin/sh\n" })
      await chmod(path.join(bin, "rulecast"), 0o755)
      vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`)
      const global = await ci(root)
      expect(global.stdout).toContain(
        `ok       Claude Code — .claude/settings.json — runs rulecast on the PATH (${path.join(bin, "rulecast")})\n`,
      )
      vi.stubEnv("PATH", "/usr/bin:/bin")
      const neither = await ci(root)
      expect(neither.stdout).toMatch(/error {4}Claude Code — \.claude\/settings\.json — but rulecast is not in/)
      expect(neither.code).toBe(2)
    })

    test("hooks not installed at all stay a warning: a CI job may only run rulecast run", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "const x = 1\n" })
      const result = await ci(root)
      expect(result.stdout).toContain("warning  Claude Code — not installed")
      expect(result.code).toBe(0)
    })

    test("an attended mode under --ci is a warning", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "const x = 1\n" })
      const attended = ciLines(
        (await runCli(root, ["doctor", "--ci"], "", { ...testEnv, RULECAST_MODE: "attended" })).stdout,
      )
      expect(attended).toContain("warning  mode — attended — from RULECAST_MODE=attended")
      const unattended = ciLines((await runCli(root, ["doctor"], "", { ...testEnv, CI: "true" })).stdout)
      expect(unattended).toContain("ok       mode — unattended — detected from CI=true")
    })

    test("a shallow clone warns, and --from-ref a ref it cannot reach is an error naming fetch-depth", async () => {
      const origin = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const x = 1\n",
      })
      await writeFile(path.join(origin, "src/x.ts"), "const x = 2\n")
      await git(origin, "commit", "-q", "-am", "second")
      const root = path.join(await createProject({}), "clone")
      await git(path.dirname(root), "clone", "-q", "--depth", "1", `file://${origin}`, root)

      const shallow = await ci(root)
      expect(ciLines(shallow.stdout)).toContain(
        "warning  shallow clone — rulecast run --from-ref needs full history (actions/checkout: fetch-depth: 0)",
      )
      const unreachable = await ci(root, "--from-ref", "origin/elsewhere")
      expect(ciLines(unreachable.stdout)).toMatch(
        /error {4}rulecast run --from-ref origin\/elsewhere — .*fetch-depth: 0/,
      )
      expect(unreachable.code).toBe(2)

      expect(ciLines((await ci(origin, "--from-ref", "main")).stdout)).toContain("ok       merge base with main")
      expect(ciLines((await ci(origin)).stdout)).toContain("ok       full history")
    })

    test("CI in the environment implies it; without it there is no ci section", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "const x = 1\n" })
      expect((await runCli(root, ["doctor"], "", { ...testEnv, CI: "true" })).stdout).toContain("\nci\n")
      expect((await runCli(root, ["doctor"], "", { ...testEnv, CI: "false" })).stdout).not.toContain("\nci\n")
      expect((await runCli(root, ["doctor"], "", { ...testEnv, RULECAST_MODE: "unattended" })).stdout).not.toContain(
        "\nci\n",
      )
    })
  })

  describe("the dry run", () => {
    test("a rule that matches reports the file and the match count", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\nconst y = forbidden\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("dry run\n")
      expect(result.stdout).toContain("ok       a — tried src/x.ts (1 of 1 matching file): 2 matches")
      expect(result.code).toBe(0)
    })

    test("a rule that selects a file but matches nothing says no match", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const y = 1\n",
      })
      expect((await doctor(root)).stdout).toContain("ok       a — tried src/x.ts (1 of 1 matching file): no match")
    })

    test("one match is singular", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\n",
      })
      expect((await doctor(root)).stdout).toContain("ok       a — tried src/x.ts (1 of 1 matching file): 1 match")
    })

    test("says it tried one of the matching files, and how to check them all", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "a", name: "A", files: "\\.ts$", detect: { regex: { pattern: "print" } }, message: "m" },
        ]),
        "src/x.ts": "const x = 1\n",
        "src/y.ts": "print()\n",
        "src/z.ts": "print()\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("ok       a — tried src/x.ts (1 of 3 matching files): no match")
      expect(result.stdout).toContain("the dry run tries one file per rule; rulecast run --all-files checks them all")
    })

    test("a disabled rule says so and is not run", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "a", name: "A", files: "\\.ts$", enabled: false, detect: { regex: { pattern: "x" } }, message: "m" },
        ]),
        "src/x.ts": "const x = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("skipped  a — disabled")
      expect(result.stdout).not.toContain("tried")
    })

    test("a rule no file in the project matches is a warning, not a failure", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([{ ...RULE("a"), files: "^nowhere/" }]),
        "src/x.ts": "const forbidden = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("warning  a — no file in the project matches this rule")
      expect(result.code).toBe(0)
    })

    test("a rule whose detector fails is an error naming the rule, and exits 2", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "bad",
            name: "Bad",
            files: "\\.ts$",
            detect: { command: { run: ["./bad.sh", "{{files}}"] } },
            message: "{{file}}:{{line}} bad.",
          },
        ]),
        "src/x.ts": "const x = 1\n",
        "bad.sh": "#!/bin/sh\necho 'not json'\n",
      })
      await chmod(path.join(root, "bad.sh"), 0o755)
      const result = await doctor(root)
      expect(result.stdout).toMatch(/error {4}bad — /)
      // The dry run's error is counted alongside the hooks warning.
      expect(result.stdout).toContain("1 error, 1 warning")
      expect(result.code).toBe(2)
    })

    test("a touch rule has nothing to run", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "ctx", name: "Context", files: "\\.ts$", stages: ["touch"], context: ["@docs/x.md"] },
        ]),
        "docs/x.md": "# X\n",
        "src/x.ts": "const x = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toContain("ok       ctx — context only, nothing to run")
      expect(result.code).toBe(0)
    })

    test("touch context that fits in one message is ok", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "ctx", name: "Context", files: "\\.ts$", stages: ["touch"], context: ["@docs/x.md"] },
        ]),
        "docs/x.md": "# X\n",
        "src/x.ts": "const x = 1\n",
      })
      expect((await doctor(root)).stdout).toContain(
        "touch context\n  ok       every file's touch context fits in one message",
      )
    })

    test("touch rules whose context a file's first open cannot hold are a warning naming what is cut (#69)", async () => {
      const section = (name: string) => `## ${name}\n${"word ".repeat(700)}\n`
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "broad",
            name: "Broad",
            files: "\\.ts$",
            stages: ["touch"],
            context: ["@docs/a.md#one", "@docs/a.md#two", "@docs/a.md#three"],
          },
          { id: "narrow", name: "Narrow", files: "^src/run/", stages: ["touch"], context: ["@docs/a.md#four"] },
        ]),
        "docs/a.md": `# A\n${section("One")}${section("Two")}${section("Three")}${section("Four")}`,
        "src/run/x.ts": "const x = 1\n",
        "src/y.ts": "const y = 1\n",
      })
      const { stdout, code } = await doctor(root)
      const warning = stdout.split("\n").find((text) => text.includes("src/run/x.ts"))
      expect(warning).toMatch(/^ {2}warning {2}src\/run\/x\.ts — the first open sends the context of 2 touch rules/)
      // The narrow rule's section goes first, so what is cut is the broad rule's.
      expect(warning).toContain("docs/a.md#three would be named, not sent")
      expect(warning).not.toContain("#four")
      expect(warning).toContain("(broad, narrow)")
      expect(code).toBe(0)
    })

    test("touch context shares the message with other configs that send context for the same file, as the hook divides it (#69)", async () => {
      // Each section alone fits one message; the hook gives each config half of it.
      const section = `## One\n${"word ".repeat(1000)}\n`
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          { id: "root-ctx", name: "Root", files: "^pkg/", stages: ["touch"], context: ["@docs/a.md#one"] },
        ]),
        "docs/a.md": `# A\n${section}`,
        "pkg/.rulecast-config.yaml": localConfig([
          { id: "pkg-ctx", name: "Pkg", files: "\\.ts$", stages: ["touch"], context: ["@docs/b.md#one"] },
        ]),
        "pkg/docs/b.md": `# B\n${section}`,
        "pkg/x.ts": "const x = 1\n",
        "other/y.ts": "const y = 1\n",
      })
      const atRoot = (await doctor(root)).stdout
      expect(atRoot).toContain(
        "warning  pkg/x.ts — the first open sends the context of 1 touch rule, more than its share of one message holds: " +
          "pkg/.rulecast-config.yaml sends context for it too, and the message is divided among them: docs/a.md#one would be named, not sent",
      )
      const inPkg = (await doctor(path.join(root, "pkg"))).stdout
      expect(inPkg).toContain(
        "warning  x.ts — the first open sends the context of 1 touch rule, more than its share of one message holds: ",
      )
      expect(inPkg).toContain("../.rulecast-config.yaml sends context for it too")
    })

    test("--time runs each tool-backed rule over all its files against timeouts.verify_ms (#83)", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig(
          [
            {
              id: "quick",
              name: "Quick",
              files: "\\.ts$",
              detect: { command: { run: ["sh", "-c", "exit 0"] } },
              message: "{{message}}",
            },
            {
              id: "slow",
              name: "Slow",
              files: "\\.ts$",
              detect: { command: { run: ["sh", "-c", "sleep 2"] } },
              message: "{{message}}",
            },
            { id: "pattern", name: "Pattern", files: "\\.ts$", detect: { regex: { pattern: "x" } }, message: "m" },
          ],
          { timeouts: { verify_ms: 800 } },
        ),
        "src/a.ts": "const a = 1\n",
        "src/b.ts": "const b = 1\n",
      })
      const { stdout } = await runCli(root, ["doctor", "--time"])
      const timing = stdout.slice(stdout.indexOf("\ntiming\n"))
      expect(timing).toMatch(/ok {7}quick — \d+\.\d s of 0\.8 s on 2 files/)
      expect(timing).toContain(
        "warning  slow — over timeouts.verify_ms (0.8 s) on 2 files: a stop or rulecast run that hands it these files cuts it off. " +
          "Raise timeouts.verify_ms (then run rulecast install), or switch the rule off (enabled: false) and run the tool from a git hook or CI job of its own",
      )
      // An in-process detector takes milliseconds: not timed on its own.
      expect(timing).not.toMatch(/ {2}pattern — /)
      expect((await doctor(root)).stdout).not.toContain("\ntiming\n")
    })

    /** A lefthook the hook detector finds in node_modules/.bin, whose `dump` has these jobs. */
    async function lefthookRepo(
      jobs: Record<string, string>,
      rules: Record<string, unknown>[],
      settings: Record<string, unknown>,
      files: Record<string, string>,
    ): Promise<string> {
      const dump = JSON.stringify({
        "pre-commit": { jobs: Object.entries(jobs).map(([name, run]) => ({ name, run })) },
      })
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig(rules, settings),
        "lefthook.yml": "pre-commit:\n  jobs: []\n",
        "node_modules/.bin/lefthook": `#!/bin/sh\ncat <<'OUT'\n${dump}\nOUT\n`,
        ...files,
      })
      await chmod(path.join(root, "node_modules/.bin/lefthook"), 0o755)
      for (const file of Object.keys(files)) if (file.endsWith(".sh")) await chmod(path.join(root, file), 0o755)
      return root
    }

    const hookRule = (id: string, job: string) => ({
      id,
      name: id,
      files: "\\.py$",
      detect: { hook: { lefthook: `pre-commit/${job}` } },
      message: "{{message}}",
    })

    const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    test("a formatter hook past the deadline is ended with everything it started, and its files are put back (#83)", async () => {
      // The job's shell starts the formatter as a child of its own, which ending the shell alone left running.
      const root = await lefthookRepo(
        { fmt: "./fmt.sh {staged_files}" },
        [hookRule("fmt", "fmt")],
        { timeouts: { verify_ms: 700 } },
        {
          "fmt.sh": `#!/bin/sh\nsh -c 'sleep 1.5; for f in "$@"; do printf REFORMATTED > "$f"; done' _ "$@"\ntrue\n`,
          "a.py": "a = 1\n",
          "b.py": "b = 1\n",
        },
      )
      const { stdout } = await runCli(root, ["doctor", "--time"])
      expect(stdout).toContain("error    fmt — timed out after 700 ms")
      expect(stdout).toContain("warning  fmt — over timeouts.verify_ms (0.7 s) on 2 files")
      await settle(2000)
      expect(await readFile(path.join(root, "a.py"), "utf8")).toBe("a = 1\n")
      expect(await readFile(path.join(root, "b.py"), "utf8")).toBe("b = 1\n")
    })

    test("Ctrl-C during --time ends the tools, puts their files back and exits 130 (#83)", async () => {
      // Writes at once, then takes its time: interrupted while every file is rewritten.
      const root = await lefthookRepo(
        { fmt: "./fmt.sh {staged_files}" },
        [hookRule("fmt", "fmt")],
        { timeouts: { verify_ms: 20_000 } },
        {
          "fmt.sh": `#!/bin/sh\nfor f in "$@"; do printf REFORMATTED > "$f"; done\necho "$#" >> ran.log\nsleep 5\n`,
          "a.py": "a = 1\n",
          "b.py": "b = 1\n",
        },
      )
      const running = runCli(root, ["doctor", "--time"])
      // The dry run's one file, then --time's two: interrupted once the second run has started.
      const log = path.join(root, "ran.log")
      while (!(existsSync(log) && (await readFile(log, "utf8")).includes("2\n"))) await settle(50)
      process.emit("SIGINT", "SIGINT")
      const { code, stdout, stderr } = await running
      expect(code).toBe(130)
      expect(stderr).toContain("doctor interrupted")
      expect(stdout).not.toContain("touch context")
      expect(await readFile(path.join(root, "a.py"), "utf8")).toBe("a = 1\n")
      expect(await readFile(path.join(root, "b.py"), "utf8")).toBe("b = 1\n")
    }, 30_000)

    test("Ctrl-C during the run of all rules together stops it before the next hook starts (#83)", async () => {
      // Quick for the dry run's two calls and --time's two; the run of both together then takes its time.
      const job = `#!/bin/sh\necho "$0" >> calls.log\n[ "$(wc -l < calls.log)" -ge 5 ] && { touch together; sleep 8; }\ntrue\n`
      const root = await lefthookRepo(
        { one: "./job.sh", two: "./job.sh" },
        [hookRule("one", "one"), hookRule("two", "two")],
        { timeouts: { verify_ms: 30_000 } },
        { "job.sh": job, "a.py": "a = 1\n" },
      )
      const running = runCli(root, ["doctor", "--time"])
      while (!existsSync(path.join(root, "together"))) await settle(50)
      const interrupted = Date.now()
      process.emit("SIGINT", "SIGINT")
      const { code } = await running
      expect(code).toBe(130)
      expect(Date.now() - interrupted).toBeLessThan(3000)
      // The second hook never started.
      expect((await readFile(path.join(root, "calls.log"), "utf8")).trim().split("\n")).toHaveLength(5)
    }, 30_000)

    test("--time also runs every rule together, as a stop schedules them, against verify_ms (#83)", async () => {
      // Hooks run one at a time: each fits alone, the two together do not.
      const root = await lefthookRepo(
        { one: "sleep 1", two: "sleep 1" },
        [hookRule("one", "one"), hookRule("two", "two")],
        { timeouts: { verify_ms: 1500 } },
        { "a.py": "a = 1\n" },
      )
      const { stdout } = await runCli(root, ["doctor", "--time"])
      const timing = stdout.slice(stdout.indexOf("\ntiming\n"))
      expect(timing).toMatch(/ok {7}one — \d+\.\d s of 1\.5 s on 1 file/)
      expect(timing).toMatch(/ok {7}two — \d+\.\d s of 1\.5 s on 1 file/)
      expect(timing).toMatch(
        /warning {2}all 2 rules together — over timeouts\.verify_ms \(1\.5 s\) as a stop that changed every file runs them, on 1 file: (one, )?two would be cut off/,
      )
    }, 20_000)

    test("--time names a rule that fails over all its files as an error, and exits 2 (#83)", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "picky",
            name: "Picky",
            files: "\\.py$",
            // Fine on the dry run's one file; fails on more.
            detect: {
              command: { run: ["./picky.sh", "{{files}}"], output: { lines: "gcc" }, exit_codes: { error: [3] } },
            },
            message: "{{message}}",
          },
        ]),
        "picky.sh": `#!/bin/sh\n[ "$#" -gt 1 ] && { echo 'too many files' >&2; exit 3; }\nexit 0\n`,
        "a.py": "a = 1\n",
        "b.py": "b = 1\n",
      })
      await chmod(path.join(root, "picky.sh"), 0o755)
      const { stdout, code } = await runCli(root, ["doctor", "--time"])
      expect(stdout).toMatch(/ok {7}picky — tried a\.py/)
      expect(stdout).toMatch(/error {4}picky — \d+\.\d s, then failed: .*too many files/)
      expect(code).toBe(2)
    })

    test("--time does not time a rule that cannot run here: it is counted once, where it is found (#83)", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "gone",
            name: "Gone",
            files: "\\.py$",
            detect: { command: { run: ["no-such-tool-xyz", "{{files}}"] } },
            message: "{{message}}",
          },
        ]),
        "a.py": "a = 1\n",
      })
      const { stdout } = await runCli(root, ["doctor", "--time"])
      expect(stdout).toContain("skipped  gone — not timed: it cannot run here (see above)")
      expect(stdout).not.toContain("then failed")
      // The environment's error and the dry run's, with the uninstalled hooks' warning.
      expect(stdout).toContain("2 errors, 1 warning")
    })

    test("--time says why nothing was timed (#83)", async () => {
      const editOnly = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "edit-only",
            name: "Edit only",
            files: "\\.py$",
            stages: ["edit"],
            detect: { command: { run: ["sh", "-c", "exit 0"], output: { lines: "gcc" } } },
            message: "{{message}}",
          },
        ]),
        "a.py": "a = 1\n",
      })
      expect((await runCli(editOnly, ["doctor", "--time"])).stdout).toContain(
        "timing\n  ok       no rule runs a tool when an agent stops\n",
      )
      // Outside git the files cannot be listed: that is not "no rule runs a tool".
      const unlisted = await createProject({
        ".rulecast-config.yaml": localConfig([
          {
            id: "tool",
            name: "Tool",
            files: "\\.py$",
            detect: { command: { run: ["sh", "-c", "exit 0"], output: { lines: "gcc" } } },
            message: "{{message}}",
          },
        ]),
        "a.py": "a = 1\n",
      })
      expect((await runCli(unlisted, ["doctor", "--time"])).stdout).toContain(
        "timing\n  skipped  not timed — the project's files could not be listed (see the dry run)\n",
      )
    })

    test("a commit-msg rule is not dry-run on files: it says what runs it (#79)", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "no-trailer",
            name: "No trailer",
            stages: ["commit-msg"],
            detect: { regex: { pattern: "Co-Authored-By" } },
            message: "trailer",
          },
        ]),
        "a.py": "a = 1\n",
      })
      const { stdout, code } = await runCli(root, ["doctor", "--time"])
      expect(stdout).toContain("ok       no-trailer — judges commit messages: rulecast run --commit-msg FILE runs it")
      expect(stdout).not.toContain("tried")
      expect(stdout).toContain("timing\n  ok       no rule runs a tool when an agent stops\n")
      expect(code).toBe(0)
    })

    test("environment and dry-run errors are counted together", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "missing-tool",
            name: "Missing tool",
            files: "\\.ts$",
            detect: { command: { run: ["./absent.sh"] } },
            message: "{{file}}:{{line}} bad.",
          },
          {
            id: "bad-output",
            name: "Bad output",
            files: "\\.ts$",
            detect: { command: { run: ["./bad.sh", "{{files}}"] } },
            message: "{{file}}:{{line}} bad.",
          },
        ]),
        "src/x.ts": "const x = 1\n",
        "bad.sh": "#!/bin/sh\necho 'not json'\n",
      })
      await chmod(path.join(root, "bad.sh"), 0o755)
      const result = await doctor(root)
      // ./absent.sh fails the environment check and then its own dry run; ./bad.sh passes the
      // environment check and fails the dry run on its output. All three reach one summary.
      expect(result.stdout).toContain("error    ./absent.sh — no such file (missing-tool)")
      expect(result.stdout).toMatch(/error {4}missing-tool — /)
      expect(result.stdout).toMatch(/error {4}bad-output — /)
      expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("3 errors, 1 warning")
      expect(result.code).toBe(2)
    })

    test("a project that is not a git repository says so instead of throwing", async () => {
      const root = await createProject({
        ".rulecast-config.yaml": localConfig([RULE("a")]),
        "src/x.ts": "const forbidden = 1\n",
      })
      const result = await doctor(root)
      expect(result.stdout).toMatch(/warning {2}not run — /)
      expect(result.code).toBe(0)
    })

    test("an llm rule is skipped, and no model is called", async () => {
      const root = await createRepo({
        ".rulecast-config.yaml": localConfig([
          {
            id: "tone",
            name: "Tone",
            files: "\\.ts$",
            stages: ["verify"],
            detect: { llm: { model: "haiku", question: "is it rude?" } },
            message: "{{file}}:{{line}} {{reason}}",
          },
        ]),
        "src/x.ts": "const x = 1\n",
      })
      await stubAgentCli(root, "claude")
      const result = await doctor(root)
      // Was "(a model call costs money)" until plan 9 Task 7: doctor now asks the detector whether
      // it is metered instead of comparing the kind to "llm", so it can no longer say what kind of
      // call it is skipping.
      expect(result.stdout).toContain("skipped  tone — llm rules are not dry-run (each run costs money)")
      expect(await readdir(path.join(root, "claude.calls"))).toEqual([])
      expect(result.code).toBe(0)
    })
  })

  test("an unknown argument is a usage error", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]) })
    for (const args of [["--all-files"], ["extra"]]) {
      const result = await runCli(root, ["doctor", ...args])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("doctor:")
    }
  })

  test("with no config anywhere it says so and exits 2", async () => {
    const root = await createRepo({})
    const result = await doctor(root)
    expect(result.stdout).toContain(`home       ${TEST_HOME}`)
    expect(result.stderr).toContain("no .rulecast-config.yaml in")
    expect(result.stderr).toContain("run rulecast init")
    expect(result.code).toBe(2)
  })
})
