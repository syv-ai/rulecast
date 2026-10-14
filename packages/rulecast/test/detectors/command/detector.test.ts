import { existsSync } from "node:fs"
import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { argvFor, commandDetector } from "../../../src/detectors/command/detector"
import type { CommandConfig } from "../../../src/detectors/command/schema"
import { createProject, fromDisk } from "../../helpers/project"

/** A shell script in the project that prints `body`'s output. */
async function script(root: string, name: string, body: string): Promise<string> {
  const file = path.join(root, name)
  await writeFile(file, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return `./${name}`
}

const ruleFor = (id: string, config: unknown, files: string[]): DetectorRuleInput<CommandConfig> => ({
  id,
  config: commandDetector.schema.parse(config),
  files,
  context: [],
})

const run = (cwd: string, rules: DetectorRuleInput<CommandConfig>[]) =>
  commandDetector.run({
    event: "edit",
    rules,
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  })

describe("argvFor", () => {
  test("replaces the {{files}} element in place", () => {
    expect(argvFor(["check", "{{files}}", "--json"], ["a.py", "b.py"])).toEqual(["check", "a.py", "b.py", "--json"])
  })

  test("appends the files when no element is exactly {{files}}", () => {
    expect(argvFor(["check", "--files={{files}}"], ["a.py"])).toEqual(["check", "--files={{files}}", "a.py"])
  })
})

describe("command detector", () => {
  test("declares its captures and events", () => {
    const config = commandDetector.schema.parse({ run: ["./c"], captures: ["layer"] })
    expect(commandDetector.kind).toBe("command")
    expect(commandDetector.captures(config)).toEqual(["message", "ruleId", "severity", "layer"])
    expect(commandDetector.events(config)).toEqual(["edit", "verify"])
  })

  test("runs the command once with the rule's files and maps its JSON", async () => {
    const root = await createProject({ "app/a.py": "x = 1\n", "app/b.py": "y = 2\n" })
    const command = await script(
      root,
      "check.sh",
      'echo "$@" > argv.txt\necho \'[{"file":"app/a.py","line":2,"layer":"crud"}]\'',
    )
    const result = await run(root, [
      ruleFor("layers", { run: [command, "--json", "{{files}}"], captures: ["layer"] }, ["app/a.py", "app/b.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "layers",
        match: {
          file: "app/a.py",
          line: 2,
          endLine: 2,
          column: 1,
          text: "",
          captures: { message: "", ruleId: "", severity: "", layer: "crud" },
        },
      },
    ])
    expect(await readFile(path.join(root, "argv.txt"), "utf8")).toBe("--json app/a.py app/b.py\n")
  })

  test("ignores a non-zero exit code", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const command = await script(root, "c.sh", 'echo \'[{"file":"a.py","line":1}]\'\nexit 3')
    const result = await run(root, [ruleFor("r", { run: [command] }, ["a.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
  })

  test("reads SARIF when output is sarif; {{text}} is the source at the range", async () => {
    const root = await createProject({ "a.py": "a\nb\nc\nbad_call()\n" })
    const sarif = JSON.stringify({
      runs: [
        {
          results: [
            {
              message: { text: "bad" },
              locations: [{ physicalLocation: { artifactLocation: { uri: "a.py" }, region: { startLine: 4 } } }],
            },
          ],
        },
      ],
    })
    const command = await script(root, "c.sh", `cat <<'JSON'\n${sarif}\nJSON`)
    const result = await run(root, [ruleFor("r", { run: [command], output: "sarif" }, ["a.py"])])
    expect(result.errors).toEqual([])
    expect(result.findings[0]!.match).toMatchObject({
      file: "a.py",
      line: 4,
      text: "bad_call()",
      captures: { message: "bad", ruleId: "", severity: "warning" },
    })
  })

  test("a declared capture the tool did not emit is an error naming the result", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const command = await script(
      root,
      "c.sh",
      `echo '[{"file":"a.py","line":1,"layer":"crud"},{"file":"a.py","line":1}]'`,
    )
    const result = await run(root, [ruleFor("r", { run: [command], captures: ["layer"] }, ["a.py"])])
    expect(result.errors).toEqual([{ rule: "r", message: 'result 2: capture "layer" is not a string' }])
  })

  test("a rule selecting no files runs nothing", async () => {
    const root = await createProject({})
    const command = await script(root, "c.sh", "echo ran > ran.txt\necho 'not json'")
    const result = await run(root, [ruleFor("r", { run: [command] }, [])])
    expect(result).toEqual({ findings: [], errors: [] })
    expect(existsSync(path.join(root, "ran.txt"))).toBe(false)
  })

  test("a missing command, unparseable output or a bad capture fails only that rule", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const noise = await script(root, "noise.sh", "echo 'not json'")
    const fine = await script(root, "fine.sh", "echo '[]'")
    const result = await run(root, [
      ruleFor("missing", { run: ["./does-not-exist.sh"] }, ["a.py"]),
      ruleFor("noise", { run: [noise] }, ["a.py"]),
      ruleFor("fine", { run: [fine] }, ["a.py"]),
    ])
    expect(result.findings).toEqual([])
    expect(result.errors.map((error) => error.rule).sort()).toEqual(["missing", "noise"])
    expect(result.errors.find((error) => error.rule === "noise")!.message).toContain("output is not JSON")
  })

  test("rules keeps only findings with those rule ids; {{ruleId}} and {{message}} come from the tool", async () => {
    const root = await createProject({ "a.py": "x = 1\ny = 2\n" })
    const command = await script(
      root,
      "c.sh",
      "echo 'a.py:1:1: error: first [E1]'\necho 'a.py:2:1: error: second [E2]'",
    )
    const result = await run(root, [
      ruleFor("only-e2", { run: [command], output: { lines: "gcc" }, rules: ["E2"] }, ["a.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.map((f) => f.match.captures)).toEqual([
      { message: "second", ruleId: "E2", severity: "error" },
    ])
  })

  test("stream: stderr reads stderr, both reads stdout then stderr", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const command = await script(root, "c.sh", "echo 'a.py:1: out'\necho 'a.py:1: err' >&2")
    const lines = { lines: "gcc-nocol" }
    const result = await run(root, [
      ruleFor("out", { run: [command], output: lines }, ["a.py"]),
      ruleFor("err", { run: [command], output: lines, stream: "stderr" }, ["a.py"]),
      ruleFor("both", { run: [command], output: lines, stream: "both" }, ["a.py"]),
    ])
    const messages = (id: string) => result.findings.filter((f) => f.rule === id).map((f) => f.match.captures.message)
    expect(messages("out")).toEqual(["out"])
    expect(messages("err")).toEqual(["err"])
    expect(messages("both")).toEqual(["out", "err"])
  })

  test("an exit code listed under exit_codes.error is a rule error carrying stderr", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const command = await script(root, "c.sh", "echo '[]'\necho 'ty failed: invalid config' >&2\nexit 2")
    const result = await run(root, [
      ruleFor("r", { run: [command], exit_codes: { error: [2, 101] } }, ["a.py"]),
      ruleFor("unlisted", { run: [command, "--other"] }, ["a.py"]),
    ])
    expect(result.findings).toEqual([])
    expect(result.errors).toEqual([{ rule: "r", message: `${command} exited 2: ty failed: invalid config` }])
  })

  test("rules with the same command share one run over the union of their files", async () => {
    const root = await createProject({ "a.py": "x\n", "b.py": "y\n" })
    const command = await script(
      root,
      "c.sh",
      "echo \"$@\" >> calls.txt\necho 'a.py:1:1: error: in a [E1]'\necho 'b.py:1:1: error: in b [E2]'\necho 'b.py:1:1: error: also b [E1]'",
    )
    const shared = { run: [command, "{{files}}"], output: { lines: "gcc" } }
    const result = await run(root, [
      ruleFor("e1", { ...shared, rules: ["E1"] }, ["a.py", "b.py"]),
      ruleFor("e2-in-b", { ...shared, rules: ["E2"] }, ["b.py"]),
      ruleFor("all-in-a", shared, ["a.py"]),
    ])
    expect(await readFile(path.join(root, "calls.txt"), "utf8")).toBe("a.py b.py\n")
    const of = (id: string) => result.findings.filter((f) => f.rule === id).map((f) => f.match.captures.message)
    expect(of("e1")).toEqual(["in a", "also b"])
    expect(of("e2-in-b")).toEqual(["in b"])
    expect(of("all-in-a")).toEqual(["in a"])
  })

  test("a failing run fails only the rules that share it", async () => {
    const root = await createProject({ "a.py": "x\n" })
    const broken = await script(root, "broken.sh", "echo 'not json'")
    const fine = await script(root, "fine.sh", `echo '[{"file":"a.py","line":1}]'`)
    const result = await run(root, [
      ruleFor("b1", { run: [broken] }, ["a.py"]),
      ruleFor("b2", { run: [broken] }, ["a.py"]),
      ruleFor("f", { run: [fine] }, ["a.py"]),
    ])
    expect(result.errors.map((e) => e.rule).sort()).toEqual(["b1", "b2"])
    expect(result.findings.map((f) => f.rule)).toEqual(["f"])
  })

  test("scope: project runs without files and keeps only findings in the rule's files", async () => {
    const root = await createProject({ "a.py": "x\n", "b.py": "y\n" })
    const command = await script(
      root,
      "c.sh",
      "echo \"[$*]\" > argv.txt\necho 'a.py:1: unused in a'\necho 'b.py:1: unused in b'",
    )
    const config = { run: [command, "{{files}}"], output: { lines: "gcc-nocol" }, scope: "project" }
    const result = await run(root, [ruleFor("dead", config, ["b.py"])])
    expect(await readFile(path.join(root, "argv.txt"), "utf8")).toBe("[]\n")
    expect(result.findings.map((f) => [f.match.file, f.match.captures.message])).toEqual([["b.py", "unused in b"]])
  })

  test("scope: project defaults to verify only", () => {
    expect(commandDetector.events(commandDetector.schema.parse({ run: ["x"], scope: "project" }))).toEqual(["verify"])
  })
})
