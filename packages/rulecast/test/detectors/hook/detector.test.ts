import { readFileSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { hookDetector } from "../../../src/detectors/hook/detector"
import type { HookConfig } from "../../../src/detectors/hook/schema"
import { createRepo } from "../../helpers/git"
import { createProject, fromDisk } from "../../helpers/project"

const payloads = fileURLToPath(new URL("../../payloads/hook/", import.meta.url))
const payload = (name: string) => readFileSync(payloads + name, "utf8")

/** Nothing the machine happens to have installed may decide these. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

const CONFIG = `repos:
  - repo: local
    hooks:
      - id: sc
        name: shellcheck
        entry: shellcheck -f gcc
        language: system
      - id: trailing-whitespace
        name: trim
        entry: trim
        language: system
      - id: licence
        name: licence
        entry: ./licence.sh
        language: system
      - id: push-only
        name: push only
        entry: ./push.sh
        language: system
        stages: [pre-push]
`

/** A stub runner in the project's node_modules/.bin: records each argv, runs `body`. */
async function stubRunner(root: string, name: string, body: string): Promise<void> {
  const bin = path.join(root, "node_modules", ".bin")
  await mkdir(bin, { recursive: true })
  const file = path.join(bin, name)
  await writeFile(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(root, `${name}.calls`)}"\n${body}\n`)
  await chmod(file, 0o755)
}

/** A runner that prints a recorded payload and exits as the real one did. */
const replay = (name: string, exitCode: number) =>
  `cat <<'OUT'\n${payload(name).replace(/\n$/, "")}\nOUT\nexit ${exitCode}`

const calls = async (root: string, name: string) =>
  (await readFile(path.join(root, `${name}.calls`), "utf8")).trim().split("\n")

const ruleFor = (id: string, config: unknown, files: string[]): DetectorRuleInput<HookConfig> => ({
  id,
  config: hookDetector.schema.parse(config),
  files,
  context: [],
})

const run = (cwd: string, rules: DetectorRuleInput<HookConfig>[]) =>
  hookDetector.run({
    event: "verify",
    rules,
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  })

const SCRIPT = "#!/bin/bash\nrm -rf $DIR/*\nfor f in $(ls *.txt); do echo $f; done\ncd foo\n"

describe("hook detector: pre-commit hooks", () => {
  test("runs the hook through prek on the rule's files and reads the tool's lines", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "s.sh": SCRIPT })
    await stubRunner(root, "prek", replay("prek.findings.txt", 1))
    const result = await run(root, [ruleFor("shell", { "pre-commit": "sc", output: { lines: "gcc" } }, ["s.sh"])])
    expect(result.errors).toEqual([])
    expect(await calls(root, "prek")).toEqual(["run sc --files s.sh"])
    expect(result.findings.map((f) => f.match.captures.ruleId)).toEqual([
      "SC2115",
      "SC2086",
      "SC2045",
      "SC2035",
      "SC2086",
      "SC2164",
    ])
    expect(result.findings[0]!.match).toMatchObject({ file: "s.sh", line: 2, column: 8 })
  })

  test("pre-commit when prek is not installed", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "s.sh": SCRIPT })
    await stubRunner(root, "pre-commit", replay("pre-commit.findings.txt", 1))
    const result = await run(root, [
      ruleFor("shell", { "pre-commit": "sc", output: { lines: "gcc" }, rules: ["SC2164"] }, ["s.sh"]),
    ])
    expect(await calls(root, "pre-commit")).toEqual(["run sc --files s.sh"])
    expect(result.findings.map((f) => f.match.captures.message)).toEqual([
      "Use 'cd ... || exit' or 'cd ... || return' in case cd fails.",
    ])
  })

  test("a hook that only runs at another stage is run at that stage", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\n" })
    await stubRunner(root, "prek", "echo 'push only....Passed'")
    await run(root, [ruleFor("p", { "pre-commit": "push-only" }, ["a.py"])])
    expect(await calls(root, "prek")).toEqual(["run push-only --hook-stage pre-push --files a.py"])
  })

  test("rules naming the same hook share one run", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "s.sh": SCRIPT, "t.sh": "x\n" })
    await stubRunner(root, "prek", replay("prek.findings.txt", 1))
    const result = await run(root, [
      ruleFor("a", { "pre-commit": "sc", rules: ["SC2115"] }, ["s.sh"]),
      ruleFor("b", { "pre-commit": "sc", rules: ["SC2045"] }, ["s.sh", "t.sh"]),
    ])
    expect(await calls(root, "prek")).toEqual(["run sc --files s.sh t.sh"])
    expect(result.findings.map((f) => [f.rule, f.match.captures.ruleId])).toEqual([
      ["a", "SC2115"],
      ["b", "SC2045"],
    ])
  })

  test("a hook id the config does not declare is a rule error, and nothing runs", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\n" })
    await stubRunner(root, "prek", "exit 0")
    const result = await run(root, [ruleFor("r", { "pre-commit": "mypy" }, ["a.py"])])
    expect(result.errors).toEqual([{ rule: "r", message: 'no hook with id "mypy" in .pre-commit-config.yaml' }])
  })

  test("a runner that never ran the hook is a rule error carrying what it said", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "s.sh": SCRIPT })
    await stubRunner(root, "prek", replay("prek.unknown.txt", 1))
    const result = await run(root, [ruleFor("r", { "pre-commit": "sc" }, ["s.sh"])])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(/^prek exited 1: warning: selector `nope` did not match/)
  })

  test("a hook that changes a file: the file is restored and the change is the finding", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "t.txt": "hello   \nworld\n" })
    await stubRunner(root, "prek", `printf 'hello\\nworld\\n' > t.txt\n${replay("prek.modified.txt", 1)}`)
    const result = await run(root, [ruleFor("trim", { "pre-commit": "trailing-whitespace" }, ["t.txt"])])
    expect(await readFile(path.join(root, "t.txt"), "utf8")).toBe("hello   \nworld\n")
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "trim",
        match: {
          file: "t.txt",
          line: 1,
          // The whole file: any edit to it makes the finding the agent's, as for the path detector.
          endLine: 3,
          column: 1,
          text: "",
          captures: {
            message: "trailing-whitespace would change this file",
            ruleId: "trailing-whitespace",
            severity: "error",
          },
          // Said explicitly, so its id hashes the finding and not the file (core/finding-id.ts).
          wholeFile: true,
        },
      },
    ])
  })

  /** A prek stub whose hook failed with `exit` and printed `lines`, indented as prek does. */
  const failing = (lines: string[], exit = 1) =>
    `printf '%s\\n' 'licence....Failed' '- hook id: licence' '- exit code: ${exit}' '' ${lines
      .map((line) => `'  ${line.replaceAll("'", "'\\''")}'`)
      .join(" ")}\nexit 1`

  test("a hook whose output no format reads is a finding at the line it names, in a file it was given", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\ny\n", "b.py": "y\n" })
    await stubRunner(root, "prek", failing(["error[bad-licence]: missing licence header", " --> a.py:2:1"]))
    const result = await run(root, [ruleFor("licence", { "pre-commit": "licence" }, ["a.py", "b.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => [f.match.file, f.match.line, f.match.captures.message])).toEqual([
      ["a.py", 2, "licence failed: error[bad-licence]: missing licence header\n --> a.py:2:1"],
    ])
  })

  // An always_run, whole-project hook failed over a file nobody staged: it was pinned to the first
  // staged file (.claude/hooks/rulecast.sh:1:1).
  test("a hook that fails over files it was not given is never pinned to one it was given", async () => {
    const root = await createProject({
      ".pre-commit-config.yaml": CONFIG,
      ".claude/hooks/rulecast.sh": "#!/bin/sh\n",
      "backend/app/api/deps/user.py": "x\n",
    })
    await stubRunner(
      root,
      "prek",
      failing([
        "warning[unused-ignore-comment]: Unused blanket `type: ignore` directive",
        " --> backend/app/api/deps/user.py:93:5",
      ]),
    )
    const result = await run(root, [ruleFor("ty", { "pre-commit": "licence" }, [".claude/hooks/rulecast.sh"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toEqual([
      {
        rule: "ty",
        message:
          "licence failed over files this run did not give it (backend/app/api/deps/user.py:93), not over its own: warning[unused-ignore-comment]: Unused blanket `type: ignore` directive\n --> backend/app/api/deps/user.py:93:5",
      },
    ])
  })

  test("a gcc-style line about a file it was not given is not pinned either", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\n", "b.py": "y\n" })
    await stubRunner(root, "prek", failing(["b.py:3:1: error: imported module is broken"]))
    const result = await run(root, [ruleFor("licence", { "pre-commit": "licence" }, ["a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors.map((error) => error.message)).toEqual([
      "licence failed over files this run did not give it (b.py:3), not over its own: b.py:3:1: error: imported module is broken",
    ])
  })

  test("a hook given exactly one file that fails naming no file is a finding on that file", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\n" })
    await stubRunner(root, "prek", failing(["missing licence header"]))
    const result = await run(root, [ruleFor("licence", { "pre-commit": "licence" }, ["a.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => [f.match.file, f.match.line, f.match.captures.message])).toEqual([
      ["a.py", 1, "licence failed: missing licence header"],
    ])
  })

  test.each([
    ["several files", CONFIG, ["a.py", "b.py"]],
    ["always_run", CONFIG.replace("entry: ./licence.sh", "entry: ./licence.sh\n        always_run: true"), ["a.py"]],
    [
      "pass_filenames: false",
      CONFIG.replace("entry: ./licence.sh", "entry: ./licence.sh\n        pass_filenames: false"),
      ["a.py"],
    ],
  ])(
    "a hook that fails naming no file, given %s, says its output is about the project",
    async (_name, config, files) => {
      const root = await createProject({ ".pre-commit-config.yaml": config, "a.py": "x\n", "b.py": "y\n" })
      await stubRunner(root, "prek", failing(["Found 3 errors in 2 files"]))
      const result = await run(root, [ruleFor("licence", { "pre-commit": "licence" }, files)])
      expect(result.findings).toEqual([])
      expect(result.errors).toEqual([
        {
          rule: "licence",
          message:
            "licence failed and named no file, so this is its output about the project: Found 3 errors in 2 files",
        },
      ])
    },
  )

  // A tool that could not start is not a finding: `uv run mypy` with a stale venv was reported as
  // "mypy-check failed" on DECISIONS.md:1:1.
  test.each([
    ["uv's", ["error: Failed to spawn: `mypy`", "  Caused by: No such file or directory (os error 2)"], 2],
    ["pre-commit's", ["Executable `mypy` not found"], 1],
    ["the shell's", ["/bin/sh: mypy: command not found"], 127],
    [
      "a stale shebang's",
      ["/bin/sh: .venv/bin/mypy: /old/venv/bin/python: bad interpreter: No such file or directory"],
      126,
    ],
    ["an exit 127", ["something went wrong"], 127],
  ])("a hook whose tool could not run is a rule error, not a finding: %s", async (_name, lines, exit) => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "DECISIONS.md": "# d\n" })
    await stubRunner(root, "prek", failing(lines, exit))
    const result = await run(root, [ruleFor("mypy", { "pre-commit": "licence" }, ["DECISIONS.md"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toEqual([
      { rule: "mypy", message: `licence could not run, so it checked nothing: ${lines.join("\n")}` },
    ])
  })

  test.each([
    ["with its files", "./lint.sh {staged_files}", "finding"],
    ["without them", "./lint.sh", "error"],
  ])("a lefthook job run %s on one file that fails naming no file", async (_name, command, kind) => {
    const root = await createProject({ "a.ts": "x\n" })
    const dump = JSON.stringify({ "pre-commit": { jobs: [{ name: "lint", run: command }] } })
    await stubRunner(root, "lefthook", `cat <<'OUT'\n${dump}\nOUT`)
    await writeFile(path.join(root, "lint.sh"), "#!/bin/sh\necho 'lint failed'\nexit 1\n")
    await chmod(path.join(root, "lint.sh"), 0o755)
    const result = await run(root, [ruleFor("lint", { lefthook: "pre-commit/lint" }, ["a.ts"])])
    expect([result.findings.length, result.errors.length]).toEqual(kind === "finding" ? [1, 0] : [0, 1])
  })

  test("a lefthook job whose command is not installed could not run", async () => {
    const root = await createProject({ "a.ts": "x\n" })
    const dump = JSON.stringify({
      "pre-commit": { jobs: [{ name: "lint", run: "rulecast-no-such-tool {staged_files}" }] },
    })
    await stubRunner(root, "lefthook", `cat <<'OUT'\n${dump}\nOUT`)
    const result = await run(root, [ruleFor("lint", { lefthook: "pre-commit/lint" }, ["a.ts"])])
    expect(result.findings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(
      /^pre-commit\/lint could not run, so it checked nothing: .*rulecast-no-such-tool.*not found/,
    )
  })

  test("a hook that passed is clean", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG, "a.py": "x\n" })
    await stubRunner(root, "prek", "echo 'licence....Passed'")
    expect(await run(root, [ruleFor("r", { "pre-commit": "licence" }, ["a.py"])])).toEqual({
      findings: [],
      errors: [],
    })
  })
})

describe("hook detector: a project below the repository's top", () => {
  test("the pre-commit config and the runner are the repository's; files and findings are the project's", async () => {
    const top = await createRepo({ ".pre-commit-config.yaml": CONFIG, "sub/s.sh": SCRIPT })
    await stubRunner(
      top,
      "prek",
      "printf 'sc....Failed\\n- hook id: sc\\n- exit code: 1\\n\\n  sub/s.sh:4:1: warning: cd [SC2164]\\n'\nexit 1",
    )
    const root = path.join(top, "sub")
    // The runner is found from the repository's node_modules too.
    const result = await run(root, [ruleFor("shell", { "pre-commit": "sc" }, ["s.sh"])])
    expect(result.errors).toEqual([])
    expect(await calls(top, "prek")).toEqual(["run sc --files sub/s.sh"])
    expect(result.findings.map((f) => [f.match.file, f.match.line])).toEqual([["s.sh", 4]])
  })

  test("the runner is found in a node_modules/.bin between the project and the repository's top", async () => {
    const top = await createRepo({ ".pre-commit-config.yaml": CONFIG, "packages/sub/s.sh": SCRIPT })
    const workspace = path.join(top, "packages")
    await stubRunner(workspace, "prek", "printf 'sc....Passed\\n'\nexit 0")
    const result = await run(path.join(workspace, "sub"), [ruleFor("shell", { "pre-commit": "sc" }, ["s.sh"])])
    expect(result.errors).toEqual([])
    expect(await calls(workspace, "prek")).toEqual(["run sc --files packages/sub/s.sh"])
  })

  test("a lefthook job's root is relative to the repository's top", async () => {
    const top = await createRepo({ "sub/web/a.ts": "x\n" })
    const dump = JSON.stringify({
      "pre-commit": { jobs: [{ name: "lint", root: "sub/web/", run: "./lint.sh {staged_files}" }] },
    })
    await stubRunner(top, "lefthook", `cat <<'OUT'\n${dump}\nOUT`)
    await writeFile(path.join(top, "sub/web/lint.sh"), `#!/bin/sh\necho "$1:1:1: error: bad [L1]"\nexit 1\n`)
    await chmod(path.join(top, "sub/web/lint.sh"), 0o755)
    const result = await run(path.join(top, "sub"), [ruleFor("lint", { lefthook: "pre-commit/lint" }, ["web/a.ts"])])
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => f.match.file)).toEqual(["web/a.ts"])
  })
})

describe("hook detector: lefthook jobs", () => {
  const DUMP = JSON.stringify({ "pre-commit": { jobs: [{ name: "lint", run: "./lint.sh --strict {staged_files}" }] } })

  test("runs the job's command with the rule's files in place of its template", async () => {
    const root = await createProject({ "a.ts": "x\n", "b.ts": "y\n" })
    await stubRunner(root, "lefthook", `cat <<'OUT'\n${DUMP}\nOUT`)
    await writeFile(
      path.join(root, "lint.sh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" > lint.argv\necho 'b.ts:1:1: error: bad [L1]'\nexit 1\n`,
    )
    await chmod(path.join(root, "lint.sh"), 0o755)
    const result = await run(root, [ruleFor("lint", { lefthook: "pre-commit/lint" }, ["a.ts", "b.ts"])])
    expect(await calls(root, "lefthook")).toEqual(["dump --format json"])
    expect(await readFile(path.join(root, "lint.argv"), "utf8")).toBe("--strict a.ts b.ts\n")
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => [f.match.file, f.match.captures.ruleId])).toEqual([["b.ts", "L1"]])
  })

  test("a job lefthook does not have is a rule error", async () => {
    const root = await createProject({ "a.ts": "x\n" })
    await stubRunner(root, "lefthook", `cat <<'OUT'\n${DUMP}\nOUT`)
    const result = await run(root, [ruleFor("r", { lefthook: "pre-commit/nope" }, ["a.ts"])])
    expect(result.errors).toEqual([{ rule: "r", message: 'lefthook has no job "pre-commit/nope" with a run command' }])
  })
})

describe("hook detector", () => {
  test("runs at verify only and always on the real tree", () => {
    const config = hookDetector.schema.parse({ "pre-commit": "mypy" })
    expect(hookDetector.events(config)).toEqual(["verify"])
    expect(hookDetector.wholeProject!(config)).toBe(true)
    expect(hookDetector.captures(config)).toEqual(["message", "ruleId", "severity"])
  })

  test("names exactly one of pre-commit and lefthook", () => {
    expect(hookDetector.schema.safeParse({}).success).toBe(false)
    expect(hookDetector.schema.safeParse({ "pre-commit": "a", lefthook: "pre-commit/b" }).success).toBe(false)
    expect(hookDetector.schema.safeParse({ lefthook: "no-slash" }).success).toBe(false)
  })
})
