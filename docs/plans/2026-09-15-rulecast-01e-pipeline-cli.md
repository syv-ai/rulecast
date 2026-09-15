# rulecast Plan 1e — Pipeline and CLI Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire compile, baseline, detection and session into one pipeline for all five event kinds, and ship `rulecast check` and `rulecast validate`.

**Architecture:** `runPipeline()` handles one `Event` end to end and returns a `Delivery` plus whether rulecast itself failed. The CLI builds `verify` events, formats deliveries as terminal text, agent text, JSON or SARIF, and maps results to exit codes 0/1/2. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3, §7, §12 (CLI), §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, vitest, tsup, `node:util` parseArgs.

Prerequisite: `2026-09-15-rulecast-01d-session-delivery.md` is done. This completes plan 1.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/pipeline.ts` | `runPipeline()` for touch, edit, verify, prompt, reset |
| `src/adapters/cli/format.ts` | Terminal, agent, JSON and SARIF output; exit codes |
| `src/commands/check.ts` | `rulecast check` |
| `src/commands/validate.ts` | `rulecast validate` |
| `src/commands/main.ts` | Argument dispatch, error handling |
| `src/cli.ts` | Executable entry |
| `test/helpers/fixture.ts` | Shared fixture project used by pipeline and CLI tests |

---

### Task 28: Pipeline with session events

**Files:**
- Create: `src/core/pipeline.ts`, `test/helpers/fixture.ts`
- Test: `test/core/pipeline-session.test.ts`

- [ ] **Step 1: Create `test/helpers/fixture.ts`**

```ts
import { createRegistry } from "../../src/core/detection/registry"
import { builtinDetectors } from "../../src/detectors"
import { createRepo } from "./git"

export const registry = createRegistry([...builtinDetectors])

export const backendConventions = [
  "# Backend",
  "## Services",
  "Business logic lives in services.",
  "## Errors",
  "Services raise domain exceptions.",
  "",
].join("\n")

export const fixtureFiles: Record<string, string> = {
  ".rulecast/rules/no-httpexception.yml": [
    "id: backend/no-httpexception",
    "files: app/services/**/*.py",
    "detect:",
    "  regex: { pattern: 'raise HTTPException\\((?<args>[^)]*)\\)' }",
    "message: '{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.'",
    "context: ['@conventions/backend.md#errors']",
    "",
  ].join("\n"),
  ".rulecast/rules/services-touch.yml": [
    "id: backend/services",
    "files: app/services/**/*.py",
    "on: [touch]",
    "context: ['@conventions/backend.md#services']",
    "",
  ].join("\n"),
  ".rulecast/rules/generated.yml": [
    "id: frontend/no-generated-edits",
    "files: src/client/**",
    "severity: warning",
    "detect: { path: {} }",
    "message: '{{file}} is generated. Regenerate it instead of editing.'",
    "",
  ].join("\n"),
  "conventions/backend.md": backendConventions,
  "app/services/users.py": "def get():\n    raise HTTPException(404)\n",
  "src/client/api.ts": "export const api = 1\n",
}

/** A committed git repository containing the fixture project. */
export function createFixture(): Promise<string> {
  return createRepo(fixtureFiles)
}
```

- [ ] **Step 2: Write the failing test**

`test/core/pipeline-session.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runPipeline } from "../../src/core/pipeline"
import type { Event } from "../../src/core/types"
import { createFixture, registry } from "../helpers/fixture"

const USERS = "app/services/users.py"

async function scenario() {
  const root = await createFixture()
  const send = async (event: Omit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const result = await runPipeline({
      root,
      event: { ...rest, cwd: root, session: { id: "s1", agentId } },
      registry,
      maxContextChars: null,
    })
    return result.delivery
  }
  const write = (content: string) => writeFile(path.join(root, USERS), content)
  return { root, send, write }
}

const refStates = (delivery: { references: { ref: string; state: string }[] }) =>
  delivery.references.map((reference) => `${reference.ref}:${reference.state}`)

