# rulecast Plan 5c — Exported contract suites, the perf fixture and the docs Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the detector and adapter contracts as runnable suites a third party can point at their own plugin, run rulecast's own five detectors and its adapter through them, and bring the perf fixture and the agent docs up to the five detectors that now exist.

**Architecture:** A contract suite is a plain function that returns `{ name, run() }` cases which throw `node:assert` errors. No test framework is imported, so `@syv-ai/rulecast` does not drag vitest into anyone's dependency tree and the suites run under vitest, node:test or anything else. rulecast's own tests loop the cases inside `test.each`. Each built-in detector supplies a fixture — files, a config that matches, and a config that fails — which is also the worked example a third party copies. Spec §6 (the contract), §15 (both suites), §13 (the perf fixture).

**Tech Stack:** Node ≥ 20.12, TypeScript 5, vitest, `node:assert/strict`.

Prerequisite: `2026-09-20-rulecast-05a-ast-grep.md` and `05b-command-linter.md` are done. This is the last part of plan 5; the handoff at the end sets up plan 6 (the `llm` detector).

---

## Decisions this plan implements

1. **The suites are framework-free.** They return cases, they do not call `describe`/`test`, and they assert with `node:assert/strict`. A suite that imported vitest would make vitest a runtime dependency of the published package, and would stop anyone using node:test from running it.

2. **A fixture is part of the contract, not an afterthought.** `detectorContract` needs a config that matches something and, optionally, one that fails, because there is no way to check "a per-rule error does not affect the other rules" without a rule that errors. Each built-in detector ships its fixture in `test/detectors/fixtures.ts`, which doubles as the documentation of what a third-party detector has to provide.

3. **The suites create their own temp project.** A third party should be able to call one function. `prepare(root)` is the hook for a fixture that needs more than files — `linter` uses it to symlink oxlint into `node_modules/.bin`.

4. **The perf fixture uses oxlint where spec §13 says `ruff`** (plan 5b, Decision 1: ruff cannot be a workspace devDependency). Task 5 updates the spec line rather than leaving the document and the fixture disagreeing. Thirty rules: 12 `regex`, 5 `path`, 8 `ast-grep`, 4 `linter` (oxlint) and 1 `command`.

5. **The adapter suite's parse cases are shape and purity checks, not snapshots.** The fixture records `expected` from the adapter itself, so "parses each recorded payload to its event" cannot fail on its own; what it pins is that parsing stays pure and the events stay well formed. The expected events themselves are asserted by hand in `test/adapters/claude-code/parse.test.ts`, which stays the authority. A second adapter's fixture would be written by hand and the case becomes a real one.

6. **The adapter suite runs over `ADAPTERS`,** which holds exactly one adapter today. Its value is for 0.2's Codex, Cursor and OpenCode adapters (spec §17) — writing it now, while the one known-good adapter can pin the behaviour, is the point.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`, and a spawned CLI must get it in the child's env.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause. Biome runs with `--error-on-warnings`, and `noDynamicNamespaceImportAccess` forbids indexing a namespace import as `ns[name]`.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout. Check that `git commit` exited 0; don't filter its output.
- Commit after every task. Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`. The others are relative to the repository root.

| File | Responsibility |
|---|---|
| `src/testing/contract.ts` | `ContractCase`, and the temp-project helper both suites use |
| `src/testing/detector-contract.ts` | `detectorContract(detector, fixture)` (spec §6) |
| `src/testing/adapter-contract.ts` | `adapterContract(adapter, fixture)` (spec §15) |
| `src/index.ts` | Exports both suites and their types |
| `src/detectors/path.ts` | Observes `signal`, which the contract requires and it never did |
| `test/detectors/fixtures.ts` | One `DetectorFixture` per built-in detector |
| `test/detectors/contract.test.ts` | Every built-in detector through the suite |
| `test/adapters/contract.test.ts` | Every adapter in `ADAPTERS` through the suite |
| `test/build.test.ts` | `dist/index.js` exports the suites and imports no test framework |
| `test/perf/edit-hook.test.ts` | The 30-rule fixture of Decision 4 |
| `agents/reference/detectors.md` | `ast-grep`, `command` and `linter` documented; only `llm` left under "Coming later" |
| `docs/specs/2026-09-15-rulecast-design.md` | §13 (perf fixture tools), §15 (what each suite checks) |
| `docs/plans/2026-09-15-rulecast-00-index.md` | Row 5 → Done |

## Not in this plan

- **The `llm` detector**: plan 6, whose plan is also still to be written. The handoff at the end of this plan sets it up.
- **`rulecast doctor`** and the standalone binary's release pipeline: plan 7.
- **A `rulecast test` command** that runs a rule's inline good/bad examples: spec §17 puts it in 0.2. The contract suites are for detector authors; that one is for rule authors.
- **Publishing the agent docs' raw GitHub URLs.** They stay inert until the repository is public (plan 7); `test/agents-docs.test.ts` checks paths, not the network.

---

### Task 1: The detector contract suite

**Files:**
- Create: `src/testing/contract.ts`, `src/testing/detector-contract.ts`
- Test: covered by Task 3, which runs the real detectors through it

**Behaviour:** `detectorContract(detector, fixture)` returns the cases of spec §6: batching attribution, per-rule and whole-run errors, declared captures on every match, abort handling, empty input.

- [ ] **Step 1: Write the shared pieces**

`packages/rulecast/src/testing/contract.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/** One contract check. `run` throws (node:assert) when the check fails. */
export interface ContractCase {
  name: string
  run(): Promise<void>
}

