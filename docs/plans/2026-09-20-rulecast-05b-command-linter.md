# rulecast Plan 5b — The `command` and `linter` detectors Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** External tools as rules. `command` runs a project's own checker and reads its JSON or SARIF output; `linter` runs ruff, oxlint or eslint once per event over the files its rules select and attributes each finding to the rules that asked for that linter rule id.

**Architecture:** `command` is a `perRule` detector: it substitutes the rule's files into an argv, runs it once, and maps the results to matches. `linter` cannot be `perRule` — spec §6 says one run per tool per event over the **union** of its rules' files — so it has its own `run` that groups rules by tool, resolves each tool, spawns it once, and fans the findings back out. Each tool is a small adapter (`args`, `parse`, `events`) behind one interface, which is where the three tools' different JSON shapes and eslint's `verify`-only default live. Both detectors treat a failure as a **per-rule** error, never a whole-run one, so a broken ruff never disables the oxlint rules running beside it.

**Tech Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest, oxlint 1.83 (a real devDependency, run for real in tests).

Prerequisite: `2026-09-20-rulecast-05a-ast-grep.md` is done. Continue with `2026-09-20-rulecast-05c-contracts-perf.md`.

---

## Decisions this plan implements

1. **Tools in tests: oxlint for real, ruff and eslint from recordings** (the user's decision on 2026-09-20). ruff has no npm distribution — there is no `@astral-sh/ruff` package, checked against the registry on 2026-09-20 — so it cannot be a devDependency of a pnpm workspace. eslint could be, but it is the slow one and it is `verify`-only precisely because of that.

   | Tool | In `pnpm test` | How |
   |---|---|---|
   | `oxlint` | Really runs | devDependency of `packages/rulecast`; fixtures symlink `node_modules/.bin/oxlint` |
   | `ruff` | Recorded | A stub in the fixture's `node_modules/.bin` replays `test/payloads/linter/ruff.json` and records its argv |
   | `eslint` | Recorded | Same, from `test/payloads/linter/eslint.json` |

   This follows the repository's existing habit: the Claude Code adapter is tested against recorded payloads under `test/payloads/claude-code/`, not against a running Claude Code. A `RULECAST_LINTERS=1` suite re-runs whichever real binaries a machine has and checks the recordings still describe them, which is where drift gets caught.

2. **Failures are per-rule, never whole-run.** `DetectorResult.errors` with `rule: null` disables *every* rule in that detector run (spec §6, §14), which for `linter` would mean one missing binary taking out the other two tools. Both detectors therefore report one error per affected rule. The only thing that ends a whole run is an abort, which is thrown.

3. **Tool resolution** follows spec §6's order — `node_modules/.bin`, then `uv run`, then `PATH` — read as:
   1. `<root>/node_modules/.bin/<tool>` when that file exists;
   2. for a Python tool (only `ruff` in 0.1), `uv run -- <tool>` when `<root>/pyproject.toml` exists and `uv` is on `PATH`, because `uv run` outside a Python project cannot resolve the tool anyway;
   3. otherwise `<tool>`, resolved by the OS from `PATH`; `ENOENT` becomes the rule error `<tool> is not installed`.

4. **`{{files}}` is a whole argv element, not a substring.** `["check", "{{files}}"]` becomes `["check", "a.py", "b.py"]`. `["--files={{files}}"]` is left alone, and because no element was exactly `{{files}}`, the files are appended instead. One rule, easy to explain, and it never has to guess a separator. A rule that selects no files does not run the command at all.

5. **SARIF captures come from `result.properties`,** falling back to the result object itself. SARIF 2.1.0 has no place for arbitrary fields on a result except `properties`, so that is where a checker that emits SARIF puts a `layer` or a `target`.

6. **`{{text}}` for a linter finding is the source it points at,** not the linter's message — `{{message}}` is already the message, and `{{text}}` means "the matched text" everywhere else. The detector reads each file of the union once and slices the finding's range out of it. On an `edit` event that union is normally one file.

7. **`linter` declares `message` and `ruleId` as captures for every tool** (spec §6), so a rule can write `{{ruleId}}: {{message}}` whichever linter it uses.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`, and a spawned CLI must get it in the child's env.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause. Biome runs with `--error-on-warnings`.
- **These detectors spawn subprocesses.** `vitest.config.ts` already allows 20 s per test and 30 s per hook (`41bd213`) because git-spawning tests were timing out under load. Do not lower those; this plan adds more spawning, not less.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout. Check that `git commit` exited 0; don't filter its output.
- Commit after every task. Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/detection/positions.ts` | `offsetAt`: the inverse of `positionAt`, for slicing a linter's range out of a file |
| `src/detectors/command/schema.ts` | `run`, `output`, `captures` |
| `src/detectors/command/results.ts` | JSON and SARIF results → `Match[]`, including the declared-capture check |
| `src/detectors/command/detector.ts` | argv substitution, spawning, the `perRule` detector |
| `src/detectors/linter/schema.ts` | `tool`, `rules`; captures and per-tool events |
| `src/detectors/linter/tools.ts` | The three tool adapters: argv and output parsing |
| `src/detectors/linter/resolve.ts` | Executable resolution (Decision 3) |
| `src/detectors/linter/detector.ts` | Group by tool, run once, attribute findings back to rules |
| `src/detectors/index.ts` | Registers both |
| `test/helpers/linters.ts` | `linkTool` (real oxlint) and `stubTool` (recorded ruff/eslint) |
| `test/payloads/linter/{ruff,oxlint,eslint}.json`, `README.md` | Recorded tool output and how it was recorded |
| `test/core/detection/positions.test.ts` | `offsetAt` |
| `test/detectors/command/{results,detector}.test.ts` | Result mapping; argv, spawning and errors |
| `test/detectors/linter/{tools,resolve,detector}.test.ts` | Parsing per tool; resolution order; grouping and attribution |
| `test/detectors/linter/live.test.ts` | Opt-in (`RULECAST_LINTERS=1`): the real binaries still match the recordings |
| `packages/rulecast/package.json` | `oxlint` devDependency |
| `docs/specs/2026-09-15-rulecast-design.md` | §6 (`{{files}}`, SARIF captures, `{{text}}`, resolution); §15 (how linters are tested) |

## Not in this plan

- **`agents/reference/detectors.md`**: `2026-09-20-rulecast-05c-contracts-perf.md` rewrites its "Coming later" section once all three detectors exist.
- **The exported contract suites and the perf fixture**: also 5c. The perf fixture's linter rule is added there, with oxlint in place of spec §13's `ruff`.
- **`rulecast doctor`'s linter-binary check** (spec §5): plan 7. This plan's error messages are what `doctor` will eventually report.
- **Biome as a fourth tool**: spec §17 puts it in 0.2.
- **Catalog rules using these detectors.** The catalog cannot assume any project has ruff or oxlint installed, so `command` and `linter` rules stay project-local until `doctor` can report a missing binary properly.

---

### Task 1: `offsetAt`, the inverse of `positionAt`

**Files:**
- Modify: `src/core/detection/positions.ts`
- Test: `test/core/detection/positions.test.ts`

**Behaviour:** Given a file's line starts and a 1-based line and column, return the string offset, clamped to the file so a linter reporting a position past the end cannot throw.

- [ ] **Step 1: Write the failing test**

Add `offsetAt` to that file's existing import from `../../../src/core/detection/positions`, then append (read the file first and follow its style):

```ts
describe("offsetAt", () => {
  const text = "ab\ncde\n"
  const starts = lineStarts(text)

  test("is the inverse of positionAt", () => {
    for (let offset = 0; offset < text.length; offset++) {
      const { line, column } = positionAt(starts, offset)
      expect(offsetAt(starts, line, column, text.length)).toBe(offset)
    }
  })

  test("clamps a line or column past the end of the file", () => {
    expect(offsetAt(starts, 99, 1, text.length)).toBe(text.length)
    expect(offsetAt(starts, 2, 99, text.length)).toBe(text.length)
    expect(offsetAt(starts, 0, 0, text.length)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/detection/positions.test.ts`
Expected: FAIL — `offsetAt` is not exported.

- [ ] **Step 3: Implement it**

Append to `packages/rulecast/src/core/detection/positions.ts`:
```ts
/** String offset of a 1-based line and column, clamped to a file of `length` characters. */
export function offsetAt(starts: number[], line: number, column: number, length: number): number {
  const index = Math.min(Math.max(line, 1), starts.length) - 1
  const offset = starts[index]! + Math.max(column, 1) - 1
  return Math.min(Math.max(offset, 0), length)
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/core/detection/positions.test.ts` → passes.

- [ ] **Step 5: Commit**

`feat: add offsetAt to map a line and column back to an offset`

---

### Task 2: `command` — schema and result mapping

**Files:**
- Create: `src/detectors/command/schema.ts`, `src/detectors/command/results.ts`
- Test: `test/detectors/command/results.test.ts`

**Behaviour:** The config validates `run`, `output` and `captures`; JSON and SARIF results become `Match[]` with repo-relative files and 1-based positions; a declared capture missing from any result, or present but not a string, is an error naming the result and the capture.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/command/results.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { matchesFromJson, matchesFromSarif } from "../../../src/detectors/command/results"
import { commandSchema } from "../../../src/detectors/command/schema"

const cwd = "/repo"

describe("command schema", () => {
  test("defaults output to json and captures to none", () => {
    expect(commandSchema.parse({ run: ["./check"] })).toEqual({ run: ["./check"], output: "json", captures: [] })
  })

  test("rejects an empty run, an unknown output and a capture that is not a variable name", () => {
    expect(commandSchema.safeParse({ run: [] }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], output: "xml" }).success).toBe(false)
    expect(commandSchema.safeParse({ run: ["x"], captures: ["not a name"] }).success).toBe(false)
  })

  test("rejects a capture that shadows a core template variable", () => {
    const result = commandSchema.safeParse({ run: ["x"], captures: ["line"] })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toContain("line")
  })
})

