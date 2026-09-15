# rulecast Plan 1d — Session and Delivery Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything that decides what the agent receives: reference resolution, session stores and lock, the commit decision (findings, pre-existing summaries, references with coverage and budget, stop gate), and the agent text renderer.

**Architecture:** Session state is two append-only JSONL stores folded into plain objects. `decide()` is a pure async function from findings, touches and folded state to a `Delivery` plus the records to append; `commitSession()` wraps it in a short lock. Renderers only arrange a `Delivery`. Spec: `docs/specs/2026-09-15-rulecast-design.md` §9, §11.

**Tech Stack:** Node ≥ 20, TypeScript 5, vitest.

Prerequisite: `2026-09-15-rulecast-01c-baseline.md` is done. Continue with `2026-09-15-rulecast-01e-pipeline-cli.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/delivery/resolve.ts` | Resolve references to content and hashes; section containment |
| `src/core/session/state.ts` | Record types and folding into `WorkState` / `ContextState` |
| `src/core/session/lock.ts` | Directory lock with stale detection |
| `src/core/session/decide.ts` | Commit decisions → `Delivery` + records |
| `src/core/session/session.ts` | Session directories, open, append, commit under lock |
| `src/core/delivery/render-agent.ts` | `renderAgentText` |

---

### Task 21: Reference resolution

**Files:**
- Create: `src/core/delivery/resolve.ts`
- Test: `test/core/delivery/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/delivery/resolve.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { fnv1a } from "../../../src/core/baseline/hash"
import { createReferenceResolver } from "../../../src/core/delivery/resolve"
import { parseReference } from "../../../src/core/references"
import { createProject } from "../../helpers/project"

const doc = "# API\n\n## Errors\nMap them.\n\n### Retries\nTwice.\n\n## State\nQueries.\n"

describe("reference resolver", () => {
  test("resolves whole files and sections with hash and size", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    const whole = await resolver.resolve(parseReference("@conventions/api.md", "inject"))
    expect(whole).toEqual({
      spec: parseReference("@conventions/api.md", "inject"),
      found: true,
      content: doc.trimEnd(),
      hash: fnv1a(doc.trimEnd()),
      bytes: Buffer.byteLength(doc.trimEnd()),
    })
    const section = await resolver.resolve(parseReference("@conventions/api.md#errors", "read"))
    expect(section).toMatchObject({ found: true, content: "## Errors\nMap them.\n\n### Retries\nTwice." })
  })

  test("missing files and anchors resolve as not found", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    expect(await resolver.resolve(parseReference("@conventions/nope.md", "inject"))).toMatchObject({ found: false })
    expect(await resolver.resolve(parseReference("@conventions/api.md#nope", "inject"))).toMatchObject({ found: false })
  })

  test("containment: whole file covers sections, sections cover subsections only", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    expect(await resolver.contains("conventions/api.md", null, "retries")).toBe(true)
    expect(await resolver.contains("conventions/api.md", null, null)).toBe(true)
    expect(await resolver.contains("conventions/api.md", "errors", "retries")).toBe(true)
    expect(await resolver.contains("conventions/api.md", "errors", null)).toBe(false)
    expect(await resolver.contains("conventions/api.md", "errors", "state")).toBe(false)
  })

  test("currentHash matches resolve and is null when gone", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    const section = await resolver.resolve(parseReference("@conventions/api.md#state", "inject"))
    expect(await resolver.currentHash("conventions/api.md", "state")).toBe(section.found ? section.hash : -1)
    expect(await resolver.currentHash("conventions/gone.md", null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/delivery/resolve.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/delivery/resolve`.

- [ ] **Step 3: Create `src/core/delivery/resolve.ts`**

```ts
import { sectionContains, sectionRange, sectionText } from "../anchors"
import { fnv1a } from "../baseline/hash"
import { readSourceFile } from "../detection/per-rule"
import type { ReferenceSpec } from "../references"

export type ResolvedRef =
  | { spec: ReferenceSpec; found: true; content: string; hash: number; bytes: number }
  | { spec: ReferenceSpec; found: false }

export interface ReferenceResolver {
  resolve(spec: ReferenceSpec): Promise<ResolvedRef>
  /** Hash of the current content of a path or section, null when it no longer exists. */
  currentHash(path: string, anchor: string | null): Promise<number | null>
  /** Whether content delivered as `parent` includes `child`. null means the whole file. */
  contains(path: string, parent: string | null, child: string | null): Promise<boolean>
}

/** Reads each file at most once; create one per event. */
export function createReferenceResolver(root: string): ReferenceResolver {
  const texts = new Map<string, Promise<string | null>>()
  const read = (path: string) => {
    let text = texts.get(path)
    if (!text) {
      text = readSourceFile(root, path)
      texts.set(path, text)
    }
    return text
  }

  const contentOf = async (path: string, anchor: string | null): Promise<string | null> => {
    const text = await read(path)
    if (text === null) return null
    if (anchor === null) return text.trimEnd()
    const section = sectionRange(text, anchor)
    return section ? sectionText(text, section) : null
  }

  return {
    async resolve(spec) {
      const content = await contentOf(spec.path, spec.anchor)
      if (content === null) return { spec, found: false }
      return { spec, found: true, content, hash: fnv1a(content), bytes: Buffer.byteLength(content) }
    },
    async currentHash(path, anchor) {
      const content = await contentOf(path, anchor)
      return content === null ? null : fnv1a(content)
    },
    async contains(path, parent, child) {
      if (parent === null) return true
      if (child === null) return false
      const text = await read(path)
      return text !== null && sectionContains(text, parent, child)
    },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/delivery/resolve.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/delivery/resolve.ts test/core/delivery/resolve.test.ts
git commit -m "feat: resolve references to content and section containment

Claude goes brr.. via Dash"
```