/** Writes files (repo-relative path → content) into a fresh temp directory and returns its path. */
export async function contractProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rulecast-contract-"))
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return root
}
```

- [ ] **Step 2: Write the suite**

`packages/rulecast/src/testing/detector-contract.ts`:
```ts
import assert from "node:assert/strict"

import { memoryCache } from "../core/detection/cache"
import type { AnyDetector } from "../core/detection/registry"
import type { DetectorEvent, DetectorResult } from "../core/types"
import { type ContractCase, contractProject } from "./contract"

export interface DetectorFixture {
  /** Files the project needs, repo-relative. */
  files: Record<string, string>
  /** Anything the project needs beyond files — a symlinked binary, say. */
  prepare?(root: string): Promise<void>
  /** A detect config that matches at least once in `matching`. */
  config: unknown
  /** The files the matching config selects. */
  matching: string[]
  /**
   * A config the schema accepts but that fails at run time, to check that one rule's failure
   * leaves the others alone. Omit it and that case is skipped.
   */
  failing?: { config: unknown; matching?: string[] }
}

const EVENTS: DetectorEvent[] = ["edit", "verify"]

async function configOf(detector: AnyDetector, value: unknown, where: string): Promise<unknown> {
  const parsed = await detector.schema.safeParseAsync(value)
  assert.ok(parsed.success, `${where} config must pass the detector's own schema`)
  return parsed.data
}

function run(detector: AnyDetector, rules: unknown[], cwd: string, signal: AbortSignal): Promise<DetectorResult> {
  return detector.run({
    event: "edit",
    // biome-ignore lint/suspicious/noExplicitAny: the registry erases each detector's config type.
    rules: rules as any,
    changes: new Map(),
    cache: memoryCache(),
    cwd,
    signal,
  })
}

function assertResultShape(result: DetectorResult, ids: string[]): void {
  assert.ok(Array.isArray(result.findings), "result.findings must be an array")
  assert.ok(Array.isArray(result.errors), "result.errors must be an array")
  for (const finding of result.findings) {
    assert.ok(ids.includes(finding.rule), `finding names rule "${finding.rule}", which was not in the run`)
    const { match } = finding
    assert.equal(typeof match.file, "string", "match.file must be a string")
    for (const key of ["line", "endLine", "column"] as const) {
      assert.ok(Number.isInteger(match[key]) && match[key] >= 1, `match.${key} must be a 1-based integer`)
    }
    assert.ok(match.endLine >= match.line, "match.endLine must not precede match.line")
    assert.equal(typeof match.text, "string", "match.text must be a string")
  }
  for (const error of result.errors) {
    assert.ok(error.rule === null || ids.includes(error.rule), `error names rule "${error.rule}", not in the run`)
    assert.equal(typeof error.message, "string", "error.message must be a string")
  }
}

/**
 * The detector contract of spec §6, as cases any test runner can drive:
 *
 *   for (const testCase of detectorContract(myDetector, myFixture)) test(testCase.name, testCase.run)
 */