describe("matchesFromJson", () => {
  test("maps results, defaulting endLine, column and text", () => {
    const json = JSON.stringify([
      { file: "app/a.py", line: 3 },
      { file: "/repo/app/b.py", line: 5, endLine: 7, column: 2, text: "boom" },
    ])
    expect(matchesFromJson(json, [], cwd)).toEqual([
      { file: "app/a.py", line: 3, endLine: 3, column: 1, text: "", captures: {} },
      { file: "app/b.py", line: 5, endLine: 7, column: 2, text: "boom", captures: {} },
    ])
  })

  test("a declared capture that is missing or not a string is an error naming the result", () => {
    expect(() => matchesFromJson(JSON.stringify([{ file: "a.py", line: 1 }]), ["layer"], cwd)).toThrow(
      'result 1: capture "layer" is not a string',
    )
    expect(() => matchesFromJson(JSON.stringify([{ file: "a.py", line: 1, layer: 3 }]), ["layer"], cwd)).toThrow(
      'result 1: capture "layer" is not a string',
    )
    expect(matchesFromJson(JSON.stringify([{ file: "a.py", line: 1, layer: "crud" }]), ["layer"], cwd)[0]!.captures)
      .toEqual({ layer: "crud" })
  })

  test("rejects output that is not an array of results with a file and a line", () => {
    expect(() => matchesFromJson("not json", [], cwd)).toThrow("output is not JSON")
    expect(() => matchesFromJson('{"a":1}', [], cwd)).toThrow("output is not a JSON array")
    expect(() => matchesFromJson('[{"line":1}]', [], cwd)).toThrow('result 1: "file" must be a string')
    expect(() => matchesFromJson('[{"file":"a"}]', [], cwd)).toThrow('result 1: "line" must be a number')
  })
})

describe("matchesFromSarif", () => {
  const sarif = JSON.stringify({
    version: "2.1.0",
    runs: [
      {
        results: [
          {
            message: { text: "crud reached into routes" },
            properties: { layer: "crud", target: "routes" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "app/crud/users.py" },
                  region: { startLine: 12, startColumn: 5, endLine: 13 },
                },
              },
            ],
          },
          { message: { text: "no location" }, properties: { layer: "x", target: "y" }, locations: [] },
        ],
      },
    ],
  })

  test("reads results from every run, defaulting a missing region", () => {
    expect(matchesFromSarif(sarif, ["layer", "target"], cwd)).toEqual([
      {
        file: "app/crud/users.py",
        line: 12,
        endLine: 13,
        column: 5,
        text: "crud reached into routes",
        captures: { layer: "crud", target: "routes" },
      },
    ])
  })
```

A result with no location has nothing to attach a finding to and is dropped, which is why only one match comes back.

```ts
  test("strips a file:// uri and falls back to the result's own fields for captures", () => {
    const withUri = JSON.stringify({
      runs: [
        {
          results: [
            {
              layer: "svc",
              locations: [{ physicalLocation: { artifactLocation: { uri: "file:///repo/app/s.py" } } }],
            },
          ],
        },
      ],
    })
    expect(matchesFromSarif(withUri, ["layer"], cwd)).toEqual([
      { file: "app/s.py", line: 1, endLine: 1, column: 1, text: "", captures: { layer: "svc" } },
    ])
  })

  test("rejects output that is not SARIF", () => {
    expect(() => matchesFromSarif('{"runs":{}}', [], cwd)).toThrow("output is not SARIF")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/command/results.test.ts`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Write the schema**

`packages/rulecast/src/detectors/command/schema.ts`:
```ts
import { z } from "zod"

import { CORE_VARIABLES } from "../../core/template"

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export const commandSchema = z
  .object({
    /** argv. The element exactly "{{files}}" is replaced by the rule's files; otherwise they are appended. */
    run: z.array(z.string().min(1)).min(1),
    output: z.enum(["json", "sarif"]).default("json"),
    captures: z
      .array(z.string().regex(VARIABLE_NAME, "a capture must be a template variable name"))
      .default([])
      .superRefine((captures, ctx) => {
        for (const name of captures) {
          if ((CORE_VARIABLES as readonly string[]).includes(name)) {
            ctx.addIssue({ code: "custom", message: `"${name}" is a core template variable` })
          }
        }
      }),
  })
  .strict()

export type CommandConfig = z.infer<typeof commandSchema>
```

- [ ] **Step 4: Write the result mapping**

`packages/rulecast/src/detectors/command/results.ts`:
```ts
import path from "node:path"

import type { Match } from "../../core/types"

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error("output is not JSON")
  }
}