describe("pipeline with a session", () => {
  test("touch delivers touch conventions once per context", async () => {
    const { send } = await scenario()
    const first = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(first.touches).toEqual(["backend/services"])
    expect(first.references).toEqual([
      { ref: "conventions/backend.md#services", state: "full", content: "## Services\nBusiness logic lives in services." },
    ])
    const second = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(second.touches).toEqual([])
    expect(second.references).toEqual([])
  })

  test("edit reports new findings, summarises pre-existing ones and dedupes references", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")

    const first = await send({ kind: "edit", files: [USERS] })
    expect(first.findings.map((finding) => [finding.line, finding.message])).toEqual([
      [3, "app/services/users.py:3 raises HTTPException(500). Raise a domain exception."],
    ])
    expect(first.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
    expect(refStates(first)).toEqual(["conventions/backend.md#errors:full"])

    const second = await send({ kind: "edit", files: [USERS] })
    expect(second.findings).toHaveLength(1)
    expect(second.preexistingSummary).toEqual([])
    expect(refStates(second)).toEqual(["conventions/backend.md#errors:pointer"])
  })

  test("stop gate blocks up to the cap per prompt and allows once fixed", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })

    const stops = []
    for (let i = 0; i < 4; i++) stops.push((await send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "block", "block", "capReached"])

    await send({ kind: "prompt", files: [] })
    expect((await send({ kind: "verify", files: [] })).stop).toBe("block")

    await write("def get():\n    raise HTTPException(404)\n    raise NotFound()\n")
    const fixed = await send({ kind: "verify", files: [] })
    expect(fixed.stop).toBe("allow")
    expect(fixed.findings).toEqual([])
  })

  test("reset clears delivered references; subagents have their own context", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual(["conventions/backend.md#errors:pointer"])

    // A subagent has seen nothing: the touch convention and the errors section both arrive in full.
    expect(refStates(await send({ kind: "edit", files: [USERS], agentId: "sub1" }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])

    await send({ kind: "reset", files: [] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])
  })

  test("edits of files never read fall back to the session-start commit", async () => {
    const { send, write } = await scenario()
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const delivery = await send({ kind: "edit", files: [USERS] })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.touches).toEqual(["backend/services"])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/pipeline-session.test.ts`
Expected: FAIL, cannot resolve `../../src/core/pipeline`.

- [ ] **Step 4: Create `src/core/pipeline.ts`**

```ts
import { computeChanges, isNew } from "./baseline/baseline"
import { headCommit, mergeBase } from "./baseline/git"
import { snapshotOf, type Snapshot } from "./baseline/hash"
import { appendBaseline, readBaseline, snapshotRecord, startRecord, type BaselineState } from "./baseline/store"
import { compile, type CompiledProject, type CompiledRule } from "./compile/compile"
import { detectorCacheDir, diskCache } from "./detection/cache"
import { readSourceFile } from "./detection/per-rule"
import type { DetectorRegistry } from "./detection/registry"
import { runDetection } from "./detection/run"
import { selectTouchRules, selectViolationRules } from "./detection/select"
import { createReferenceResolver } from "./delivery/resolve"
import { decide, type ClassifiedFinding, type DecideInput } from "./session/decide"
import { LockTimeoutError } from "./session/lock"
import { appendContext, appendWork, commitSession, openSession, sessionDir, type SessionView } from "./session/session"
import { emptyContext, emptyWork, type WorkRecord } from "./session/state"
import { emptyDelivery, type Delivery, type Event, type ResolvedReference } from "./types"

export interface PipelineOptions {
  root: string
  event: Event
  registry: DetectorRegistry
  /** From the adapter; null = unlimited. */
  maxContextChars: number | null
  /** Detector kinds to skip entirely (check --no-llm). */
  skipDetectorKinds?: ReadonlySet<string>
  /** Debug log sink. */
  log?: (line: string) => void
}

export interface PipelineResult {
  delivery: Delivery
  project: CompiledProject
  /** rulecast itself failed: compile diagnostics, detector errors or verify timeouts. */
  failed: boolean
}

type Warning = { key: string; text: string }

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { root, event, registry } = options
  const log = options.log ?? (() => {})
  const project = await compile(root, registry)
  const { config } = project
  const warnings: Warning[] = project.diagnostics.map((diagnostic) => ({
    key: `diagnostic:${diagnostic.source}:${diagnostic.message}`,
    text: `${diagnostic.source}: ${diagnostic.message} (run rulecast validate)`,
  }))
  let failed = project.diagnostics.length > 0
  const session = event.session
    ? { dir: sessionDir(root, event.session.id), agent: event.session.agentId ?? "main" }
    : null

  if (event.kind === "prompt" || event.kind === "reset") {
    if (session && event.kind === "prompt") await appendWork(session.dir, [{ t: "prompt", agent: session.agent }])
    if (session && event.kind === "reset") await appendContext(session.dir, session.agent, [{ t: "reset" }])
    return { delivery: emptyDelivery(), project, failed }
  }

  let baseline: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  if (session) {
    baseline = await readBaseline(session.dir)
    if (!baseline.started) {
      await appendBaseline(session.dir, [startRecord(await headCommit(root))])
      // Re-read: with concurrent first events, the first start record wins.
      baseline = await readBaseline(session.dir)
    }
  }

  const view: SessionView = session
    ? await openSession(session.dir, session.agent)
    : { work: emptyWork(), context: emptyContext() }
  const disabled = new Set(view.work.disabled.keys())
  const resolver = createReferenceResolver(root)
  const workRecords: WorkRecord[] = []
  const relevant = (files: readonly string[]) => files.filter((file) => project.rules.some((rule) => rule.matches(file)))

  let touches: CompiledRule[] = []
  let findings: ClassifiedFinding[] = []
  let agentRead: string | null = null

  if (event.kind === "touch" || event.kind === "edit") {
    touches = selectTouchRules(project.rules, event.files, view.context.touched, disabled)
  }

  if (event.kind === "touch") {
    if (event.completeRead) agentRead = event.files[0] ?? null
    if (session) {
      const records = []
      for (const file of relevant(event.files)) {
        if (baseline.snapshots.has(file)) continue
        const text = await readSourceFile(root, file)
        if (text !== null) records.push(snapshotRecord(file, snapshotOf(text)))
      }
      await appendBaseline(session.dir, records)
    }
  }

  if (event.kind === "edit" || event.kind === "verify") {
    let files = relevant(event.files)
    let snapshots: ReadonlyMap<string, Snapshot> = session ? baseline.snapshots : new Map()
    let fallbackCommit = session ? baseline.startCommit : null

    if (event.kind === "edit" && session) {
      await appendWork(session.dir, files.map((file) => ({ t: "edited" as const, file })))
    }
    if (event.kind === "verify") {
      if (event.baseRef) {
        fallbackCommit = await mergeBase(root, event.baseRef)
        snapshots = new Map()
      }
      if (event.files.length === 0 && session) files = relevant(view.work.edited)
    }

    const changes = await computeChanges(root, files, { snapshots, fallbackCommit })
    if (event.kind === "verify" && session && !event.baseRef) {
      // Files edited but back to their snapshot content have nothing new.
      files = files.filter((file) => changes.get(file)?.changedLines.length !== 0)
    }

    const skip = options.skipDetectorKinds ?? new Set<string>()
    const selections = selectViolationRules(project.rules, event.kind, files, disabled).filter(
      (selection) => !skip.has(selection.rule.detector!.kind),
    )
    const output = await runDetection({
      root,
      event: event.kind,
      selections,
      changes,
      registry,
      cacheFor: (kind) => diskCache(detectorCacheDir(root, kind)),
      contextFor: async (rule) => {
        const references: ResolvedReference[] = []
        for (const spec of rule.context) {
          const resolved = await resolver.resolve(spec)
          if (resolved.found) references.push({ ref: spec.ref, content: resolved.content })
        }
        return references
      },
      timeoutMs: event.kind === "edit" ? config.timeouts.editDeadlineMs : config.timeouts.verifyMs,
    })

    findings = output.findings.map(({ rule, match }) => ({
      rule,
      match,
      status: isNew(match, changes) ? "new" : "preexisting",
    }))
    for (const error of output.errors) {
      failed = true
      for (const rule of error.rules) workRecords.push({ t: "disabled", rule, reason: error.message })
      warnings.push({
        key: `detector:${error.kind}:${error.rules.join(",")}:${error.message}`,
        text: `${error.kind} detector failed for ${error.rules.join(", ")}: ${error.message}. Disabled for this session.`,
      })
    }
    for (const timeout of output.timedOut) {
      if (event.kind === "edit") {
        log(`edit deadline passed for ${timeout.kind}: ${timeout.rules.join(", ")}`)
      } else {
        failed = true
        warnings.push({
          key: `timeout:${timeout.kind}:${timeout.rules.join(",")}`,
          text: `${timeout.kind} detector timed out for ${timeout.rules.join(", ")}`,
        })
      }
    }
  }

  const inputFor = (state: SessionView): DecideInput => ({
    agent: session?.agent ?? "main",
    findings,
    touches: touches.filter((rule) => !state.context.touched.has(rule.id)),
    agentRead,
    warnings,
    work: state.work,
    context: state.context,
    resolver,
    maxBytes: config.context.maxBytes,
    maxBlocks: config.stopGate.maxBlocks,
    maxContextChars: options.maxContextChars,
    stopGate: event.kind === "verify" && session !== null,
  })

  if (!session) return { delivery: (await decide(inputFor(view))).delivery, project, failed }

  await appendWork(session.dir, workRecords)
  try {
    const delivery = await commitSession(session.dir, session.agent, (state) => decide(inputFor(state)))
    return { delivery, project, failed }
  } catch (error) {
    if (!(error instanceof LockTimeoutError)) throw error
    warnings.push({ key: "lock", text: "session state was locked; delivered without session memory" })
    const delivery = (await decide({ ...inputFor({ work: emptyWork(), context: emptyContext() }), stopGate: false }))
      .delivery
    return { delivery, project, failed }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core/pipeline-session.test.ts && pnpm typecheck`
Expected: 5 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/pipeline.ts test/helpers/fixture.ts test/core/pipeline-session.test.ts
git commit -m "feat: run events through the pipeline with session memory

Claude goes brr.. via Dash"
```

---

### Task 29: Pipeline without a session (CLI mode)

**Files:**
- Test: `test/core/pipeline-cli.test.ts`

- [ ] **Step 1: Write the tests**

`test/core/pipeline-cli.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runPipeline } from "../../src/core/pipeline"
import { createFixture, registry } from "../helpers/fixture"
import { git } from "../helpers/git"

const USERS = "app/services/users.py"

describe("pipeline without a session", () => {
  test("verify on explicit files: everything is new, references are full, no stop decision", async () => {
    const root = await createFixture()
    const { delivery, failed } = await runPipeline({
      root,
      event: { kind: "verify", files: [USERS, "src/client/api.ts", "README.md"], cwd: root },
      registry,
      maxContextChars: null,
    })
    expect(failed).toBe(false)
    expect(delivery.stop).toBeNull()
    expect(delivery.findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ["backend/no-httpexception", "error", 2],
      ["frontend/no-generated-edits", "warning", 1],
    ])
    expect(delivery.references.map((reference) => [reference.ref, reference.state])).toEqual([
      ["conventions/backend.md#errors", "full"],
    ])
  })

  test("verify with a base ref classifies against the merge base", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const { delivery } = await runPipeline({
      root,
      event: { kind: "verify", files: [USERS], baseRef: "main", cwd: root },
      registry,
      maxContextChars: null,
    })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
  })

  test("skipped detector kinds do not run", async () => {
    const root = await createFixture()
    const { delivery } = await runPipeline({
      root,
      event: { kind: "verify", files: [USERS], cwd: root },
      registry,
      maxContextChars: null,
      skipDetectorKinds: new Set(["regex"]),
    })
    expect(delivery.findings).toEqual([])
  })

  test("compile diagnostics are warnings and mark the run failed", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, ".rulecast/rules/broken.yml"), "id: broken\nfiles: '**'\ndetect: { nope: {} }\nmessage: m\n")
    const { delivery, failed } = await runPipeline({
      root,
      event: { kind: "verify", files: [USERS], cwd: root },
      registry,
      maxContextChars: null,
    })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual(['.rulecast/rules/broken.yml: unknown detector "nope" (run rulecast validate)'])
    expect(delivery.findings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run test/core/pipeline-cli.test.ts`
Expected: 4 tests pass (the pipeline from Task 28 covers them).

- [ ] **Step 3: Commit**

```bash
git add test/core/pipeline-cli.test.ts
git commit -m "test: cover pipeline verify without a session

Claude goes brr.. via Dash"
```

---

### Task 30: CLI output formats

**Files:**
- Create: `src/adapters/cli/format.ts`
- Test: `test/adapters/cli/format.test.ts`

- [ ] **Step 1: Write the failing test**

`test/adapters/cli/format.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { exitCodeFor, formatDelivery } from "../../../src/adapters/cli/format"
import { emptyDelivery, type Delivery } from "../../../src/core/types"

const delivery: Delivery = {
  ...emptyDelivery(),
  findings: [
    { rule: "backend/x", severity: "error", status: "new", file: "a.py", line: 2, column: 5, message: "bad\nfix it", count: 1 },
    { rule: "front/y", severity: "warning", status: "new", file: "b.ts", line: 1, column: 1, message: "hmm", count: 3 },
  ],
  preexistingSummary: [{ rule: "backend/x", file: "a.py", count: 4 }],
  references: [
    { ref: "conventions/backend.md#errors", state: "full", content: "## Errors" },
    { ref: "conventions/state.md", state: "read", reason: "mode" },
  ],
  warnings: ["something broke"],
}

describe("formatDelivery", () => {
  test("terminal", () => {
    expect(formatDelivery(delivery, "terminal", { maxMatchesPerRule: 10 })).toBe(
      [
        "a.py:2:5  error    backend/x  bad fix it",
        "b.ts:1:1  warning  front/y  hmm (×3)",
        "",
        "pre-existing (not blocking): backend/x ×4 in a.py",
        "conventions: conventions/backend.md#errors, conventions/state.md",
        "",
        "warnings:",
        "  - something broke",
        "",
        "1 error, 1 warning",
      ].join("\n"),
    )
    expect(formatDelivery(emptyDelivery(), "terminal", { maxMatchesPerRule: 10 })).toBe("no findings")
  })

  test("agent uses the shared agent renderer", () => {
    expect(formatDelivery(delivery, "agent", { maxMatchesPerRule: 10 })).toContain("--- conventions/backend.md#errors ---")
  })

  test("json is the delivery", () => {
    expect(JSON.parse(formatDelivery(delivery, "json", { maxMatchesPerRule: 10 }))).toEqual(delivery)
  })

  test("sarif lists findings as results", () => {
    const sarif = JSON.parse(formatDelivery(delivery, "sarif", { maxMatchesPerRule: 10 }))
    expect(sarif.version).toBe("2.1.0")
    expect(sarif.runs[0].tool.driver.name).toBe("rulecast")
    expect(sarif.runs[0].tool.driver.rules).toEqual([{ id: "backend/x" }, { id: "front/y" }])
    expect(sarif.runs[0].results[0]).toEqual({
      ruleId: "backend/x",
      level: "error",
      message: { text: "bad\nfix it" },
      locations: [{ physicalLocation: { artifactLocation: { uri: "a.py" }, region: { startLine: 2, startColumn: 5 } } }],
    })
  })
})

describe("exitCodeFor", () => {
  test("2 when rulecast failed, 1 for new errors, 0 otherwise", () => {
    expect(exitCodeFor(delivery, true)).toBe(2)
    expect(exitCodeFor(delivery, false)).toBe(1)
    expect(exitCodeFor({ ...delivery, findings: [delivery.findings[1]!] }, false)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/adapters/cli/format.test.ts`
Expected: FAIL, cannot resolve `../../../src/adapters/cli/format`.

- [ ] **Step 3: Create `src/adapters/cli/format.ts`**

```ts
import { renderAgentText } from "../../core/delivery/render-agent"
import type { Delivery, Finding } from "../../core/types"

export const CLI_FORMATS = ["terminal", "agent", "json", "sarif"] as const
export type CliFormat = (typeof CLI_FORMATS)[number]

export interface FormatOptions {
  maxMatchesPerRule: number
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function terminal(delivery: Delivery, options: FormatOptions): string {
  const out: string[] = []
  const shown = new Map<string, number>()
  const hidden = new Map<string, Finding[]>()
  for (const finding of delivery.findings) {
    const count = shown.get(finding.rule) ?? 0
    if (count >= options.maxMatchesPerRule) {
      hidden.set(finding.rule, [...(hidden.get(finding.rule) ?? []), finding])
      continue
    }
    shown.set(finding.rule, count + 1)
    const repeat = finding.count > 1 ? ` (×${finding.count})` : ""
    out.push(
      `${finding.file}:${finding.line}:${finding.column}  ${finding.severity.padEnd(7)}  ${finding.rule}  ${finding.message.replace(/\s*\n\s*/g, " ")}${repeat}`,
    )
  }
  for (const [rule, rest] of hidden) out.push(`…and ${rest.length} more for ${rule}`)
  if (out.length > 0) out.push("")

  for (const summary of delivery.preexistingSummary) {
    out.push(`pre-existing (not blocking): ${summary.rule} ×${summary.count} in ${summary.file}`)
  }
  if (delivery.references.length > 0) {
    out.push(`conventions: ${delivery.references.map((reference) => reference.ref).join(", ")}`)
  }
  if (delivery.preexistingSummary.length > 0 || delivery.references.length > 0) out.push("")

  if (delivery.warnings.length > 0) {
    out.push("warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`), "")
  }

  const errors = delivery.findings.filter((finding) => finding.severity === "error").length
  const warningsCount = delivery.findings.length - errors
  out.push(delivery.findings.length === 0 ? "no findings" : `${plural(errors, "error")}, ${plural(warningsCount, "warning")}`)
  return out.join("\n")
}