export function detectorContract(detector: AnyDetector, fixture: DetectorFixture): ContractCase[] {
  const project = async () => {
    const root = await contractProject(fixture.files)
    await fixture.prepare?.(root)
    return root
  }
  const rule = (id: string, config: unknown, files: string[]) => ({ id, config, files, context: [] })
  const open = () => new AbortController().signal

  const cases: ContractCase[] = [
    {
      name: "declares a kind, captures and events",
      async run() {
        assert.ok(detector.kind.length > 0, "kind must not be empty")
        const config = await configOf(detector, fixture.config, "the fixture's")
        const captures = detector.captures(config)
        assert.ok(Array.isArray(captures), "captures(config) must return an array")
        for (const name of captures) assert.equal(typeof name, "string", "a capture name must be a string")
        const events = detector.events(config)
        assert.ok(events.length > 0, "events(config) must name at least one event")
        for (const event of events) assert.ok(EVENTS.includes(event), `unknown event "${event}"`)
      },
    },
    {
      name: "no rules is an empty result",
      async run() {
        const result = await run(detector, [], await project(), open())
        assert.deepEqual(result, { findings: [], errors: [] })
      },
    },
    {
      name: "every match carries exactly the declared captures, as strings",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const declared = [...detector.captures(config)].sort()
        const result = await run(detector, [rule("a", config, fixture.matching)], await project(), open())
        assert.deepEqual(result.errors, [], "the fixture's matching config must not error")
        assert.ok(result.findings.length > 0, "the fixture's matching config must produce at least one finding")
        assertResultShape(result, ["a"])
        for (const finding of result.findings) {
          const present = Object.keys(finding.match.captures).sort()
          assert.deepEqual(present, declared, "captures must be exactly the declared names")
          for (const value of Object.values(finding.match.captures)) {
            assert.equal(typeof value, "string", "every capture must be a string")
          }
        }
      },
    },
    {
      name: "batching attributes the same work to every rule that asked for it",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const rules = [rule("a", config, fixture.matching), rule("b", config, fixture.matching)]
        const result = await run(detector, rules, await project(), open())
        assert.deepEqual(result.errors, [], "two identical rules must not error")
        assertResultShape(result, ["a", "b"])
        const forRule = (id: string) => result.findings.filter((finding) => finding.rule === id)
        assert.ok(forRule("a").length > 0, "rule a must get findings")
        assert.equal(forRule("b").length, forRule("a").length, "identical rules must get the same findings")
      },
    },
    {
      name: "an aborted run produces nothing",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const controller = new AbortController()
        controller.abort()
        const rules = [rule("a", config, fixture.matching)]
        const result = await run(detector, rules, await project(), controller.signal).catch(() => null)
        // Either the run threw (the core marks it timed out) or it returned without findings.
        if (result !== null) assert.deepEqual(result.findings, [], "an aborted run must not report findings")
      },
    },
  ]

  if (fixture.failing) {
    const failing = fixture.failing
    cases.push({
      name: "a rule that fails does not take the others with it",
      async run() {
        const good = await configOf(detector, fixture.config, "the fixture's")
        const bad = await configOf(detector, failing.config, "the fixture's failing")
        const rules = [
          rule("bad", bad, failing.matching ?? fixture.matching),
          rule("good", good, fixture.matching),
        ]
        const result = await run(detector, rules, await project(), open())
        assertResultShape(result, ["bad", "good"])
        assert.ok(
          result.errors.some((error) => error.rule === "bad"),
          "the failing rule must produce an error naming it",
        )
        assert.ok(
          !result.errors.some((error) => error.rule === null),
          "one rule's failure must not be reported as a whole-run error",
        )
        assert.ok(
          result.findings.some((finding) => finding.rule === "good"),
          "the healthy rule must still report its findings",
        )
      },
    })
  }

  return cases
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck` → clean. Task 3 is what runs it.

- [ ] **Step 4: Commit**

`feat: export the detector contract suite`

---

### Task 2: The adapter contract suite

**Files:**
- Create: `src/testing/adapter-contract.ts`
- Test: covered by Task 3

**Behaviour:** `adapterContract(adapter, fixture)` checks spec §15's adapter contract: recorded payloads parse to the expected events, `Delivery` formats to stable output, unknown input is `null` and never an exception, and `install` round-trips.

- [ ] **Step 1: Write the suite**

`packages/rulecast/src/testing/adapter-contract.ts`:
```ts
import assert from "node:assert/strict"

import { type Adapter, type AdapterInput, type Delivery, type Event, emptyDelivery } from "../core/types"
import type { ContractCase } from "./contract"

export interface AdapterFixture {
  /** Recorded hook inputs and what the adapter must make of each. */
  payloads: { name: string; input: unknown; expected: AdapterInput | null }[]
  /** Deliveries the adapter must be able to format, with the event each belongs to. */
  deliveries: { name: string; delivery: Delivery; event: Event }[]
  /** Settings objects `install.merge` must round-trip. Ignored when the adapter has no install. */
  settings?: unknown[]
}

const FORMAT_OPTIONS = { maxMatchesPerRule: 3 }

/** Inputs no adapter handles. Parsing one must return null, not throw. */
const NONSENSE: unknown[] = [null, undefined, 0, "", "not json", [], {}, { hook_event_name: "NoSuchEvent" }]