---

### Task 22: Session records and folding

**Files:**
- Create: `src/core/session/state.ts`
- Test: `test/core/session/state.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/session/state.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { emptyContext, emptyWork, foldContext, foldWork, preexistingKey } from "../../../src/core/session/state"

describe("foldWork", () => {
  test("tracks edited files, stop blocks per agent reset by prompts, and disabled rules", () => {
    const work = foldWork([
      { t: "edited", file: "a.ts" },
      { t: "edited", file: "b.ts" },
      { t: "edited", file: "a.ts" },
      { t: "stopBlock", agent: "main" },
      { t: "stopBlock", agent: "main" },
      { t: "stopBlock", agent: "sub1" },
      { t: "prompt", agent: "main" },
      { t: "stopBlock", agent: "main" },
      { t: "disabled", rule: "r1", reason: "boom" },
    ])
    expect(work).toEqual({
      edited: ["b.ts", "a.ts"],
      stopBlocks: new Map([
        ["main", 1],
        ["sub1", 1],
      ]),
      disabled: new Map([["r1", "boom"]]),
    })
  })

  test("empty", () => {
    expect(foldWork([])).toEqual(emptyWork())
  })
})

describe("foldContext", () => {
  test("ignores everything before the last reset", () => {
    const context = foldContext([
      { t: "delivered", path: "c.md", anchor: null, hash: 1 },
      { t: "touched", rule: "t1" },
      { t: "reset" },
      { t: "delivered", path: "c.md", anchor: "errors", hash: 2 },
      { t: "touched", rule: "t2" },
      { t: "preexisting", rule: "r", file: "a.ts" },
      { t: "warned", key: "w" },
    ])
    expect(context).toEqual({
      delivered: [{ path: "c.md", anchor: "errors", hash: 2 }],
      touched: new Set(["t2"]),
      preexisting: new Set([preexistingKey("r", "a.ts")]),
      warned: new Set(["w"]),
    })
  })

  test("empty", () => {
    expect(foldContext([])).toEqual(emptyContext())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/session/state.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/session/state`.

- [ ] **Step 3: Create `src/core/session/state.ts`**

```ts
export type WorkRecord =
  | { t: "edited"; file: string }
  | { t: "stopBlock"; agent: string }
  | { t: "prompt"; agent: string }
  | { t: "disabled"; rule: string; reason: string }

export type ContextRecord =
  | { t: "reset" }
  | { t: "delivered"; path: string; anchor: string | null; hash: number }
  | { t: "touched"; rule: string }
  | { t: "preexisting"; rule: string; file: string }
  | { t: "warned"; key: string }

export interface WorkState {
  /** Unique, least recently edited first. */
  edited: string[]
  stopBlocks: Map<string, number>
  disabled: Map<string, string>
}

export interface ContextState {
  delivered: { path: string; anchor: string | null; hash: number }[]
  touched: Set<string>
  preexisting: Set<string>
  warned: Set<string>
}

export function preexistingKey(rule: string, file: string): string {
  return `${rule} ${file}`
}

export function emptyWork(): WorkState {
  return { edited: [], stopBlocks: new Map(), disabled: new Map() }
}

export function emptyContext(): ContextState {
  return { delivered: [], touched: new Set(), preexisting: new Set(), warned: new Set() }
}

export function foldWork(records: readonly WorkRecord[]): WorkState {
  const state = emptyWork()
  for (const record of records) {
    switch (record.t) {
      case "edited":
        state.edited = [...state.edited.filter((file) => file !== record.file), record.file]
        break
      case "stopBlock":
        state.stopBlocks.set(record.agent, (state.stopBlocks.get(record.agent) ?? 0) + 1)
        break
      case "prompt":
        state.stopBlocks.delete(record.agent)
        break
      case "disabled":
        if (!state.disabled.has(record.rule)) state.disabled.set(record.rule, record.reason)
        break
    }
  }
  return state
}

export function foldContext(records: readonly ContextRecord[]): ContextState {
  let state = emptyContext()
  for (const record of records) {
    switch (record.t) {
      case "reset":
        state = emptyContext()
        break
      case "delivered":
        state.delivered.push({ path: record.path, anchor: record.anchor, hash: record.hash })
        break
      case "touched":
        state.touched.add(record.rule)
        break
      case "preexisting":
        state.preexisting.add(preexistingKey(record.rule, record.file))
        break
      case "warned":
        state.warned.add(record.key)
        break
    }
  }
  return state
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/session/state.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/state.ts test/core/session/state.test.ts
git commit -m "feat: fold session work and context records

Claude goes brr.. via Dash"
```

---

### Task 23: Session lock