function sarif(delivery: Delivery): string {
  const rules = [...new Set(delivery.findings.map((finding) => finding.rule))].map((id) => ({ id }))
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "rulecast", rules } },
          results: delivery.findings.map((finding) => ({
            ruleId: finding.rule,
            level: finding.severity,
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: finding.file },
                  region: { startLine: finding.line, startColumn: finding.column },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  )
}

export function formatDelivery(delivery: Delivery, format: CliFormat, options: FormatOptions): string {
  switch (format) {
    case "terminal":
      return terminal(delivery, options)
    case "agent":
      return renderAgentText(delivery, options)
    case "json":
      return JSON.stringify(delivery, null, 2)
    case "sarif":
      return sarif(delivery)
  }
}

export function exitCodeFor(delivery: Delivery, failed: boolean): number {
  if (failed) return 2
  return delivery.findings.some((finding) => finding.severity === "error") ? 1 : 0
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/adapters/cli/format.test.ts && pnpm typecheck`
Expected: 5 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/cli/format.ts test/adapters/cli/format.test.ts
git commit -m "feat: format deliveries for terminal, agent, JSON and SARIF

Claude goes brr.. via Dash"
```

---

### Task 31: `check`, `validate` and the entry point

**Files:**
- Create: `src/commands/check.ts`, `src/commands/validate.ts`, `src/commands/main.ts`, `src/cli.ts`
- Test: `test/commands/main.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/main.test.ts`:
```ts
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { main } from "../../src/commands/main"
import { createFixture } from "../helpers/fixture"
import { git } from "../helpers/git"

async function run(cwd: string, ...argv: string[]) {
  let stdout = ""
  let stderr = ""
  const code = await main(argv, { cwd, stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) })
  return { code, stdout, stderr }
}

describe("rulecast CLI", () => {
  test("validate reports rule count, or diagnostics with exit 2", async () => {
    const root = await createFixture()
    expect(await run(root, "validate")).toEqual({ code: 0, stdout: "rulecast: 3 rules valid\n", stderr: "" })
    await writeFile(path.join(root, ".rulecast/rules/broken.yml"), "id: broken\nfiles: '**'\ndetect: { nope: {} }\nmessage: m\n")
    expect(await run(root, "validate")).toEqual({
      code: 2,
      stdout: '.rulecast/rules/broken.yml (broken): unknown detector "nope"\n',
      stderr: "",
    })
  })

  test("check without arguments checks every file matched by a rule", async () => {
    const root = await createFixture()
    const result = await run(root, "check")
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("app/services/users.py:2:5  error    backend/no-httpexception")
    expect(result.stdout).toContain("src/client/api.ts:1:1  warning  frontend/no-generated-edits")
    expect(result.stdout.trimEnd().endsWith("1 error, 1 warning")).toBe(true)
  })

  test("check with files resolves them relative to cwd", async () => {
    const root = await createFixture()
    const result = await run(path.join(root, "src"), "check", "client/api.ts", "--format", "json")
    // cwd is a subdirectory, but the project root is found by walking up to .rulecast.
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).findings.map((finding: { rule: string }) => finding.rule)).toEqual([
      "frontend/no-generated-edits",
    ])
  })

  test("check --base only checks changed files and only new findings count", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    expect((await run(root, "check", "--base", "main")).stdout.trim()).toBe("no findings")
    await writeFile(path.join(root, "app/services/users.py"), "def get():\n    raise HTTPException(404)\n    x = 1\n")
    const result = await run(root, "check", "--base", "main")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("pre-existing (not blocking): backend/no-httpexception ×1 in app/services/users.py")
  })

  test("usage errors exit 2", async () => {
    const root = await createFixture()
    expect((await run(root, "frobnicate")).code).toBe(2)
    expect((await run(root, "check", "--format", "xml")).stderr).toContain('unknown format "xml"')
    expect((await run(root, "check", "--base", "nope")).stderr).toContain("cannot find merge base with nope")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/commands/main.test.ts`
Expected: FAIL, cannot resolve `../../src/commands/main`.

- [ ] **Step 3: Create `src/commands/validate.ts`**

```ts
import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import type { CliIo } from "./main"

export async function validateCommand(root: string, registry: DetectorRegistry, io: CliIo): Promise<number> {
  const project = await compile(root, registry)
  if (project.diagnostics.length > 0) {
    for (const diagnostic of project.diagnostics) {
      io.stdout(`${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}\n`)
    }
    return 2
  }
  io.stdout(`rulecast: ${project.rules.length} ${project.rules.length === 1 ? "rule" : "rules"} valid\n`)
  return 0
}
```

- [ ] **Step 4: Create `src/commands/check.ts`**

```ts
import path from "node:path"
import { parseArgs } from "node:util"
import { glob } from "tinyglobby"

import { CLI_FORMATS, exitCodeFor, formatDelivery, type CliFormat } from "../adapters/cli/format"
import { changedFilesSince, mergeBase } from "../core/baseline/git"
import type { DetectorRegistry } from "../core/detection/registry"
import { runPipeline } from "../core/pipeline"
import type { CliIo } from "./main"

export class UsageError extends Error {}

function toProjectPath(root: string, cwd: string, file: string): string {
  return path.relative(root, path.resolve(cwd, file)).split(path.sep).join("/")
}

export async function checkCommand(root: string, args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
    },
  })
  const format = values.format as CliFormat
  if (!CLI_FORMATS.includes(format)) throw new UsageError(`unknown format "${values.format}" (use ${CLI_FORMATS.join(", ")})`)

  let files: string[]
  if (positionals.length > 0) {
    files = positionals.map((file) => toProjectPath(root, io.cwd, file))
  } else if (values.base) {
    files = await changedFilesSince(root, await mergeBase(root, values.base))
  } else {
    files = (
      await glob(["**/*"], { cwd: root, dot: true, ignore: ["**/node_modules/**", "**/.git/**", ".rulecast/.state/**"] })
    ).sort()
  }

  const result = await runPipeline({
    root,
    event: {
      kind: "verify",
      files,
      baseRef: values.base,
      session: values.session ? { id: values.session } : undefined,
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: values["no-llm"] ? new Set(["llm"]) : undefined,
  })
  const text = formatDelivery(result.delivery, format, { maxMatchesPerRule: result.project.config.maxMatchesPerRule })
  if (text) io.stdout(`${text}\n`)
  return exitCodeFor(result.delivery, result.failed)
}
```

Note: with `--base` and no changed files, `files` is empty and the pipeline reports nothing, which renders as `no findings`.

- [ ] **Step 5: Create `src/commands/main.ts`**

```ts
import { existsSync } from "node:fs"
import path from "node:path"

import { errorMessage } from "../core/errors"
import { createRegistry } from "../core/detection/registry"
import { builtinDetectors } from "../detectors"
import { checkCommand, UsageError } from "./check"
import { validateCommand } from "./validate"

export interface CliIo {
  cwd: string
  stdout(text: string): void
  stderr(text: string): void
}

const USAGE = `usage:
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
`

/** Nearest ancestor of cwd containing .rulecast/, or cwd itself. */
export function findRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".rulecast"))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  const registry = createRegistry([...builtinDetectors])
  const root = findRoot(io.cwd)
  try {
    switch (command) {
      case "check":
        return await checkCommand(root, args, registry, io)
      case "validate":
        return await validateCommand(root, registry, io)
      case undefined:
      case "help":
      case "--help":
        io.stdout(USAGE)
        return command === undefined ? 2 : 0
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (error) {
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      io.stderr(USAGE)
    }
    return 2
  }
}
```

- [ ] **Step 6: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
import { main } from "./commands/main"

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
})
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run test/commands/main.test.ts && pnpm typecheck`
Expected: 5 tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/commands src/cli.ts test/commands/main.test.ts
git commit -m "feat: add rulecast check and validate commands

Claude goes brr.. via Dash"
```