export function adapterContract(adapter: Adapter, fixture: AdapterFixture): ContractCase[] {
  const cases: ContractCase[] = [
    {
      name: "describes itself",
      async run() {
        assert.ok(adapter.name.length > 0, "name must not be empty")
        assert.ok(adapter.label.length > 0, "label must not be empty")
        assert.ok(
          adapter.maxContextChars === null || adapter.maxContextChars > 0,
          "maxContextChars must be null or positive",
        )
        assert.ok(Number.isInteger(adapter.restoredFiles) && adapter.restoredFiles >= 0, "restoredFiles must be >= 0")
      },
    },
    {
      name: "returns null for input it does not handle, and never throws",
      async run() {
        for (const input of NONSENSE) {
          const parsed = adapter.parse(input)
          assert.equal(parsed, null, `parse(${JSON.stringify(input)}) must be null`)
        }
      },
    },
    {
      name: "parses each recorded payload to its event",
      async run() {
        assert.ok(fixture.payloads.length > 0, "an adapter fixture needs at least one recorded payload")
        for (const { name, input, expected } of fixture.payloads) {
          assert.deepEqual(adapter.parse(input), expected, `payload ${name}`)
        }
      },
    },
    {
      name: "parsing is pure: the same payload parses the same twice",
      async run() {
        for (const { name, input } of fixture.payloads) {
          assert.deepEqual(adapter.parse(input), adapter.parse(input), `payload ${name}`)
        }
      },
    },
    {
      name: "every parsed event is well formed",
      async run() {
        for (const { name, input } of fixture.payloads) {
          const event = adapter.parse(input)?.event
          if (!event) continue
          assert.ok(event.cwd.length > 0, `${name}: event.cwd must not be empty`)
          for (const file of event.files) assert.equal(typeof file, "string", `${name}: files must be strings`)
          if (event.kind === "prompt" || event.kind === "reset") {
            assert.deepEqual(event.files, [], `${name}: ${event.kind} carries no files`)
          }
        }
      },
    },
    {
      name: "formats each delivery deterministically, with an exit code of 0 or 1",
      async run() {
        for (const { name, delivery, event } of fixture.deliveries) {
          const first = adapter.format(delivery, event, FORMAT_OPTIONS)
          const second = adapter.format(delivery, event, FORMAT_OPTIONS)
          assert.deepEqual(first, second, `${name}: formatting must be deterministic`)
          assert.equal(typeof first.stdout, "string", `${name}: stdout must be a string`)
          assert.ok([0, 1].includes(first.exitCode), `${name}: exit code must be 0 or 1, got ${first.exitCode}`)
        }
      },
    },
    {
      name: "an empty delivery exits 0",
      async run() {
        const event: Event = fixture.deliveries[0]?.event ?? { kind: "edit", files: [], cwd: "/project" }
        const result = adapter.format(emptyDelivery(), event, FORMAT_OPTIONS)
        assert.equal(result.exitCode, 0, "nothing to report must not be a failure")
      },
    },
  ]

  const install = adapter.install
  if (install) {
    cases.push(
      {
        name: "install declares markers, scopes and a command",
        async run() {
          assert.ok(install.markers.length > 0, "markers must not be empty")
          assert.ok(install.scopes.length > 0, "scopes must not be empty")
          for (const { file } of install.scopes) assert.ok(file.length > 0, "a scope needs a settings file")
          assert.notEqual(install.command(true), install.command(false), "a local install runs a different command")
        },
      },
      {
        name: "merge is idempotent and remove undoes it",
        async run() {
          const command = install.command(false)
          for (const settings of fixture.settings ?? [{}]) {
            const original = structuredClone(settings)
            const once = install.merge(structuredClone(original), command, 5_000)
            assert.ok(once.added.length > 0, "merging into fresh settings must add hooks")
            const twice = install.merge(structuredClone(once.settings), command, 5_000)
            assert.deepEqual(twice.settings, once.settings, "merging twice must change nothing")
            assert.deepEqual(twice.added, [], "merging twice must add nothing")
            const removed = install.remove(structuredClone(once.settings))
            assert.deepEqual(removed.settings, original, "remove must return the settings merge was given")
            assert.deepEqual(removed.removed.sort(), once.added.sort(), "remove must name what merge added")
          }
        },
      },
    )
  }

  return cases
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck` → clean.

- [ ] **Step 3: Commit**

`feat: export the adapter contract suite`

---

### Task 3: Run rulecast's own detectors and adapter through the suites

**Files:**
- Create: `test/detectors/fixtures.ts`, `test/detectors/contract.test.ts`, `test/adapters/contract.test.ts`
- Modify: `src/index.ts`
- Test: `test/build.test.ts`

**Behaviour:** Every detector in `builtinDetectors` and every adapter in `ADAPTERS` passes its contract. The suites are exported from the package entry and pull in no test framework.

- [ ] **Step 1: Write the fixtures**

`packages/rulecast/test/detectors/fixtures.ts`:
```ts
import { chmod } from "node:fs/promises"
import path from "node:path"

import type { DetectorFixture } from "../../src/testing/detector-contract"
import { linkTool } from "../helpers/linters"

const PY = "import os\n\n\ndef get(id):\n    try:\n        return fetch(id)\n    except ValueError:\n        pass\n"
const JS = 'console.log("hi")\nconst unused = 1\ndebugger\n'

const CHECKER = "#!/bin/sh\necho '[{\"file\":\"app/a.py\",\"line\":1,\"layer\":\"crud\"}]'\n"

/** One fixture per built-in detector. A third-party detector supplies the same shape. */
export const DETECTOR_FIXTURES: Record<string, DetectorFixture> = {
  regex: {
    files: { "app/a.py": PY },
    config: { pattern: "except (?<exception>\\w+):" },
    matching: ["app/a.py"],
    // A pattern the schema accepts cannot fail at run time, so there is no failing case.
  },
  path: {
    files: { "app/a.py": PY },
    config: {},
    matching: ["app/a.py"],
  },
  "ast-grep": {
    files: { "app/a.py": PY },
    config: { language: "python", rule: { pattern: "fetch($$$ARGS)" } },
    matching: ["app/a.py"],
  },
  command: {
    files: { "app/a.py": PY, "check.sh": CHECKER },
    prepare: (root) => chmod(path.join(root, "check.sh"), 0o755),
    config: { run: ["./check.sh", "{{files}}"], captures: ["layer"] },
    matching: ["app/a.py"],
    failing: { config: { run: ["./no-such-command"] } },
  },
  linter: {
    files: { "src/a.js": JS },
    prepare: (root) => linkTool(root, "oxlint"),
    config: { tool: "oxlint", rules: ["no-debugger"] },
    matching: ["src/a.js"],
    // ruff is not installed in the workspace, so the rule fails to resolve its tool.
    failing: { config: { tool: "ruff" }, matching: ["src/a.js"] },
  },
}
```

If `ruff` happens to be installed on the machine running this, the `linter` failing case stops failing and the contract case reports it. Swap the failing config for one whose tool cannot resolve on that machine, or drop `failing` for `linter`, and say so when reporting the task.

- [ ] **Step 2: Write the two contract tests**

`packages/rulecast/test/detectors/contract.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { builtinDetectors } from "../../src/detectors"
import { detectorContract } from "../../src/testing/detector-contract"
import { DETECTOR_FIXTURES } from "./fixtures"

test("every built-in detector has a contract fixture", () => {
  expect(builtinDetectors.map((detector) => detector.kind).sort()).toEqual(Object.keys(DETECTOR_FIXTURES).sort())
})

for (const detector of builtinDetectors) {
  describe(`${detector.kind} detector contract`, () => {
    for (const contractCase of detectorContract(detector, DETECTOR_FIXTURES[detector.kind]!)) {
      test(contractCase.name, () => contractCase.run(), 30_000)
    }
  })
}
```

`packages/rulecast/test/adapters/contract.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { ADAPTERS } from "../../src/adapters"
import type { Event } from "../../src/core/types"
import { adapterContract, type AdapterFixture } from "../../src/testing/adapter-contract"
import { claudeCodePayload } from "../helpers/payloads"

const editEvent: Event = { kind: "edit", files: ["src/math.ts"], cwd: "/project", session: { id: "s1" } }

const claudeCode: AdapterFixture = {
  payloads: ["post-tool-use.read.complete", "post-tool-use.edit", "stop", "user-prompt-submit", "session-start.compact"].map(
    (name) => {
      const input = claudeCodePayload(name)
      // The expected value is the adapter's own answer, recorded once: the point of this case is
      // that it stays the same, and test/adapters/claude-code/parse.test.ts pins what it should be.
      return { name, input, expected: ADAPTERS[0]!.parse(input) }
    },
  ),
  deliveries: [
    {
      name: "one new error finding",
      event: editEvent,
      delivery: {
        findings: [
          {
            rule: "no-silent-except",
            severity: "error",
            status: "new",
            file: "src/math.ts",
            line: 4,
            column: 5,
            message: "src/math.ts:4 swallows an exception.",
            count: 1,
          },
        ],
        preexistingSummary: [],
        references: [{ ref: "conventions/errors.md#swallowed", state: "full", content: "Handle it." }],
        touches: [],
        stop: null,
        warnings: ["one rule was skipped"],
      },
    },
  ],
  // Settings merge must round-trip. An event key holding only rulecast's own groups is dropped on
  // remove (src/adapters/claude-code/settings.ts), so the second fixture keeps a foreign hook —
  // which is the case worth pinning anyway: removing rulecast must not remove the user's hooks.
  settings: [
    {},
    { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] } },
  ],
}