**Files:**
- Create: `src/core/session/lock.ts`
- Test: `test/core/session/lock.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/session/lock.test.ts`:
```ts
import { mkdir, utimes } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { LockTimeoutError, withLock } from "../../../src/core/session/lock"
import { createProject } from "../../helpers/project"

describe("withLock", () => {
  test("serialises concurrent critical sections", async () => {
    const dir = path.join(await createProject({}), "session")
    const events: string[] = []
    const section = (name: string) =>
      withLock(dir, async () => {
        events.push(`${name}:in`)
        await new Promise((resolve) => setTimeout(resolve, 15))
        events.push(`${name}:out`)
      })
    await Promise.all([section("a"), section("b")])
    // Either order is fine; the sections must not interleave.
    expect(events).toHaveLength(4)
    expect(events[1]).toBe(events[0]!.replace(":in", ":out"))
    expect(events[3]).toBe(events[2]!.replace(":in", ":out"))
  })

  test("releases the lock when the section throws", async () => {
    const dir = path.join(await createProject({}), "session")
    await expect(withLock(dir, async () => Promise.reject(new Error("fail")))).rejects.toThrow("fail")
    expect(await withLock(dir, async () => "again")).toBe("again")
  })

  test("takes over a stale lock", async () => {
    const dir = path.join(await createProject({}), "session")
    const lock = path.join(dir, ".lock")
    await mkdir(lock, { recursive: true })
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)
    expect(await withLock(dir, async () => "took over", { waitMs: 200, staleMs: 5000, retryMs: 5 })).toBe("took over")
  })

  test("times out on a fresh lock held too long", async () => {
    const dir = path.join(await createProject({}), "session")
    await mkdir(path.join(dir, ".lock"), { recursive: true })
    await expect(withLock(dir, async () => "never", { waitMs: 50, staleMs: 5000, retryMs: 5 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/session/lock.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/session/lock`.

- [ ] **Step 3: Create `src/core/session/lock.ts`**