/** A path from a tool, made repo-relative with forward slashes. */
export function repoRelative(file: string, cwd: string): string {
  const withoutScheme = file.startsWith("file://") ? new URL(file).pathname : file
  const relative = path.isAbsolute(withoutScheme) ? path.relative(cwd, withoutScheme) : withoutScheme
  return relative.split(path.sep).join("/")
}

/**
 * Spec §6 and §14: "every declared capture must be a string field of every result; a missing one
 * is a rule error". Unlike a pattern's unmatched group, a checker that does not emit a field it
 * was told it emits is misconfigured, and silently delivering "" would hide it.
 */
function capturesOf(source: JsonObject, names: string[], where: string): Record<string, string> {
  const captures: Record<string, string> = {}
  for (const name of names) {
    const value = source[name]
    if (typeof value !== "string") throw new Error(`${where}: capture "${name}" is not a string`)
    captures[name] = value
  }
  return captures
}

export function matchesFromJson(output: string, captures: string[], cwd: string): Match[] {
  const parsed = parseJson(output)
  if (!Array.isArray(parsed)) throw new Error("output is not a JSON array of results")
  return parsed.map((result, index) => {
    const where = `result ${index + 1}`
    if (!isObject(result)) throw new Error(`${where}: not an object`)
    if (typeof result.file !== "string") throw new Error(`${where}: "file" must be a string`)
    if (typeof result.line !== "number") throw new Error(`${where}: "line" must be a number`)
    return {
      file: repoRelative(result.file, cwd),
      line: result.line,
      endLine: typeof result.endLine === "number" ? result.endLine : result.line,
      column: typeof result.column === "number" ? result.column : 1,
      text: typeof result.text === "string" ? result.text : "",
      captures: capturesOf(result, captures, where),
    }
  })
}

export function matchesFromSarif(output: string, captures: string[], cwd: string): Match[] {
  const parsed = parseJson(output)
  if (!isObject(parsed) || !Array.isArray(parsed.runs)) throw new Error("output is not SARIF 2.1.0")
  const matches: Match[] = []
  let index = 0
  for (const run of parsed.runs) {
    if (!isObject(run) || !Array.isArray(run.results)) throw new Error("output is not SARIF 2.1.0")
    for (const result of run.results) {
      index += 1
      const where = `result ${index}`
      if (!isObject(result)) throw new Error(`${where}: not an object`)
      const location = Array.isArray(result.locations) ? result.locations[0] : undefined
      const physical = isObject(location) ? location.physicalLocation : undefined
      const artifact = isObject(physical) ? physical.artifactLocation : undefined
      // A result with no physical location has no line to attach a finding to.
      if (!isObject(artifact) || typeof artifact.uri !== "string") continue
      const region = isObject(physical) && isObject(physical.region) ? physical.region : {}
      const line = typeof region.startLine === "number" ? region.startLine : 1
      const message = isObject(result.message) && typeof result.message.text === "string" ? result.message.text : ""
      // SARIF 2.1.0 has no place for a tool's own fields on a result except `properties`.
      const source = isObject(result.properties) ? { ...result, ...result.properties } : result
      matches.push({
        file: repoRelative(artifact.uri, cwd),
        line,
        endLine: typeof region.endLine === "number" ? region.endLine : line,
        column: typeof region.startColumn === "number" ? region.startColumn : 1,
        text: message,
        captures: capturesOf(source, captures, where),
      })
    }
  }
  return matches
}
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run test/detectors/command/results.test.ts` → passes.

- [ ] **Step 6: Commit**

`feat: command detector schema and JSON/SARIF result mapping`

---

### Task 3: The `command` detector

**Files:**
- Create: `src/detectors/command/detector.ts`
- Test: `test/detectors/command/detector.test.ts`

**Behaviour:** The rule's files are substituted into the argv, the command runs once from the project root, its exit code is ignored and its stdout becomes matches. A command that does not exist, or whose output cannot be read, fails that rule alone. A rule that selects no files does not run anything.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/command/detector.test.ts`:
```ts
import { existsSync } from "node:fs"
import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import type { DetectorRuleInput } from "../../../src/core/types"
import { argvFor, commandDetector } from "../../../src/detectors/command/detector"
import type { CommandConfig } from "../../../src/detectors/command/schema"
import { createProject } from "../../helpers/project"

/** A shell script in the project that prints `stdout` and records the argv it was given. */
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
    cwd,
    signal: new AbortController().signal,
  })

describe("argvFor", () => {
  test("replaces the {{files}} element in place", () => {
    expect(argvFor(["check", "{{files}}", "--json"], ["a.py", "b.py"])).toEqual([
      "check",
      "a.py",
      "b.py",
      "--json",
    ])
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
    const command = await script(root, "c.sh", "echo '[{\"file\":\"a.py\",\"line\":1}]'\nexit 3")
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/command/detector.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the detector**

`packages/rulecast/src/detectors/command/detector.ts`:
```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { perRule } from "../../core/detection/per-rule"
import { isNotFound } from "../../core/errors"
import type { Detector } from "../../core/types"
import { matchesFromJson, matchesFromSarif } from "./results"
import { type CommandConfig, commandSchema } from "./schema"

const exec = promisify(execFile)

const FILES = "{{files}}"

/** The rule's files replace the "{{files}}" element, or are appended when there is none. */
export function argvFor(run: string[], files: string[]): string[] {
  if (!run.includes(FILES)) return [...run, ...files]
  return run.flatMap((argument) => (argument === FILES ? files : [argument]))
}