const FIXTURES: Record<string, AdapterFixture> = { "claude-code": claudeCode }

test("every adapter has a contract fixture", () => {
  expect(ADAPTERS.map((adapter) => adapter.name).sort()).toEqual(Object.keys(FIXTURES).sort())
})

for (const adapter of ADAPTERS) {
  describe(`${adapter.name} adapter contract`, () => {
    for (const contractCase of adapterContract(adapter, FIXTURES[adapter.name]!)) {
      test(contractCase.name, () => contractCase.run())
    }
  })
}
```

Recording `expected` from the adapter itself would make the parse cases vacuous on their own — which is why the comment points at `parse.test.ts`, where the expected events are actually asserted. The contract case's job here is the *shape* checks and purity, and for a future adapter the fixture is written by hand.

- [ ] **Step 3: Run them**

Run: `pnpm vitest run test/detectors/contract.test.ts test/adapters/contract.test.ts`

Unlike the other tasks in plan 5 this is not a red-then-green step: the suites exist from Tasks 1–2 and the detectors from 5a and 5b, so these tests may pass first time. What matters is that every case *runs* — check the reported case count is five detectors × 5–6 cases plus the adapter's, not a silently empty loop.

- [ ] **Step 4: Fix what the contract reports**

A genuine contract failure is exactly what this task is for: fix the **detector**, not the contract, unless the contract asserts something the spec does not require. Note any such fix when reporting the task.

**One failure is known in advance.** `src/detectors/path.ts` never calls `signal.throwIfAborted()` — `regex.ts` does, `path.ts` was written without it in plan 1 — so "an aborted run produces nothing" fails for it. Spec §6 says detectors observe `signal`, so the detector is wrong, not the case. Add the check to the file loop:

```ts
  run: perRule(async (rule, input) => {
    const matches: Match[] = []
    for (const file of rule.files) {
      input.signal.throwIfAborted()
      const text = await readSourceFile(input.cwd, file)
```

This is a real defect the contract suite found in shipped code, which is the best argument for the suite existing — say so in the commit body.

- [ ] **Step 5: Export the suites**

Add to `packages/rulecast/src/index.ts`, in the file's alphabetical-ish order:
```ts
export { type AdapterFixture, adapterContract } from "./testing/adapter-contract"
export type { ContractCase } from "./testing/contract"
export { type DetectorFixture, detectorContract } from "./testing/detector-contract"
```

and widen the existing registry export line so a detector author can name the suite's parameter type:

```ts
export { type AnyDetector, createRegistry, type DetectorRegistry } from "./core/detection/registry"
```

- [ ] **Step 6: Assert the published entry stays framework-free**

Add to `packages/rulecast/test/build.test.ts`:
```ts
test("built package exports the contract suites and imports no test framework", async () => {
  const entry = path.resolve("dist/index.js")
  const source = readFileSync(entry, "utf8")
  for (const framework of ["vitest", "node:test", "@jest/globals"]) {
    expect(source, `dist/index.js must not import ${framework}`).not.toContain(`"${framework}"`)
  }
  const exported = await import(pathToFileURL(entry).href)
  expect(typeof exported.detectorContract).toBe("function")
  expect(typeof exported.adapterContract).toBe("function")
}, 30_000)
```

Add the `pathToFileURL` import from `node:url`.

- [ ] **Step 7: Verify**

Run: `pnpm test` and `pnpm typecheck` → clean.

- [ ] **Step 8: Commit**

`feat: run every built-in detector and adapter through the exported contracts`

---

### Task 4: The perf fixture covers all five detectors

**Files:**
- Modify: `test/perf/edit-hook.test.ts`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §13

**Behaviour:** The perf fixture is Decision 4's 30 rules, and p95 over 50 edit events is under 500 ms.

- [ ] **Step 1: Rewrite the fixture**

In `packages/rulecast/test/perf/edit-hook.test.ts`, replace the `RULES` constant and `perfProject()`. `const FILE = "src/feature/orders.ts"` already exists at module scope — keep it, do not re-declare it. The edited file must be one every kind selects, so each event pays every detector.

`RULES` is used twice inside the test body (`forbidden${i % RULES}`), so renaming it to `REGEX_RULES` means updating those two lines too — Step 3 covers that.

```ts
const REGEX_RULES = 12
const PATH_RULES = 5
const AST_RULES = 8
const LINTER_RULES = 4

/** Spec §13: 30 rules across ast-grep, regex, path, a linter and command. */
function perfProject(): Record<string, string> {
  const topics = Array.from({ length: REGEX_RULES }, (_, i) => `## Topic ${i}\n\nGuidance for topic ${i}.\n`)
  const rules: Record<string, unknown>[] = []
  for (let i = 0; i < REGEX_RULES; i++) {
    rules.push({
      id: `perf/regex-${i}`,
      name: `Regex ${i}`,
      files: "^src/.*\\.ts$",
      detect: { regex: { pattern: `forbidden${i}\\((?<arg>[^)]*)\\)` } },
      message: `{{file}}:{{line}} calls forbidden${i}({{arg}}).`,
      context: [`@conventions/code.md#topic-${i}`],
    })
  }
  for (let i = 0; i < PATH_RULES; i++) {
    rules.push({
      id: `perf/path-${i}`,
      name: `Path ${i}`,
      files: "^generated/",
      severity: "warning",
      detect: { path: {} },
      message: "{{file}} is generated.",
    })
  }
  for (let i = 0; i < AST_RULES; i++) {
    rules.push({
      id: `perf/ast-${i}`,
      name: `Structure ${i}`,
      files: "^src/.*\\.ts$",
      severity: "warning",
      detect: { "ast-grep": { language: "typescript", rule: { pattern: `banned${i}($$$ARGS)` } } },
      message: `{{file}}:{{line}} calls banned${i}({{ARGS}}).`,
    })
  }
  for (let i = 0; i < LINTER_RULES; i++) {
    rules.push({
      id: `perf/lint-${i}`,
      name: `Lint ${i}`,
      files: "^src/.*\\.ts$",
      severity: "warning",
      detect: { linter: { tool: "oxlint" } },
      message: "{{file}}:{{line}} {{ruleId}}: {{message}}",
    })
  }
  rules.push({
    id: "perf/command",
    name: "Command",
    files: "^src/.*\\.ts$",
    severity: "warning",
    detect: { command: { run: ["./perf-check.sh", "{{files}}"], captures: ["layer"] } },
    message: "{{file}}:{{line}} belongs to {{layer}}.",
  })
  return {
    ".rulecast-config.yaml": localConfig(rules),
    "conventions/code.md": ["# Code", "", ...topics].join("\n"),
    [FILE]: `${Array.from({ length: 300 }, (_, i) => `export const value${i} = compute(${i})`).join("\n")}\n`,
    "generated/client.ts": "export const client = 1\n",
    "perf-check.sh": '#!/bin/sh\necho \'[{"file":"src/feature/orders.ts","line":1,"layer":"feature"}]\'\n',
  }
}
```

The rule count is `12 + 5 + 8 + 4 + 1 = 30`.

- [ ] **Step 2: Prepare the fixture's tools**

In the test body, after `createRepo(perfProject())`, make the checker executable and link oxlint:
```ts
    const root = await createRepo(perfProject())
    await chmod(path.join(root, "perf-check.sh"), 0o755)
    await linkTool(root, "oxlint")
```
Add the imports (`chmod` from `node:fs/promises`, `linkTool` from `../helpers/linters`).

- [ ] **Step 3: Point the test body's two `RULES` uses at `REGEX_RULES`**

Inside the 50-event loop:
```ts
      appendFileSync(path.join(root, FILE), `export const added${i} = forbidden${i % REGEX_RULES}(${i})\n`)
      const { ms, stdout } = runHook(root, payload("post-tool-use.edit"))
      expect(stdout).toContain(`forbidden${i % REGEX_RULES}(${i})`)
```
Leaving `RULES` behind is `TS2304: Cannot find name 'RULES'`, which `pnpm typecheck` catches before the perf run does.

- [ ] **Step 4: Run it**

Run: `pnpm test:perf`
Expected: PASS, with `edit hook: p50 <n> ms, p95 <n> ms` logged.

Record both numbers. The reference points are plan 3's **82 / 105 ms** and plan 4's **83 / 91 ms**, both with `regex` and `path` only. This fixture adds, per edit event, one oxlint process (~70 ms measured standalone on an Apple M3 Pro), one shell process and the ast-grep native module (~9 ms under Node, including registering Python). Detector kinds run in parallel (spec §6), so expect p95 somewhere around 150–250 ms — well under the 500 ms gate, but clearly above plan 4.

If p95 is over 500 ms, do not raise the gate. Find out which kind is responsible first: run the hook with only the oxlint rules, then only the ast-grep rules, and compare.

- [ ] **Step 5: Update the spec**

In §13, replace:
```
**Perf test.** CI runs a fixture project with 30 rules across ast-grep, regex, path, ruff and command, replays 50 edit events, and fails if p95 exceeds 500 ms.
```
with:
```
**Perf test.** CI runs a fixture project with 30 rules across ast-grep, regex, path, `linter` (oxlint — the one linter that can be a workspace devDependency, §15) and command, replays 50 edit events, and fails if p95 exceeds 500 ms.
```

- [ ] **Step 6: Commit**

`test: perf fixture covers all five detectors`

Put the measured p50/p95 in the commit body.

---

### Task 5: Document the detectors for agents

**Files:**
- Modify: `agents/reference/detectors.md`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §15
- Test: `test/agents-docs.test.ts` (no change expected; it must stay green)

**Behaviour:** An agent drafting rules from `agents/DRAFT-RULES.md` can write `ast-grep`, `command` and `linter` rules correctly from the reference alone, and only `llm` is still listed as coming.

- [ ] **Step 1: Read the doc and match its voice**

Read `agents/reference/detectors.md` in full first. Each existing section is: a YAML example, then a bullet per key, then `Captures:` and `Default stages:`. Keep that shape exactly.

- [ ] **Step 2: Add the three sections**

Insert `## ast-grep`, `## command` and `## linter` after `## path`, before `## Coming later`. Each needs:

- **`ast-grep`** — the YAML example from spec §6; `language` and its six values, with a note that `tsx` covers `.jsx` too; `rule` pointing at `https://ast-grep.github.io/reference/rule.html`; `constraints` and `utils`; captures (`$NAME` → `{{NAME}}`, `$$$NAMES` joined with `, `, `$_NAME` non-capturing); that `{{text}}` is the matched node's source; default stages `edit`, `verify`. Include the contextual-pattern form, because it is the one an agent will not guess:
  ```yaml
  rule:
    pattern:
      context: '<div style={{ $$$PROPS }}/>'
      selector: jsx_attribute
  ```
  and say what it is for: matching a node that is not a whole statement.
- **`command`** — the YAML example from spec §6; `run` and the `{{files}}` rule (an argv element that is exactly `{{files}}`, otherwise appended); `output: json | sarif` with the exact JSON result shape (`{ file, line, endLine?, column?, text?, ...captures }`) and where SARIF captures come from (`properties`); that the exit code is ignored and unparseable output disables the rule; that a rule selecting no files runs nothing; captures as declared; default stages `edit`, `verify`.
- **`linter`** — the YAML example; `tool` (`ruff`, `oxlint`, `eslint`) and how each is found (`node_modules/.bin`, then `uv run` for ruff in a project with a `pyproject.toml`, then `PATH`); `rules` as linter rule ids, omitted meaning every finding; that one process runs per tool per event over all its rules' files; captures `message` and `ruleId`; `{{text}}` is the source the linter pointed at; default stages `edit`, `verify` — **except eslint, which is `verify` only** because it is slow, with a note that `stages: [edit, verify]` opts in.

- [ ] **Step 3: Shrink "Coming later"**

Replace that section with one about `llm` only, in the same spirit as the current text: designed but not in this version, `rulecast validate` reports `unknown detector`, and what to use instead until then.

- [ ] **Step 4: Update the spec's testing section**

In §15, replace these two adjacent bullets (plan 5b inserted its `- **Linters:**` bullet further down, just before `- **End to end:**`, so these two are still next to each other):
```
- **Detector contract suite** (exported): batching attribution, per-rule and whole-run errors, declared captures present on every match, abort handling, empty input. Plus fixture cases per built-in detector.
- **Adapter contract suite** (exported): recorded payloads → `Event` snapshots; `Delivery` → output snapshots.
```
with:
```
- **Detector contract suite** (exported as `detectorContract`): a detector plus a fixture (files, a matching config, optionally a failing one) becomes cases asserting declared kind/captures/events, empty input, exactly the declared captures on every match as strings, batching attribution, abort handling, and that one rule's failure is a per-rule error that leaves the others working. Framework-free — the cases throw `node:assert` errors — so the published package never depends on a test runner. Every built-in detector runs them, with its fixture in `test/detectors/fixtures.ts`. Whole-run errors (`rule: null`) are the core's side of the contract and stay in `test/core/detection/run.test.ts`: the suite only checks that a detector does not raise one for a single rule's failure.
- **Adapter contract suite** (exported as `adapterContract`): self-description, `null` for input it does not handle (never an exception), recorded payloads → the expected `AdapterInput`, parsing is pure, well-formed events, deterministic formatting with an exit code of 0 or 1, an empty `Delivery` exiting 0, and `install.merge` being idempotent with `remove` undoing it.
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run test/agents-docs.test.ts` → passes. It checks that every link and repository URL in `agents/` resolves to a file that exists, so a broken relative link in the new sections fails here.
Run: `pnpm test`, `pnpm typecheck`, `pnpm lint` → clean.

- [ ] **Step 6: Commit**

`docs: document ast-grep, command and linter for agents`

---

### Task 6: Close out plan 5

**Files:**
- Modify: `docs/plans/2026-09-15-rulecast-00-index.md`

**Behaviour:** The index records plan 5 as done, in the shape rows 1–4 use.

- [ ] **Step 1: Update row 5**

Set its Status to `Done (2026-09-20)`, naming the three parts and the tasks each covered, and the perf numbers, in the same shape as rows 3 and 4. For example:

```
Done (2026-09-20), in three parts executed in order: `2026-09-20-rulecast-05a-ast-grep.md` (tasks 1–8), `05b-command-linter.md` (1–8), `05c-contracts-perf.md` (1–6); edit hook p50 <n> ms, p95 <n> ms on an Apple M3 Pro with all five detectors
```

Also update the row's Delivers cell if the plan ended up covering anything it does not mention.

- [ ] **Step 2: Verify and push**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:perf` → all clean.
`git fetch`, then push everything to `main`.

- [ ] **Step 3: Commit**

`docs: mark plan 5 (structural and external detectors) done`

---

## End-to-end verification

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` from the repository root — all clean.
- [ ] `pnpm test:perf` — p95 under 500 ms, recorded in the index and in Task 4's commit body.
- [ ] The five detectors work together in one project. From a scratch directory, write a config with one rule of each kind over the same file, run `rulecast run --all-files --format agent`, and check all five report. Reuse the scratch scripts at the end of 5a and 5b; add the `regex` and `path` rules to the same config.
- [ ] `rulecast validate` rejects a broken rule of each new kind:
  - `detect: { ast-grep: { language: ruby, rule: { pattern: x } } }` → unknown language
  - `detect: { ast-grep: { language: python, rule: { kind: not_a_kind } } }` → the rule does not compile
  - `detect: { command: { run: [] } }` → empty `run`
  - `detect: { linter: { tool: biome } }` → unknown tool
  - a `linter` rule whose message uses `{{oops}}` → unknown template variable

  Each should be exit 2 with a diagnostic naming the rule.
- [ ] `ls ~/.cache/rulecast` is still absent.
- [ ] Everything pushed to `main`.
- [ ] Use the **handoff** skill to set up plan 6 (the `llm` detector), which still needs its plan written.