```ts
import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"

export class LockTimeoutError extends Error {}

export interface LockOptions {
  waitMs: number
  staleMs: number
  retryMs: number
}

const DEFAULTS: LockOptions = { waitMs: 2000, staleMs: 5000, retryMs: 20 }

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST"
}

/** mkdir is atomic, so the lock is a directory. Held only while `fn` runs. */
export async function withLock<T>(dir: string, fn: () => Promise<T>, options: LockOptions = DEFAULTS): Promise<T> {
  const lock = path.join(dir, ".lock")
  await mkdir(dir, { recursive: true })
  const started = Date.now()
  for (;;) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    try {
      const { mtimeMs } = await stat(lock)
      if (Date.now() - mtimeMs > options.staleMs) {
        await rm(lock, { recursive: true, force: true })
        continue
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      continue
    }
    if (Date.now() - started > options.waitMs) throw new LockTimeoutError(`could not lock ${dir} within ${options.waitMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, options.retryMs))
  }
  try {
    return await fn()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/session/lock.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/lock.ts test/core/session/lock.test.ts
git commit -m "feat: add session lock with stale takeover

Claude goes brr.. via Dash"
```

---

### Task 24: Decide findings, summaries, warnings and stop

**Files:**
- Create: `src/core/session/decide.ts`
- Create: `test/helpers/resolver.ts`
- Test: `test/core/session/decide-findings.test.ts`

- [ ] **Step 1: Create `test/helpers/resolver.ts`**

```ts
import { fnv1a } from "../../src/core/baseline/hash"
import type { ReferenceResolver } from "../../src/core/delivery/resolve"

/**
 * In-memory resolver. `files` maps "path" or "path#anchor" to content.
 * `children` maps "path#anchor" to the anchors it contains (besides itself).
 */
export function fakeResolver(files: Record<string, string>, children: Record<string, string[]> = {}): ReferenceResolver {
  const key = (path: string, anchor: string | null) => (anchor === null ? path : `${path}#${anchor}`)
  return {
    async resolve(spec) {
      const content = files[key(spec.path, spec.anchor)]
      if (content === undefined) return { spec, found: false }
      return { spec, found: true, content, hash: fnv1a(content), bytes: Buffer.byteLength(content) }
    },
    async currentHash(path, anchor) {
      const content = files[key(path, anchor)]
      return content === undefined ? null : fnv1a(content)
    },
    async contains(path, parent, child) {
      if (parent === null) return true
      if (child === null) return false
      return parent === child || (children[`${path}#${parent}`] ?? []).includes(child)
    },
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/core/session/decide-findings.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { decide, type DecideInput } from "../../../src/core/session/decide"
import { emptyContext, emptyWork, preexistingKey } from "../../../src/core/session/state"
import type { Match } from "../../../src/core/types"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const at = (file: string, line: number, captures: Record<string, string> = {}): Match => ({
  file,
  line,
  endLine: line,
  column: 3,
  text: "x",
  captures,
})

const errorRule = rule({ id: "api/no-client", message: "{{file}}:{{line}} imports {{NAMES}}" })
const warningRule = rule({ id: "style/warn", severity: "warning", message: "consider {{rule}}" })

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    agent: "main",
    findings: [],
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver: fakeResolver({}),
    maxBytes: 32768,
    maxBlocks: 3,
    maxContextChars: null,
    stopGate: false,
    ...overrides,
  }
}

describe("decide: findings", () => {
  test("renders messages, merges identical findings and orders errors first", async () => {
    const { delivery } = await decide(
      input({
        findings: [
          { rule: warningRule, match: at("b.ts", 9), status: "new" },
          { rule: errorRule, match: at("a.ts", 3, { NAMES: "Docs" }), status: "new" },
          { rule: errorRule, match: at("a.ts", 3, { NAMES: "Docs" }), status: "new" },
        ],
      }),
    )
    expect(delivery.findings).toEqual([
      { rule: "api/no-client", severity: "error", status: "new", file: "a.ts", line: 3, column: 3, message: "a.ts:3 imports Docs", count: 2 },
      { rule: "style/warn", severity: "warning", status: "new", file: "b.ts", line: 9, column: 3, message: "consider style/warn", count: 1 },
    ])
  })

  test("pre-existing findings become one summary per rule and file, once per context", async () => {
    const findings = [
      { rule: errorRule, match: at("a.ts", 1, { NAMES: "A" }), status: "preexisting" as const },
      { rule: errorRule, match: at("a.ts", 7, { NAMES: "B" }), status: "preexisting" as const },
      { rule: errorRule, match: at("b.ts", 2, { NAMES: "C" }), status: "preexisting" as const },
    ]
    const first = await decide(input({ findings }))
    expect(first.delivery.findings).toEqual([])
    expect(first.delivery.preexistingSummary).toEqual([
      { rule: "api/no-client", file: "a.ts", count: 2 },
      { rule: "api/no-client", file: "b.ts", count: 1 },
    ])
    expect(first.context).toEqual([
      { t: "preexisting", rule: "api/no-client", file: "a.ts" },
      { t: "preexisting", rule: "api/no-client", file: "b.ts" },
    ])

    const context = emptyContext()
    context.preexisting.add(preexistingKey("api/no-client", "a.ts"))
    const second = await decide(input({ findings, context }))
    expect(second.delivery.preexistingSummary).toEqual([{ rule: "api/no-client", file: "b.ts", count: 1 }])
  })

  test("warnings are delivered once per context", async () => {
    const context = emptyContext()
    context.warned.add("seen")
    const { delivery, context: records } = await decide(
      input({
        context,
        warnings: [
          { key: "seen", text: "old" },
          { key: "fresh", text: "new problem" },
        ],
      }),
    )
    expect(delivery.warnings).toEqual(["new problem"])
    expect(records).toEqual([{ t: "warned", key: "fresh" }])
  })
})

describe("decide: stop gate", () => {
  const newError = { rule: errorRule, match: at("a.ts", 3, { NAMES: "X" }), status: "new" as const }
  const newWarning = { rule: warningRule, match: at("a.ts", 4), status: "new" as const }

  test("null when not a stop", async () => {
    expect((await decide(input({ findings: [newError] }))).delivery.stop).toBeNull()
  })

  test("allow without new errors", async () => {
    const decision = await decide(input({ stopGate: true, findings: [newWarning] }))
    expect(decision.delivery.stop).toBe("allow")
    expect(decision.work).toEqual([])
  })

  test("block with new errors below the cap, and count the block", async () => {
    const decision = await decide(input({ stopGate: true, agent: "sub1", findings: [newError] }))
    expect(decision.delivery.stop).toBe("block")
    expect(decision.work).toEqual([{ t: "stopBlock", agent: "sub1" }])
  })

  test("capReached at the cap", async () => {
    const work = emptyWork()
    work.stopBlocks.set("main", 3)
    const decision = await decide(input({ stopGate: true, work, findings: [newError] }))
    expect(decision.delivery.stop).toBe("capReached")
    expect(decision.work).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/session/decide-findings.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/session/decide`.

- [ ] **Step 4: Create `src/core/session/decide.ts`**

This file also contains reference decisions; Task 25 adds their tests.

```ts
import type { CompiledRule } from "../compile/compile"
import type { ReferenceResolver, ResolvedRef } from "../delivery/resolve"
import type { ReferenceSpec } from "../references"
import { renderTemplate } from "../template"
import { emptyDelivery, type DeliveredReference, type Delivery, type Finding, type Match } from "../types"
import { preexistingKey, type ContextRecord, type ContextState, type WorkRecord, type WorkState } from "./state"

export interface ClassifiedFinding {
  rule: CompiledRule
  match: Match
  status: "new" | "preexisting"
}

export interface DecideInput {
  agent: string
  findings: ClassifiedFinding[]
  /** Touch rules selected for this event (not yet fired). */
  touches: CompiledRule[]
  /** Path of a file the agent read completely in this event. */
  agentRead: string | null
  warnings: { key: string; text: string }[]
  work: WorkState
  context: ContextState
  resolver: ReferenceResolver
  maxBytes: number
  maxBlocks: number
  maxContextChars: number | null
  /** verify from a stop: decide block / allow / capReached. */
  stopGate: boolean
}

export interface Decision {
  delivery: Delivery
  work: WorkRecord[]
  context: ContextRecord[]
}

/** Characters a renderer adds around one item; used only for the budget estimate. */
const ITEM_OVERHEAD = 64

function renderFindings(findings: ClassifiedFinding[]): Finding[] {
  const merged = new Map<string, Finding>()
  for (const { rule, match } of findings) {
    const message = renderTemplate(rule.message ?? "", {
      ...match.captures,
      file: match.file,
      line: String(match.line),
      column: String(match.column),
      text: match.text,
      rule: rule.id,
    })
    const key = `${rule.id} ${match.file} ${message}`
    const existing = merged.get(key)
    if (existing) existing.count++
    else
      merged.set(key, {
        rule: rule.id,
        severity: rule.severity,
        status: "new",
        file: match.file,
        line: match.line,
        column: match.column,
        message,
        count: 1,
      })
  }
  return [...merged.values()].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  )
}

function referencesInOrder(rules: CompiledRule[]): ReferenceSpec[] {
  const seen = new Set<string>()
  const specs: ReferenceSpec[] = []
  for (const rule of rules) {
    for (const spec of rule.context) {
      if (seen.has(spec.ref)) continue
      seen.add(spec.ref)
      specs.push(spec)
    }
  }
  return specs
}

async function isCovered(
  spec: ReferenceSpec,
  delivered: ContextState["delivered"],
  resolver: ReferenceResolver,
): Promise<boolean> {
  for (const entry of delivered) {
    if (entry.path !== spec.path) continue
    if (!(await resolver.contains(spec.path, entry.anchor, spec.anchor))) continue
    if ((await resolver.currentHash(entry.path, entry.anchor)) === entry.hash) return true
  }
  return false
}

export async function decide(input: DecideInput): Promise<Decision> {
  const delivery = emptyDelivery()
  const work: WorkRecord[] = []
  const context: ContextRecord[] = []

  // Findings and pre-existing summaries.
  const fresh = input.findings.filter((finding) => finding.status === "new")
  delivery.findings = renderFindings(fresh)
  const summaries = new Map<string, { rule: string; file: string; count: number }>()
  for (const { rule, match, status } of input.findings) {
    if (status !== "preexisting") continue
    const key = preexistingKey(rule.id, match.file)
    if (input.context.preexisting.has(key)) continue
    const summary = summaries.get(key) ?? { rule: rule.id, file: match.file, count: 0 }
    summary.count++
    summaries.set(key, summary)
  }
  delivery.preexistingSummary = [...summaries.values()]
  for (const summary of delivery.preexistingSummary) {
    context.push({ t: "preexisting", rule: summary.rule, file: summary.file })
  }

  // Warnings, once per context.
  for (const warning of input.warnings) {
    if (input.context.warned.has(warning.key)) continue
    delivery.warnings.push(warning.text)
    context.push({ t: "warned", key: warning.key })
  }

  // Touches.
  delivery.touches = input.touches.map((rule) => rule.id)
  for (const rule of input.touches) context.push({ t: "touched", rule: rule.id })

  // A complete read by the agent counts as delivered.
  const delivered = [...input.context.delivered]
  if (input.agentRead !== null) {
    const hash = await input.resolver.currentHash(input.agentRead, null)
    if (hash !== null) {
      delivered.push({ path: input.agentRead, anchor: null, hash })
      context.push({ t: "delivered", path: input.agentRead, anchor: null, hash })
    }
  }

  // References.
  const ruleOrder = [
    ...new Map(fresh.map((finding) => [finding.rule.id, finding.rule])).values(),
    ...input.touches,
  ]
  const candidates: { index: number; resolved: Extract<ResolvedRef, { found: true }> }[] = []
  for (const spec of referencesInOrder(ruleOrder)) {
    const resolved = await input.resolver.resolve(spec)
    if (!resolved.found) {
      delivery.references.push({ ref: spec.ref, state: "missing" })
    } else if (await isCovered(spec, delivered, input.resolver)) {
      delivery.references.push({ ref: spec.ref, state: "pointer" })
    } else if (spec.mode === "read") {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "mode" })
    } else if (resolved.bytes > input.maxBytes) {
      delivery.references.push({ ref: spec.ref, state: "read", reason: "tooLarge" })
    } else {
      candidates.push({ index: delivery.references.length, resolved })
      delivery.references.push({ ref: spec.ref, state: "full", content: resolved.content })
    }
  }

  // Budget: findings, summaries and warnings always fit; references fill what is left, in order.
  let used =
    delivery.findings.reduce((sum, f) => sum + f.message.length + f.file.length + ITEM_OVERHEAD, 0) +
    delivery.preexistingSummary.reduce((sum, s) => sum + s.rule.length + s.file.length + ITEM_OVERHEAD, 0) +
    delivery.warnings.reduce((sum, w) => sum + w.length + ITEM_OVERHEAD, 0) +
    delivery.references.reduce((sum, r) => sum + (r.state === "full" ? 0 : r.ref.length + ITEM_OVERHEAD), 0)
  for (const { index, resolved } of candidates) {
    const size = resolved.content.length + resolved.spec.ref.length + ITEM_OVERHEAD
    if (input.maxContextChars !== null && used + size > input.maxContextChars) {
      delivery.references[index] = { ref: resolved.spec.ref, state: "read", reason: "budget" } satisfies DeliveredReference
      continue
    }
    used += size
    context.push({ t: "delivered", path: resolved.spec.path, anchor: resolved.spec.anchor, hash: resolved.hash })
  }

  // Stop gate.
  if (input.stopGate) {
    const newErrors = delivery.findings.some((finding) => finding.severity === "error")
    const blocks = input.work.stopBlocks.get(input.agent) ?? 0
    if (!newErrors) delivery.stop = "allow"
    else if (blocks < input.maxBlocks) {
      delivery.stop = "block"
      work.push({ t: "stopBlock", agent: input.agent })
    } else delivery.stop = "capReached"
  }

  return { delivery, work, context }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core/session/decide-findings.test.ts && pnpm typecheck`
Expected: 7 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/session/decide.ts test/helpers/resolver.ts test/core/session/decide-findings.test.ts
git commit -m "feat: decide findings, summaries, warnings and stop gate

Claude goes brr.. via Dash"
```

---

### Task 25: Decide references

**Files:**
- Test: `test/core/session/decide-references.test.ts`

- [ ] **Step 1: Write the tests**

`test/core/session/decide-references.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { fnv1a } from "../../../src/core/baseline/hash"
import { decide, type DecideInput } from "../../../src/core/session/decide"
import { parseReference } from "../../../src/core/references"
import { emptyContext, emptyWork } from "../../../src/core/session/state"
import { fakeResolver } from "../../helpers/resolver"
import { rule } from "../../helpers/rules"

const files = {
  "conventions/api.md": "# API\n## Errors\nMap.\n### Retries\nTwice.",
  "conventions/api.md#errors": "## Errors\nMap.\n### Retries\nTwice.",
  "conventions/api.md#retries": "### Retries\nTwice.",
  "conventions/state.md": "# State",
  "conventions/big.md": "x".repeat(500),
}
const resolver = fakeResolver(files, { "conventions/api.md#errors": ["retries"] })

const ref = (text: string, mode: "inject" | "read" = "inject") => parseReference(text, mode)

const violated = (id: string, context: ReturnType<typeof ref>[]) => ({
  rule: rule({ id, message: "m", context }),
  match: { file: "a.ts", line: 1, endLine: 1, column: 1, text: "", captures: {} },
  status: "new" as const,
})

function input(overrides: Partial<DecideInput>): DecideInput {
  return {
    agent: "main",
    findings: [],
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver,
    maxBytes: 100,
    maxBlocks: 3,
    maxContextChars: null,
    stopGate: false,
    ...overrides,
  }
}

describe("decide: references", () => {
  test("each ref once, in order of first appearance, with states by mode, size and existence", async () => {
    const decision = await decide(
      input({
        findings: [
          violated("r1", [ref("@conventions/api.md#errors"), ref("@conventions/state.md", "read")]),
          violated("r2", [ref("@conventions/api.md#errors"), ref("@conventions/big.md"), ref("@conventions/gone.md")]),
        ],
      }),
    )
    expect(decision.delivery.references).toEqual([
      { ref: "conventions/api.md#errors", state: "full", content: files["conventions/api.md#errors"] },
      { ref: "conventions/state.md", state: "read", reason: "mode" },
      { ref: "conventions/big.md", state: "read", reason: "tooLarge" },
      { ref: "conventions/gone.md", state: "missing" },
    ])
    expect(decision.context).toEqual([
      { t: "delivered", path: "conventions/api.md", anchor: "errors", hash: fnv1a(files["conventions/api.md#errors"]) },
    ])
  })

  test("delivered content covers itself and its subsections while unchanged", async () => {
    const context = emptyContext()
    context.delivered.push({ path: "conventions/api.md", anchor: "errors", hash: fnv1a(files["conventions/api.md#errors"]) })
    const decision = await decide(
      input({
        context,
        findings: [violated("r", [ref("@conventions/api.md#retries"), ref("@conventions/api.md#errors"), ref("@conventions/api.md")])],
      }),
    )
    expect(decision.delivery.references.map((r) => [r.ref, r.state])).toEqual([
      ["conventions/api.md#retries", "pointer"],
      ["conventions/api.md#errors", "pointer"],
      ["conventions/api.md", "full"],
    ])
  })

  test("changed content is delivered again", async () => {
    const context = emptyContext()
    context.delivered.push({ path: "conventions/state.md", anchor: null, hash: fnv1a("# Old state") })
    const decision = await decide(input({ context, findings: [violated("r", [ref("@conventions/state.md")])] }))
    expect(decision.delivery.references[0]!.state).toBe("full")
  })

  test("a complete read by the agent covers later references to that file", async () => {
    const decision = await decide(
      input({
        agentRead: "conventions/api.md",
        touches: [rule({ id: "t", on: ["touch"], detector: null, message: null, context: [ref("@conventions/api.md#retries")] })],
      }),
    )
    expect(decision.delivery.touches).toEqual(["t"])
    expect(decision.delivery.references).toEqual([{ ref: "conventions/api.md#retries", state: "pointer" }])
    expect(decision.context).toEqual([
      { t: "touched", rule: "t" },
      { t: "delivered", path: "conventions/api.md", anchor: null, hash: fnv1a(files["conventions/api.md"]) },
    ])
  })

  test("references beyond the budget become read and are not recorded", async () => {
    const decision = await decide(
      input({
        maxContextChars: 160,
        findings: [violated("r", [ref("@conventions/state.md"), ref("@conventions/api.md#errors")])],
      }),
    )
    expect(decision.delivery.references.map((r) => [r.ref, r.state, r.reason])).toEqual([
      ["conventions/state.md", "full", undefined],
      ["conventions/api.md#errors", "read", "budget"],
    ])
    expect(decision.context.map((record) => record.t === "delivered" && record.path)).toEqual(["conventions/state.md"])
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run test/core/session/decide-references.test.ts`
Expected: 5 tests pass (the implementation from Task 24 already covers them). If the budget test fails, check the arithmetic: finding `m` in `a.ts` costs 1 + 4 + 64 = 69; `conventions/state.md` costs 7 + 20 + 64 = 91 (total 160, fits); the section does not.

- [ ] **Step 3: Commit**

```bash
git add test/core/session/decide-references.test.ts
git commit -m "test: cover reference coverage, modes and budget

Claude goes brr.. via Dash"
```

---

### Task 26: Session directories and commit under lock

**Files:**
- Create: `src/core/session/session.ts`
- Test: `test/core/session/session.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/session/session.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { appendContext, appendWork, commitSession, openSession, sessionDir } from "../../../src/core/session/session"
import { emptyDelivery } from "../../../src/core/types"
import { createProject } from "../../helpers/project"

describe("session", () => {
  test("session directories sanitise ids", async () => {
    expect(sessionDir("/repo", "abc-123_x.y")).toBe("/repo/.rulecast/.state/sessions/abc-123_x.y")
    expect(sessionDir("/repo", "../evil/id")).toBe("/repo/.rulecast/.state/sessions/.._evil_id")
  })

  test("work is shared across agents, context is per agent", async () => {
    const dir = sessionDir(await createProject({}), "s1")
    await appendWork(dir, [{ t: "edited", file: "a.ts" }])
    await appendContext(dir, "main", [{ t: "touched", rule: "r" }])
    const main = await openSession(dir, "main")
    const sub = await openSession(dir, "sub/1")
    expect(main.work.edited).toEqual(["a.ts"])
    expect(sub.work.edited).toEqual(["a.ts"])
    expect(main.context.touched).toEqual(new Set(["r"]))
    expect(sub.context.touched).toEqual(new Set())
  })

  test("commit re-reads state under the lock and appends the decision's records", async () => {
    const dir = sessionDir(await createProject({}), "s1")
    const commit = () =>
      commitSession(dir, "main", async (view) => {
        const alreadyWarned = view.context.warned.has("w")
        return {
          delivery: { ...emptyDelivery(), warnings: alreadyWarned ? [] : ["once"] },
          work: [{ t: "stopBlock", agent: "main" }],
          context: alreadyWarned ? [] : [{ t: "warned", key: "w" }],
        }
      })
    const results = await Promise.all([commit(), commit()])
    // Whichever commit takes the lock first warns; the other sees its record.
    expect(results.map((delivery) => delivery.warnings.join()).sort()).toEqual(["", "once"])
    const view = await openSession(dir, "main")
    expect(view.work.stopBlocks.get("main")).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/session/session.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/session/session`.

- [ ] **Step 3: Create `src/core/session/session.ts`**

```ts
import path from "node:path"

import { appendRecords, readRecords } from "../jsonl"
import type { Delivery } from "../types"
import type { Decision } from "./decide"
import { withLock } from "./lock"
import { foldContext, foldWork, type ContextRecord, type ContextState, type WorkRecord, type WorkState } from "./state"

export interface SessionView {
  work: WorkState
  context: ContextState
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

export function sessionDir(root: string, sessionId: string): string {
  return path.join(root, ".rulecast", ".state", "sessions", safeSegment(sessionId))
}

const workFile = (dir: string) => path.join(dir, "work.jsonl")
const contextFile = (dir: string, agent: string) => path.join(dir, `context.${safeSegment(agent)}.jsonl`)

export async function appendWork(dir: string, records: WorkRecord[]): Promise<void> {
  await appendRecords(workFile(dir), records)
}

export async function appendContext(dir: string, agent: string, records: ContextRecord[]): Promise<void> {
  await appendRecords(contextFile(dir, agent), records)
}

export async function openSession(dir: string, agent: string): Promise<SessionView> {
  const [work, context] = await Promise.all([
    readRecords<WorkRecord>(workFile(dir)),
    readRecords<ContextRecord>(contextFile(dir, agent)),
  ])
  return { work: foldWork(work), context: foldContext(context) }
}

/** Re-reads the session under the lock, decides, appends the decision's records. */
export async function commitSession(
  dir: string,
  agent: string,
  decideWith: (view: SessionView) => Promise<Decision>,
): Promise<Delivery> {
  return withLock(dir, async () => {
    const decision = await decideWith(await openSession(dir, agent))
    await appendWork(dir, decision.work)
    await appendContext(dir, agent, decision.context)
    return decision.delivery
  })
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/session && pnpm typecheck`
Expected: all session tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/session.ts test/core/session/session.test.ts
git commit -m "feat: open and commit sessions under lock

Claude goes brr.. via Dash"
```

---

### Task 27: Agent text renderer

**Files:**
- Create: `src/core/delivery/render-agent.ts`
- Test: `test/core/delivery/render-agent.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/delivery/render-agent.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { emptyDelivery, type Finding } from "../../../src/core/types"

const finding = (overrides: Partial<Finding>): Finding => ({
  rule: "api/no-client",
  severity: "error",
  status: "new",
  file: "src/Card.tsx",
  line: 3,
  column: 1,
  message: "src/Card.tsx:3 imports the client.\nUse a query hook.",
  count: 1,
  ...overrides,
})

describe("renderAgentText", () => {
  test("an empty delivery renders nothing", () => {
    expect(renderAgentText(emptyDelivery(), { maxMatchesPerRule: 10 })).toBe("")
  })

  test("renders findings, summaries, references and warnings", () => {
    const text = renderAgentText(
      {
        ...emptyDelivery(),
        findings: [finding({ count: 2 }), finding({ rule: "style/x", severity: "warning", message: "consider x", line: 9 })],
        preexistingSummary: [{ rule: "backend/y", file: "src/Card.tsx", count: 4 }],
        references: [
          { ref: "conventions/api.md#errors", state: "full", content: "## Errors\nMap them." },
          { ref: "conventions/state.md", state: "read", reason: "mode" },
          { ref: "conventions/big.md", state: "read", reason: "budget" },
          { ref: "conventions/design.md#spacing", state: "pointer" },
          { ref: "conventions/gone.md", state: "missing" },
        ],
        warnings: ["rule r1 disabled: detector failed"],
      },
      { maxMatchesPerRule: 10 },
    )
    expect(text).toBe(
      [
        "rulecast: 2 rules violated in src/Card.tsx",
        "",
        "error api/no-client",
        "  src/Card.tsx:3 imports the client.",
        "  Use a query hook. (×2)",
        "",
        "warning style/x",
        "  consider x",
        "",
        "pre-existing (not blocking): backend/y ×4 in src/Card.tsx",
        "",
        "--- conventions/api.md#errors ---",
        "## Errors",
        "Map them.",
        "",
        "--- conventions/state.md: read this before continuing ---",
        "--- conventions/big.md: read this before continuing (not included, too long for this message) ---",
        "--- conventions/design.md#spacing (provided earlier in this session) ---",
        "--- conventions/gone.md (missing) ---",
        "",
        "rulecast warnings:",
        "  - rule r1 disabled: detector failed",
      ].join("\n"),
    )
  })

  test("caps findings per rule and names the files of the rest", () => {
    const findings = [1, 2, 3, 4].map((line) => finding({ line, file: line > 2 ? "b.ts" : "a.ts", message: `m${line}` }))
    const text = renderAgentText({ ...emptyDelivery(), findings }, { maxMatchesPerRule: 2 })
    expect(text).toBe(["rulecast: 1 rule violated", "", "error api/no-client", "  m1", "  m2", "  …and 2 more in 1 file"].join("\n"))
  })

  test("touch-only deliveries get a conventions header", () => {
    const text = renderAgentText(
      { ...emptyDelivery(), touches: ["api/touch"], references: [{ ref: "conventions/api.md", state: "full", content: "# API" }] },
      { maxMatchesPerRule: 10 },
    )
    expect(text).toBe(["rulecast: conventions for the files you are working on", "", "--- conventions/api.md ---", "# API"].join("\n"))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/delivery/render-agent.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/delivery/render-agent`.

- [ ] **Step 3: Create `src/core/delivery/render-agent.ts`**

```ts
import type { DeliveredReference, Delivery, Finding } from "../types"

export interface RenderOptions {
  maxMatchesPerRule: number
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function header(delivery: Delivery): string | null {
  if (delivery.findings.length > 0) {
    const rules = new Set(delivery.findings.map((finding) => finding.rule)).size
    const files = new Set(delivery.findings.map((finding) => finding.file))
    const where = files.size === 1 ? ` in ${[...files][0]}` : ""
    return `rulecast: ${plural(rules, "rule")} violated${where}`
  }
  if (delivery.references.length > 0 || delivery.preexistingSummary.length > 0) {
    return "rulecast: conventions for the files you are working on"
  }
  return null
}

function findingLines(finding: Finding): string[] {
  const lines = finding.message.split("\n").map((line) => `  ${line}`)
  if (finding.count > 1) lines[lines.length - 1] += ` (×${finding.count})`
  return lines
}

function referenceLines(reference: DeliveredReference): string[] {
  switch (reference.state) {
    case "full":
      return [`--- ${reference.ref} ---`, ...(reference.content ?? "").split("\n"), ""]
    case "pointer":
      return [`--- ${reference.ref} (provided earlier in this session) ---`]
    case "missing":
      return [`--- ${reference.ref} (missing) ---`]
    case "read":
      return reference.reason === "mode"
        ? [`--- ${reference.ref}: read this before continuing ---`]
        : [`--- ${reference.ref}: read this before continuing (not included, too long for this message) ---`]
  }
}

export function renderAgentText(delivery: Delivery, options: RenderOptions): string {
  const title = header(delivery)
  if (title === null && delivery.warnings.length === 0) return ""
  const out: string[] = []
  if (title !== null) out.push(title, "")

  const byRule = new Map<string, Finding[]>()
  for (const finding of delivery.findings) byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding])
  for (const [rule, findings] of byRule) {
    out.push(`${findings[0]!.severity} ${rule}`)
    for (const finding of findings.slice(0, options.maxMatchesPerRule)) out.push(...findingLines(finding))
    const rest = findings.slice(options.maxMatchesPerRule)
    if (rest.length > 0) {
      out.push(`  …and ${rest.length} more in ${plural(new Set(rest.map((finding) => finding.file)).size, "file")}`)
    }
    out.push("")
  }

  for (const summary of delivery.preexistingSummary) {
    out.push(`pre-existing (not blocking): ${summary.rule} ×${summary.count} in ${summary.file}`)
  }
  if (delivery.preexistingSummary.length > 0) out.push("")

  for (const reference of delivery.references) out.push(...referenceLines(reference))
  if (out.length > 0 && out.at(-1) !== "") out.push("")

  if (delivery.warnings.length > 0) {
    out.push("rulecast warnings:", ...delivery.warnings.map((warning) => `  - ${warning}`))
  }
  while (out.at(-1) === "") out.pop()
  return out.join("\n")
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/delivery && pnpm typecheck`
Expected: all delivery tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/delivery/render-agent.ts test/core/delivery/render-agent.test.ts
git commit -m "feat: render deliveries as agent text

Claude goes brr.. via Dash"
```