export const commandDetector: Detector<CommandConfig> = {
  kind: "command",
  schema: commandSchema,
  captures: (config) => config.captures,
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    if (rule.files.length === 0) return []
    const [command, ...rest] = argvFor(rule.config.run, rule.files)
    let stdout: string
    try {
      // The exit code says "I found something", not "I failed": the output is the answer.
      ;({ stdout } = await exec(command!, rest, {
        cwd: input.cwd,
        signal: input.signal,
        maxBuffer: 64 * 1024 * 1024,
      }))
    } catch (error) {
      if (input.signal.aborted) throw error
      if (isNotFound(error)) throw new Error(`command not found: ${command}`)
      const failure = error as { stdout?: string; code?: unknown }
      if (typeof failure.stdout !== "string") throw error
      stdout = failure.stdout
    }
    return rule.config.output === "sarif"
      ? matchesFromSarif(stdout, rule.config.captures, input.cwd)
      : matchesFromJson(stdout, rule.config.captures, input.cwd)
  }),
}
```

`perRule` already turns a thrown error into an error for that rule alone and rethrows on abort, which is Decision 2 for this detector.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/detectors/command/detector.test.ts` → passes.
Run: `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

`feat: the command detector`

---

### Task 4: Recorded linter output and the test helpers

**Files:**
- Create: `test/payloads/linter/ruff.json`, `oxlint.json`, `eslint.json`, `README.md`
- Create: `test/helpers/linters.ts`
- Modify: `packages/rulecast/package.json` (oxlint devDependency)

**Behaviour:** A test can put a real oxlint or a recorded ruff/eslint into a fixture project's `node_modules/.bin` and read back the argv the tool was called with.

- [ ] **Step 1: Add oxlint**

Run: `pnpm --filter @syv-ai/rulecast add -D oxlint@^1.83.0`

- [ ] **Step 2: Record the three tools' output**

The recordings below were captured on 2026-09-20 against ruff 0.14.0, oxlint 1.83.0 and eslint 10.11.0, all run from a project root with one file. Write them as they are; Task 8's live suite is what keeps them honest.

`packages/rulecast/test/payloads/linter/ruff.json` — `ruff check --output-format json` over a file with an unused import and a `print`:
```json
[
  {
    "cell": null,
    "code": "F401",
    "end_location": { "column": 10, "row": 1 },
    "filename": "__ROOT__/app/a.py",
    "fix": null,
    "location": { "column": 8, "row": 1 },
    "message": "`os` imported but unused",
    "noqa_row": 1,
    "url": "https://docs.astral.sh/ruff/rules/unused-import"
  },
  {
    "cell": null,
    "code": "T201",
    "end_location": { "column": 11, "row": 2 },
    "filename": "__ROOT__/app/a.py",
    "fix": null,
    "location": { "column": 1, "row": 2 },
    "message": "`print` found",
    "noqa_row": 2,
    "url": "https://docs.astral.sh/ruff/rules/print"
  }
]
```

`packages/rulecast/test/payloads/linter/oxlint.json` — `oxlint --format=json`:
```json
{
  "diagnostics": [
    {
      "message": "Variable 'unused' is declared but never used. Unused variables should start with a '_'.",
      "code": "eslint(no-unused-vars)",
      "severity": "warning",
      "url": "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html",
      "help": "Consider removing this declaration.",
      "filename": "src/a.js",
      "labels": [
        {
          "label": "'unused' is declared here",
          "span": { "offset": 24, "length": 6, "line": 2, "column": 7 }
        }
      ]
    },
    {
      "message": "`debugger` statement is not allowed",
      "code": "eslint(no-debugger)",
      "severity": "warning",
      "url": "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
      "help": "Remove the debugger statement",
      "filename": "src/a.js",
      "labels": [{ "span": { "offset": 35, "length": 8, "line": 3, "column": 1 } }]
    }
  ],
  "number_of_files": 1,
  "number_of_rules": 96,
  "threads_count": 12,
  "start_time": 0.026
}
```

`packages/rulecast/test/payloads/linter/eslint.json` — `eslint --format=json`:
```json
[
  {
    "filePath": "__ROOT__/src/a.js",
    "messages": [
      {
        "ruleId": "no-console",
        "severity": 2,
        "message": "Unexpected console statement.",
        "line": 1,
        "column": 1,
        "messageId": "unexpected",
        "endLine": 1,
        "endColumn": 12
      },
      {
        "ruleId": "no-debugger",
        "severity": 1,
        "message": "Unexpected 'debugger' statement.",
        "line": 3,
        "column": 1,
        "messageId": "unexpected",
        "endLine": 3,
        "endColumn": 9
      }
    ],
    "suppressedMessages": [],
    "errorCount": 1,
    "fatalErrorCount": 0,
    "warningCount": 1,
    "fixableErrorCount": 0,
    "fixableWarningCount": 0,
    "usedDeprecatedRules": []
  }
]
```

`__ROOT__` stands in for the fixture's absolute root; `stubTool` substitutes it, because ruff and eslint both report absolute paths while oxlint reports paths relative to its cwd. That difference is real and the parsers must handle both.

`packages/rulecast/test/payloads/linter/README.md`: say what each file is, the tool version it came from, the command that produced it, and that `test/detectors/linter/live.test.ts` (with `RULECAST_LINTERS=1`) re-checks them against the real binaries. Follow the voice of `test/payloads/claude-code/README.md`.

- [ ] **Step 3: Write the helpers**

`packages/rulecast/test/helpers/linters.ts`:
```ts
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const payloads = fileURLToPath(new URL("../payloads/linter/", import.meta.url))

/** Where the detector looks first (spec §6): <root>/node_modules/.bin. */
function binDir(root: string): string {
  return path.join(root, "node_modules", ".bin")
}

/** The workspace's own oxlint, so a fixture runs the real tool. */
export function realTool(tool: string): string | null {
  const binary = path.resolve("node_modules", ".bin", tool)
  return existsSync(binary) ? binary : null
}

/** Symlinks a real tool into the fixture. Throws when it is not installed: this must not skip silently. */
export async function linkTool(root: string, tool: string): Promise<void> {
  const binary = realTool(tool)
  if (binary === null) throw new Error(`${tool} is not installed in the workspace; pnpm install`)
  await mkdir(binDir(root), { recursive: true })
  await symlink(binary, path.join(binDir(root), tool))
}

/** A stub that replays a recording and writes the argv it was called with to <root>/<tool>.argv. */
export async function stubTool(root: string, tool: string, options: { exitCode?: number } = {}): Promise<void> {
  const recording = (await readFile(path.join(payloads, `${tool}.json`), "utf8")).replaceAll("__ROOT__", root)
  await mkdir(binDir(root), { recursive: true })
  const output = path.join(binDir(root), `${tool}.recording.json`)
  await writeFile(output, recording)
  const script = path.join(binDir(root), tool)
  await writeFile(
    script,
    ["#!/bin/sh", `printf '%s\\n' "$*" > "${path.join(root, `${tool}.argv`)}"`, `cat "${output}"`, `exit ${options.exitCode ?? 1}`, ""].join("\n"),
  )
  await chmod(script, 0o755)
}

/** The argv a stub was called with, as one space-joined line. */
export async function stubArgv(root: string, tool: string): Promise<string> {
  return (await readFile(path.join(root, `${tool}.argv`), "utf8")).trim()
}
```

The stub exits 1 by default, because a linter that found something does; the detector must ignore that.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` → clean. There is nothing to run yet; Task 5 is the first user.

- [ ] **Step 5: Commit**

`test: record linter output and add the fixture tool helpers`

---

### Task 5: The three tool adapters

**Files:**
- Create: `src/detectors/linter/tools.ts`, `src/detectors/linter/schema.ts`
- Test: `test/detectors/linter/tools.test.ts`

**Behaviour:** Each tool knows its argv and how to read its output into `{ file, line, column, endLine, ruleId, message }`, with files repo-relative; eslint defaults to `verify` only.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/linter/tools.test.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { linterSchema } from "../../../src/detectors/linter/schema"
import { TOOLS } from "../../../src/detectors/linter/tools"

const payloads = fileURLToPath(new URL("../../payloads/linter/", import.meta.url))
const ROOT = "/repo"
const recording = async (tool: string) =>
  (await readFile(path.join(payloads, `${tool}.json`), "utf8")).replaceAll("__ROOT__", ROOT)

describe("linter schema", () => {
  test("accepts the three tools and an optional rule list", () => {
    expect(linterSchema.parse({ tool: "ruff" })).toEqual({ tool: "ruff" })
    expect(linterSchema.parse({ tool: "oxlint", rules: ["no-debugger"] })).toEqual({
      tool: "oxlint",
      rules: ["no-debugger"],
    })
    expect(linterSchema.safeParse({ tool: "biome" }).success).toBe(false)
    expect(linterSchema.safeParse({ tool: "ruff", extra: 1 }).success).toBe(false)
  })
})