---

### Task 32: Public exports, build and end-to-end run

**Files:**
- Modify: `src/index.ts`
- Test: `test/build.test.ts`

- [ ] **Step 1: Replace `src/index.ts`**

```ts
export type * from "./core/types"
export { emptyDelivery } from "./core/types"
export { compile, type CompiledProject, type CompiledRule, type Diagnostic } from "./core/compile/compile"
export { createRegistry, type DetectorRegistry } from "./core/detection/registry"
export { perRule } from "./core/detection/per-rule"
export { runPipeline, type PipelineOptions, type PipelineResult } from "./core/pipeline"
export { renderAgentText } from "./core/delivery/render-agent"
export { builtinDetectors } from "./detectors"
```

- [ ] **Step 2: Write the build test**

`test/build.test.ts`:
```ts
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createFixture } from "./helpers/fixture"

const exec = promisify(execFile)
const cli = path.resolve("dist/cli.js")

beforeAll(async () => {
  await exec("pnpm", ["build"])
}, 60_000)

test("built CLI runs check in a project", async () => {
  const root = await createFixture()
  const failure = await exec("node", [cli, "check", "--format", "agent"], { cwd: root }).catch((error) => error)
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("rulecast: 2 rules violated")
  expect(failure.stdout).toContain("--- conventions/backend.md#errors ---")
}, 30_000)
```

- [ ] **Step 3: Run the build test**

Run: `pnpm vitest run test/build.test.ts`
Expected: PASS. `dist/cli.js` starts with `#!/usr/bin/env node`.

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/build.test.ts
git commit -m "feat: export public API and verify the built CLI

Claude goes brr.. via Dash"
```

Plan 1 is complete. Plans 2–5 are written next (see `docs/plans/2026-09-15-rulecast-00-index.md`).
