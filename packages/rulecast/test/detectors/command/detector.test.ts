import { existsSync } from "node:fs"
import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { argvFor, commandDetector } from "../../../src/detectors/command/detector"
import type { CommandConfig } from "../../../src/detectors/command/schema"
import { createProject } from "../../helpers/project"

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
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
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
    expect(commandDetector.captures(config)).toEqual(["layer"])
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
        match: { file: "app/a.py", line: 2, endLine: 2, column: 1, text: "", captures: { layer: "crud" } },
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

  test("reads SARIF when output is sarif", async () => {
    const root = await createProject({ "a.py": "x\n" })
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
    expect(result.findings[0]!.match).toMatchObject({ file: "a.py", line: 4, text: "bad" })
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
})