describe("tool adapters", () => {
  test("eslint defaults to verify only; ruff and oxlint run on edits too", () => {
    expect(TOOLS.eslint.events).toEqual(["verify"])
    expect(TOOLS.ruff.events).toEqual(["edit", "verify"])
    expect(TOOLS.oxlint.events).toEqual(["edit", "verify"])
  })

  test("each tool asks for JSON and passes the files last", () => {
    expect(TOOLS.ruff.args(["a.py"])).toEqual(["check", "--output-format", "json", "--force-exclude", "--", "a.py"])
    expect(TOOLS.oxlint.args(["a.js"])).toEqual(["--format=json", "--", "a.js"])
    expect(TOOLS.eslint.args(["a.js"])).toEqual([
      "--format=json",
      "--no-error-on-unmatched-pattern",
      "--",
      "a.js",
    ])
  })

  test("ruff output becomes findings with repo-relative files", async () => {
    expect(TOOLS.ruff.parse(await recording("ruff"), ROOT)).toEqual([
      { file: "app/a.py", line: 1, column: 8, endLine: 1, endColumn: 10, ruleId: "F401", message: "`os` imported but unused" },
      { file: "app/a.py", line: 2, column: 1, endLine: 2, endColumn: 11, ruleId: "T201", message: "`print` found" },
    ])
  })

  test("oxlint output becomes findings, with the rule id taken out of its code", async () => {
    const findings = TOOLS.oxlint.parse(await recording("oxlint"), ROOT)
    expect(findings.map((finding) => [finding.ruleId, finding.file, finding.line, finding.column])).toEqual([
      ["no-unused-vars", "src/a.js", 2, 7],
      ["no-debugger", "src/a.js", 3, 1],
    ])
  })

  test("eslint output becomes findings with absolute paths made relative", async () => {
    const findings = TOOLS.eslint.parse(await recording("eslint"), ROOT)
    expect(findings.map((finding) => [finding.ruleId, finding.file, finding.line, finding.endLine])).toEqual([
      ["no-console", "src/a.js", 1, 1],
      ["no-debugger", "src/a.js", 3, 3],
    ])
  })

  test("empty output from each tool is no findings", () => {
    expect(TOOLS.ruff.parse("[]", ROOT)).toEqual([])
    expect(TOOLS.oxlint.parse('{"diagnostics":[]}', ROOT)).toEqual([])
    expect(TOOLS.eslint.parse('[{"filePath":"/repo/a.js","messages":[]}]', ROOT)).toEqual([])
  })

  test("unreadable output is an error naming the tool", () => {
    expect(() => TOOLS.ruff.parse("boom", ROOT)).toThrow("ruff output is not JSON")
    expect(() => TOOLS.oxlint.parse("[]", ROOT)).toThrow("oxlint output is not JSON")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/linter/tools.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the schema**

`packages/rulecast/src/detectors/linter/schema.ts`:
```ts
import { z } from "zod"

export const TOOL_NAMES = ["eslint", "oxlint", "ruff"] as const

export const linterSchema = z
  .object({
    tool: z.enum(TOOL_NAMES),
    /** Linter rule ids to report. Omitted: every finding the tool reports. */
    rules: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()

export type LinterConfig = z.infer<typeof linterSchema>
export type ToolName = (typeof TOOL_NAMES)[number]
```

- [ ] **Step 4: Write the adapters**

`packages/rulecast/src/detectors/linter/tools.ts`:
```ts
import path from "node:path"

import type { DetectorEvent } from "../../core/types"
import type { ToolName } from "./schema"

export interface LinterFinding {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number | null
  /** "" when the tool reported none (a syntax error, say). */
  ruleId: string
  message: string
}

export interface LinterTool {
  events: DetectorEvent[]
  args(files: string[]): string[]
  parse(stdout: string, root: string): LinterFinding[]
}

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function json(tool: ToolName, stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`${tool} output is not JSON`)
  }
}

function relative(file: string, root: string): string {
  return (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join("/")
}

const number = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback)
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** oxlint reports "eslint(no-debugger)"; the rule id people write is the part inside. */
function oxlintRuleId(code: unknown): string {
  const raw = text(code)
  return /^[\w-]+\((?<rule>[^)]+)\)$/.exec(raw)?.groups?.rule ?? raw
}

export const TOOLS: Record<ToolName, LinterTool> = {
  ruff: {
    events: ["edit", "verify"],
    args: (files) => ["check", "--output-format", "json", "--force-exclude", "--", ...files],
    parse(stdout, root) {
      const parsed = json("ruff", stdout)
      if (!Array.isArray(parsed)) throw new Error("ruff output is not JSON array of diagnostics")
      return parsed.filter(isObject).map((result) => {
        const start = isObject(result.location) ? result.location : {}
        const end = isObject(result.end_location) ? result.end_location : {}
        const line = number(start.row, 1)
        return {
          file: relative(text(result.filename), root),
          line,
          column: number(start.column, 1),
          endLine: number(end.row, line),
          endColumn: typeof end.column === "number" ? end.column : null,
          ruleId: text(result.code),
          message: text(result.message),
        }
      })
    },
  },
  oxlint: {
    events: ["edit", "verify"],
    args: (files) => ["--format=json", "--", ...files],
    parse(stdout, root) {
      const parsed = json("oxlint", stdout)
      if (!isObject(parsed) || !Array.isArray(parsed.diagnostics)) {
        throw new Error("oxlint output is not JSON with diagnostics")
      }
      return parsed.diagnostics.filter(isObject).map((diagnostic) => {
        const label = Array.isArray(diagnostic.labels) ? diagnostic.labels[0] : undefined
        const span = isObject(label) && isObject(label.span) ? label.span : {}
        const line = number(span.line, 1)
        return {
          file: relative(text(diagnostic.filename), root),
          line,
          column: number(span.column, 1),
          endLine: line,
          endColumn: null,
          ruleId: oxlintRuleId(diagnostic.code),
          message: text(diagnostic.message),
        }
      })
    },
  },
  eslint: {
    // eslint is the slow one: spec §6 keeps it off the edit hook by default.
    events: ["verify"],
    args: (files) => ["--format=json", "--no-error-on-unmatched-pattern", "--", ...files],
    parse(stdout, root) {
      const parsed = json("eslint", stdout)
      if (!Array.isArray(parsed)) throw new Error("eslint output is not a JSON array of file results")
      const findings: LinterFinding[] = []
      for (const file of parsed.filter(isObject)) {
        const messages = Array.isArray(file.messages) ? file.messages : []
        for (const message of messages.filter(isObject)) {
          const line = number(message.line, 1)
          findings.push({
            file: relative(text(file.filePath), root),
            line,
            column: number(message.column, 1),
            endLine: number(message.endLine, line),
            endColumn: typeof message.endColumn === "number" ? message.endColumn : null,
            ruleId: text(message.ruleId),
            message: text(message.message),
          })
        }
      }
      return findings
    },
  },
}
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run test/detectors/linter/tools.test.ts` → passes.

If a shape assertion fails, compare against the recording in `test/payloads/linter/` before touching the test — the recording is the truth about what the tool printed.

- [ ] **Step 6: Commit**

`feat: ruff, oxlint and eslint adapters for the linter detector`

---

### Task 6: Tool resolution

**Files:**
- Create: `src/detectors/linter/resolve.ts`
- Test: `test/detectors/linter/resolve.test.ts`

**Behaviour:** Resolution follows Decision 3's order, and the result is an argv prefix so the caller does not care which branch won.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/linter/resolve.test.ts`:
```ts
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { resolveTool } from "../../../src/detectors/linter/resolve"
import { createProject } from "../../helpers/project"

describe("resolveTool", () => {
  test("prefers the project's node_modules/.bin", async () => {
    const root = await createProject({})
    await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true })
    const binary = path.join(root, "node_modules", ".bin", "oxlint")
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)
    expect(await resolveTool("oxlint", root, () => true)).toEqual({ command: binary, prefix: [] })
  })

  test("falls back to uv run for a python tool in a uv project", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("ruff", root, (command) => command === "uv")).toEqual({
      command: "uv",
      prefix: ["run", "--", "ruff"],
    })
  })

  test("does not use uv run without a pyproject.toml, or for a JavaScript tool", async () => {
    const bare = await createProject({})
    expect(await resolveTool("ruff", bare, () => true)).toEqual({ command: "ruff", prefix: [] })
    const python = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("eslint", python, () => true)).toEqual({ command: "eslint", prefix: [] })
  })

  test("falls back to PATH when uv is not installed", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("ruff", root, () => false)).toEqual({ command: "ruff", prefix: [] })
  })
})
```

The injected `available` callback is what makes this test hermetic: it never asks the machine whether `uv` is installed.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/linter/resolve.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the resolver**

`packages/rulecast/src/detectors/linter/resolve.ts`:
```ts
import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { ToolName } from "./schema"

const exec = promisify(execFile)

export interface ResolvedTool {
  command: string
  /** Arguments that come before the tool's own: ["run", "--", "ruff"] for uv. */
  prefix: string[]
}

/** Tools that live in a Python environment, so `uv run` can supply them. */
const PYTHON_TOOLS: ReadonlySet<string> = new Set(["ruff"])

async function reachable(file: string, mode: number): Promise<boolean> {
  try {
    await access(file, mode)
    return true
  } catch {
    return false
  }
}

async function onPath(command: string): Promise<boolean> {
  try {
    await exec("command", ["-v", command], { shell: "/bin/sh" })
    return true
  } catch {
    return false
  }
}

/**
 * Spec §6: the project's node_modules/.bin, then `uv run`, then PATH. `uv run` only helps for a
 * Python tool inside a Python project, so it is gated on both.
 */
export async function resolveTool(
  tool: ToolName,
  root: string,
  available: (command: string) => boolean | Promise<boolean> = onPath,
): Promise<ResolvedTool> {
  const local = path.join(root, "node_modules", ".bin", tool)
  if (await reachable(local, constants.X_OK)) return { command: local, prefix: [] }
  if (
    PYTHON_TOOLS.has(tool) &&
    (await reachable(path.join(root, "pyproject.toml"), constants.F_OK)) &&
    (await available("uv"))
  ) {
    return { command: "uv", prefix: ["run", "--", tool] }
  }
  return { command: tool, prefix: [] }
}
```

Three branches: the project's bin directory (checked for the execute bit), `uv run` (the `pyproject.toml` is data, so it is checked for existence only), then `PATH`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/detectors/linter/resolve.test.ts` → passes.

- [ ] **Step 5: Commit**

`feat: resolve linter binaries from node_modules, uv or PATH`

---

### Task 7: The `linter` detector

**Files:**
- Create: `src/detectors/linter/detector.ts`
- Modify: `src/detectors/index.ts`
- Test: `test/detectors/linter/detector.test.ts`

**Behaviour:** Rules are grouped by tool; each tool runs once over the union of its rules' files; a finding goes to every rule of that tool that selects the file and either lists its rule id or lists none. `{{text}}` is the source the finding points at. A tool that cannot run fails only its own rules.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/linter/detector.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import type { DetectorRuleInput } from "../../../src/core/types"
import { linterDetector } from "../../../src/detectors/linter/detector"
import type { LinterConfig } from "../../../src/detectors/linter/schema"
import { linkTool, stubArgv, stubTool } from "../../helpers/linters"
import { createProject } from "../../helpers/project"

const ruleFor = (id: string, config: unknown, files: string[]): DetectorRuleInput<LinterConfig> => ({
  id,
  config: linterDetector.schema.parse(config),
  files,
  context: [],
})

const run = (cwd: string, rules: DetectorRuleInput<LinterConfig>[], event: "edit" | "verify" = "verify") =>
  linterDetector.run({
    event,
    rules,
    changes: new Map(),
    cache: memoryCache(),
    cwd,
    signal: new AbortController().signal,
  })

const JS = 'console.log("hi")\nconst unused = 1\ndebugger\n'
const PY = "import os\nprint('x')\n"

describe("linter detector", () => {
  test("declares captures and per-tool events", () => {
    expect(linterDetector.kind).toBe("linter")
    expect(linterDetector.captures(linterDetector.schema.parse({ tool: "ruff" }))).toEqual(["message", "ruleId"])
    expect(linterDetector.events(linterDetector.schema.parse({ tool: "eslint" }))).toEqual(["verify"])
    expect(linterDetector.events(linterDetector.schema.parse({ tool: "oxlint" }))).toEqual(["edit", "verify"])
  })

  test("runs the real oxlint once over the union of its rules' files", async () => {
    const root = await createProject({ "src/a.js": JS, "src/b.js": "debugger\n" })
    await linkTool(root, "oxlint")
    const result = await run(root, [
      ruleFor("no-debugger", { tool: "oxlint", rules: ["no-debugger"] }, ["src/a.js", "src/b.js"]),
      ruleFor("everything", { tool: "oxlint" }, ["src/a.js"]),
    ])
    expect(result.errors).toEqual([])
    const debuggerFindings = result.findings.filter((finding) => finding.rule === "no-debugger")
    expect(debuggerFindings.map((finding) => [finding.match.file, finding.match.line])).toEqual([
      ["src/a.js", 3],
      ["src/b.js", 1],
    ])
    expect(debuggerFindings[0]!.match.captures).toEqual({
      ruleId: "no-debugger",
      message: "`debugger` statement is not allowed",
    })
    expect(debuggerFindings[0]!.match.text).toBe("debugger")
    // "everything" has no rules list, so it gets every diagnostic oxlint reported — but only for
    // the one file it selects. Asserted as a superset rather than a count: oxlint's default rule
    // set changes between releases, and this test is not about which rules it ships.
    const all = result.findings.filter((finding) => finding.rule === "everything")
    expect(all.every((finding) => finding.match.file === "src/a.js")).toBe(true)
    expect(all.map((finding) => finding.match.captures.ruleId)).toContain("no-debugger")
    expect(all.length).toBeGreaterThanOrEqual(debuggerFindings.length - 1)
  })

  test("passes the union of files to the tool exactly once", async () => {
    const root = await createProject({ "app/a.py": PY, "app/b.py": PY })
    await stubTool(root, "ruff")
    await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py", "app/b.py"]),
      ruleFor("imports", { tool: "ruff", rules: ["F401"] }, ["app/a.py"]),
    ])
    expect(await stubArgv(root, "ruff")).toBe("check --output-format json --force-exclude -- app/a.py app/b.py")
  })

  test("attributes a finding to every rule that asked for its rule id", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubTool(root, "ruff")
    const result = await run(root, [
      ruleFor("print", { tool: "ruff", rules: ["T201"] }, ["app/a.py"]),
      ruleFor("imports", { tool: "ruff", rules: ["F401"] }, ["app/a.py"]),
      ruleFor("both", { tool: "ruff", rules: ["T201", "F401"] }, ["app/a.py"]),
      ruleFor("other-file", { tool: "ruff" }, ["app/elsewhere.py"]),
    ])
    expect(result.errors).toEqual([])
    const byRule = (id: string) =>
      result.findings.filter((finding) => finding.rule === id).map((finding) => finding.match.captures.ruleId)
    expect(byRule("print")).toEqual(["T201"])
    expect(byRule("imports")).toEqual(["F401"])
    expect(byRule("both").sort()).toEqual(["F401", "T201"])
    expect(byRule("other-file")).toEqual([])
  })

  test("tools run independently: a missing one fails only its own rules", async () => {
    const root = await createProject({ "src/a.js": JS, "app/a.py": PY })
    await linkTool(root, "oxlint")
    const result = await run(root, [
      ruleFor("js", { tool: "oxlint", rules: ["no-debugger"] }, ["src/a.js"]),
      ruleFor("py", { tool: "ruff" }, ["app/a.py"]),
    ])
    expect(result.findings.map((finding) => finding.rule)).toEqual(["js"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.rule).toBe("py")
    expect(result.errors[0]!.message).toContain("ruff")
    // Never a whole-run error: that would take oxlint down with it.
    expect(result.errors.every((error) => error.rule !== null)).toBe(true)
  })

  test("unreadable tool output fails that tool's rules", async () => {
    const root = await createProject({ "app/a.py": PY })
    await stubTool(root, "ruff")
    await writeFile(path.join(root, "node_modules", ".bin", "ruff.recording.json"), "not json")
    const result = await run(root, [ruleFor("py", { tool: "ruff" }, ["app/a.py"])])
    expect(result.findings).toEqual([])
    expect(result.errors[0]!.message).toContain("ruff output is not JSON")
  })

  test("eslint runs on a verify event and its findings carry the source they point at", async () => {
    const root = await createProject({ "src/a.js": JS })
    await stubTool(root, "eslint")
    const result = await run(root, [ruleFor("js", { tool: "eslint", rules: ["no-console"] }, ["src/a.js"])])
    expect(await stubArgv(root, "eslint")).toBe("--format=json --no-error-on-unmatched-pattern -- src/a.js")
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.match).toMatchObject({
      file: "src/a.js",
      line: 1,
      column: 1,
      // eslint reported columns 1–12 (endColumn is exclusive), so the excerpt is "console.log".
      text: "console.log",
      captures: { ruleId: "no-console", message: "Unexpected console statement." },
    })
  })

  test("a tool whose rules select no files does not run", async () => {
    const root = await createProject({})
    await stubTool(root, "ruff")
    expect(await run(root, [ruleFor("py", { tool: "ruff" }, [])])).toEqual({ findings: [], errors: [] })
  })

  test("no rules is an empty result", async () => {
    expect(await run(await createProject({}), [])).toEqual({ findings: [], errors: [] })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/linter/detector.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the detector**

`packages/rulecast/src/detectors/linter/detector.ts`:
```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { readSourceFile } from "../../core/detection/per-rule"
import { lineStarts, offsetAt } from "../../core/detection/positions"
import { errorMessage, isNotFound } from "../../core/errors"
import type { Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import { resolveTool } from "./resolve"
import { type LinterConfig, linterSchema, type ToolName } from "./schema"
import { type LinterFinding, TOOLS } from "./tools"

const exec = promisify(execFile)

/** Reads each file of the union once, for {{text}}. */
function sourceReader(cwd: string): (file: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>()
  return (file) => {
    let source = cache.get(file)
    if (source === undefined) {
      source = readSourceFile(cwd, file)
      cache.set(file, source)
    }
    return source
  }
}

/** The source a finding points at; "" when the file is gone or the range is empty. */
function excerpt(source: string | null, finding: LinterFinding): string {
  if (source === null) return ""
  const starts = lineStarts(source)
  const from = offsetAt(starts, finding.line, finding.column, source.length)
  const to =
    finding.endColumn === null
      ? offsetAt(starts, finding.endLine + 1, 1, source.length)
      : offsetAt(starts, finding.endLine, finding.endColumn, source.length)
  return source.slice(from, Math.max(from, to)).replace(/\n$/, "")
}

async function runTool(tool: ToolName, files: string[], cwd: string, signal: AbortSignal): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, cwd)
  const args = [...resolved.prefix, ...TOOLS[tool].args(files)]
  let stdout: string
  try {
    // Linters exit non-zero when they find something; the output is the answer, not the exit code.
    ;({ stdout } = await exec(resolved.command, args, { cwd, signal, maxBuffer: 64 * 1024 * 1024 }))
  } catch (error) {
    if (signal.aborted) throw error
    if (isNotFound(error)) throw new Error(`${tool} is not installed`)
    const failure = error as { stdout?: string }
    if (typeof failure.stdout !== "string") throw error
    stdout = failure.stdout
  }
  return TOOLS[tool].parse(stdout, cwd)
}

export const linterDetector: Detector<LinterConfig> = {
  kind: "linter",
  schema: linterSchema,
  captures: () => ["message", "ruleId"],
  // A copy: compileRule stores this as the rule's stages, and module-level data must not escape into it.
  events: (config) => [...TOOLS[config.tool].events],
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const byTool = new Map<ToolName, DetectorRuleInput<LinterConfig>[]>()
    for (const rule of input.rules) {
      byTool.set(rule.config.tool, [...(byTool.get(rule.config.tool) ?? []), rule])
    }
    const read = sourceReader(input.cwd)

    await Promise.all(
      [...byTool].map(async ([tool, rules]) => {
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        if (files.length === 0) return
        let findings: LinterFinding[]
        try {
          findings = await runTool(tool, files, input.cwd, input.signal)
        } catch (error) {
          if (input.signal.aborted) throw error
          // One error per rule: a whole-run error would disable the other tools too.
          const message = errorMessage(error)
          for (const rule of rules) result.errors.push({ rule: rule.id, message })
          return
        }
        for (const finding of findings) {
          const match: Match = {
            file: finding.file,
            line: finding.line,
            endLine: finding.endLine,
            column: finding.column,
            text: excerpt(await read(finding.file), finding),
            captures: { message: finding.message, ruleId: finding.ruleId },
          }
          for (const rule of rules) {
            if (!rule.files.includes(finding.file)) continue
            if (rule.config.rules && !rule.config.rules.includes(finding.ruleId)) continue
            result.findings.push({ rule: rule.id, match })
          }
        }
      }),
    )
    return result
  },
}
```

- [ ] **Step 4: Register both detectors**

`packages/rulecast/src/detectors/index.ts`:
```ts
import type { AnyDetector } from "../core/detection/registry"
import { astGrepDetector } from "./ast-grep/detector"
import { commandDetector } from "./command/detector"
import { linterDetector } from "./linter/detector"
import { pathDetector } from "./path"
import { regexDetector } from "./regex"

export const builtinDetectors: readonly AnyDetector[] = [
  regexDetector,
  pathDetector,
  astGrepDetector,
  commandDetector,
  linterDetector,
]
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run test/detectors/linter/detector.test.ts` → passes.
Run: `pnpm test` and `pnpm typecheck` → clean.

The oxlint test runs the real binary. If it reports rule ids other than `no-debugger`/`no-unused-vars`, oxlint's default rule set has moved: update the **recording and the assertion together**, and say so when reporting the task.

- [ ] **Step 6: Commit**

`feat: the linter detector for ruff, oxlint and eslint`

---

### Task 8: The opt-in live suite, and the spec

**Files:**
- Create: `test/detectors/linter/live.test.ts`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §6, §15

**Behaviour:** With `RULECAST_LINTERS=1`, every tool that is actually installed is run for real and its output is parsed by the same adapter, so a recording that has drifted from its tool is caught deliberately rather than by surprise.

- [ ] **Step 1: Write the suite**

`packages/rulecast/test/detectors/linter/live.test.ts`:
```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"

import { resolveTool } from "../../../src/detectors/linter/resolve"
import type { ToolName } from "../../../src/detectors/linter/schema"
import { TOOLS } from "../../../src/detectors/linter/tools"
import { createProject } from "../../helpers/project"

const exec = promisify(execFile)

interface Live {
  tool: ToolName
  files: Record<string, string>
  file: string
  /** A rule id the tool must report, so a silent "no findings" cannot pass. */
  ruleId: string
  /** Files the project needs for the tool to run at all. */
  config?: Record<string, string>
}

const LIVE: Live[] = [
  {
    tool: "ruff",
    files: { "app/a.py": "import os\nprint('x')\n" },
    file: "app/a.py",
    ruleId: "F401",
    config: { "pyproject.toml": "[tool.ruff.lint]\nselect = ['F', 'T20']\n" },
  },
  { tool: "oxlint", files: { "src/a.js": "debugger\n" }, file: "src/a.js", ruleId: "no-debugger" },
  {
    tool: "eslint",
    files: { "src/a.js": 'console.log("x")\n' },
    file: "src/a.js",
    ruleId: "no-console",
    config: { "eslint.config.js": 'export default [{ rules: { "no-console": "error" } }]\n' },
  },
]

/**
 * Opt in with RULECAST_LINTERS=1. ruff and eslint are recorded under test/payloads/linter/ because
 * they cannot be workspace devDependencies (plan 5b, Decision 1); this is where the recordings are
 * checked against the real tools. A tool that is not installed on this machine is skipped by name.
 */
describe.runIf(process.env.RULECAST_LINTERS === "1")("live linters", () => {
  for (const live of LIVE) {
    test(`${live.tool} reports ${live.ruleId} and parses`, async () => {
      const root = await createProject({ ...live.files, ...live.config })
      const resolved = await resolveTool(live.tool, root)
      const installed = await exec(resolved.command, [...resolved.prefix, "--version"], { cwd: root })
        .then(() => true)
        .catch(() => false)
      if (!installed) {
        console.log(`skipping ${live.tool}: not installed`)
        return
      }
      const args = [...resolved.prefix, ...TOOLS[live.tool].args([live.file])]
      const { stdout } = await exec(resolved.command, args, { cwd: root }).catch(
        (error: { stdout?: string }) => error as { stdout: string },
      )
      const findings = TOOLS[live.tool].parse(stdout, root)
      expect(findings.map((finding) => finding.ruleId)).toContain(live.ruleId)
      expect(findings.every((finding) => finding.file === live.file)).toBe(true)
      expect(findings.every((finding) => finding.line >= 1 && finding.column >= 1)).toBe(true)
    }, 60_000)
  }
})
```

- [ ] **Step 2: Run it**

Run: `RULECAST_LINTERS=1 pnpm vitest run test/detectors/linter/live.test.ts`
Expected: oxlint passes for real. ruff and eslint pass if installed, otherwise they log `skipping <tool>: not installed` and pass. Record which of the three actually ran when reporting the task.

Run: `pnpm test` → the suite is skipped; the skipped count rises from 1 to 4.

- [ ] **Step 3: Update the spec**

In §6, replace the `command` paragraph's first sentence:
```
Runs the command once per rule via `perRule`, with the rule's files substituted for `{{files}}` (or appended).
```
with:
```
Runs the command once per rule via `perRule`, with the rule's files replacing the argv element that is exactly `{{files}}`, or appended when there is none. A rule that selects no files does not run. `sarif` captures are read from a result's `properties`, falling back to the result itself.
```

In §6's `linter` paragraph, replace `resolved from the project (`node_modules/.bin`, `uv run`, then `PATH`)` with:
```
resolved from the project: `node_modules/.bin`, then `uv run` for a Python tool in a project with a `pyproject.toml`, then `PATH`. `{{text}}` is the source the finding points at. A tool that cannot run disables its own rules only, never the other tools in the same run.
```

In §15, insert a new bullet immediately **before** the `- **End to end:**` bullet — not next to the two contract-suite bullets, which plan 5c replaces as one block:
```
- **Linters:** oxlint runs for real (a devDependency, symlinked into the fixture's `node_modules/.bin`); ruff and eslint are replayed from recordings under `test/payloads/linter/`, with `RULECAST_LINTERS=1` running whichever real binaries the machine has and checking the recordings still describe them.
```

- [ ] **Step 4: Verify**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint` → all clean.

- [ ] **Step 5: Commit**

`test: opt-in live linter suite, and document how linters are tested`

---

## End-to-end verification

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` from the repository root — all clean. Skipped count is 4 (the perf suite plus three live linter tests), or 5 when `bun` is missing.
- [ ] `pnpm test:perf` — p95 still under 500 ms. The perf fixture gains its linter and command rules in 5c, so this run should look like 5a's.
- [ ] A hand check of both detectors together, from a scratch directory:

```bash
cd "$(mktemp -d)" && git init -q . && mkdir -p src
ln -s <path-to-repo>/packages/rulecast/node_modules/.bin/oxlint "$(mkdir -p node_modules/.bin && echo node_modules/.bin)/oxlint"
cat > check.sh <<'SH'
#!/bin/sh
echo '[{"file":"src/a.js","line":1,"layer":"ui"}]'
SH
chmod +x check.sh
cat > .rulecast-config.yaml <<'YAML'
repos:
  - repo: local
    rules:
      - id: no-debugger
        name: No debugger
        files: '\.js$'
        detect:
          linter: { tool: oxlint, rules: [no-debugger] }
        message: '{{file}}:{{line}} {{ruleId}}: {{message}}'
      - id: layers
        name: Layers
        files: '\.js$'
        detect:
          command:
            run: ["./check.sh", "{{files}}"]
            captures: [layer]
        message: '{{file}}:{{line}} belongs to {{layer}}'
YAML
printf 'debugger\n' > src/a.js
node <path-to-repo>/packages/rulecast/dist/cli.js run --all-files --format agent; echo "exit=$?"
```
Expected: both rules report on `src/a.js:1` — `no-debugger: \`debugger\` statement is not allowed` and `belongs to ui` — and `exit=1`.

- [ ] `ls ~/.cache/rulecast` is still absent.
- [ ] Everything pushed to `main`.
