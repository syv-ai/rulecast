import { existsSync } from "node:fs"
import { chmod, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { stringify } from "yaml"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"
import { stateDirFor, TEST_HOME, testEnv } from "../helpers/home"
import { linkTool } from "../helpers/linters"
import { stubAgentCli } from "../helpers/llm"
import { createProject } from "../helpers/project"
import { createRuleRepo } from "../helpers/rule-repo"

/** doctor reads a real environment; nothing the machine happens to have installed may decide a test. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
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
    expect(result.stdout).toContain("mode       attended — default")
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
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain("ok       Claude Code — .claude/settings.json")
  })

  test("an install from before the Bash hooks names what is missing, and install fixes it", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
      "node_modules/.bin/rulecast": "#!/bin/sh\nexit 0\n",
    })
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

  test("hooks installed but pointing at a rulecast nothing can find are a warning", async () => {
    // How a repository that *is* rulecast looks: no node_modules/.bin/rulecast, nothing on the
    // PATH, hooks written into settings and silently doing nothing on every event.
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([RULE("a")]),
      "src/x.ts": "const x = 1\n",
    })
    expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
    const result = await doctor(root)
    expect(result.stdout).toContain("warning  Claude Code — .claude/settings.json")
    expect(result.stdout).toContain("so the hooks do nothing")
    // A warning, not an error: the installation is wrong, not broken beyond use.
    expect(result.code).toBe(0)
  })

  /** #29: what a fresh environment gets wrong, checked as the hooks and `rulecast run --from-ref` meet it. */
  describe("--ci", () => {
    const ci = (cwd: string, ...args: string[]) => runCli(cwd, ["doctor", "--ci", ...args])
    const ciLines = (stdout: string) => stdout.slice(stdout.indexOf("\nci\n"), stdout.indexOf("\ndry run\n"))

    test("a pinned repo the hooks would not find fails, though doctor's own compile fetched it", async () => {
      const repo = await createRuleRepo([{ tag: "v1.0.0", files: { ".rulecast-rules.yaml": MANIFEST } }])
      const root = await createRepo({
        ".rulecast-config.yaml": stringify({ repos: [{ repo, rev: "v1.0.0", rules: [{ id: "demo/no-print" }] }] }),
        "a.py": "x = 1\n",
      })
      const result = await ci(root)
      expect(result.stdout).toContain(".rulecast-config.yaml — 1 rule, 0 errors")
      expect(ciLines(result.stdout)).toContain(
        `error    ${repo}@v1.0.0 not in the cache — hooks never fetch, so 1 rule would not run; run rulecast install before the agent starts`,
      )
      expect(result.code).toBe(2)
      // Without --ci the same project is fine: the compile fetched it, and at a desk that is enough.
      expect((await doctor(root)).stdout).not.toContain("\nci\n")
      expect(ciLines((await ci(root)).stdout)).toContain("ok       rule repos cached")
    })

    test("hooks installed but unrunnable are an error, a warning without --ci", async () => {
      const root = await createRepo({ ".rulecast-config.yaml": localConfig([RULE("a")]), "src/x.ts": "const x = 1\n" })
      expect(await runCli(root, ["install"])).toMatchObject({ code: 0 })
      const result = await ci(root)
      expect(result.stdout).toContain("error    Claude Code — .claude/settings.json")
      expect(result.code).toBe(2)
      expect((await doctor(root)).stdout).toContain("warning  Claude Code — .claude/settings.json")
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
