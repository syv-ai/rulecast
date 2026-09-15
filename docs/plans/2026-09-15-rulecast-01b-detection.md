# rulecast Plan 1b — Detection Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The detector contract in practice: `perRule`, the `regex` and `path` detectors, detector caches, rule selection, and a detection runner that batches per detector kind, runs kinds in parallel and enforces a deadline.

**Architecture:** Detectors are plain objects satisfying `Detector<Config>` (from `src/core/types.ts`). The runner groups selected rules by detector kind, calls each detector once, validates declared captures, and turns thrown errors, per-rule errors and timeouts into structured output. Spec: `docs/specs/2026-09-15-rulecast-design.md` §6, §10, §13, §14.

**Tech Stack:** Node ≥ 20, TypeScript 5, vitest, zod 3, picomatch.

Prerequisite: `2026-09-15-rulecast-01a-compile.md` is done. Continue with `2026-09-15-rulecast-01c-baseline.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/detection/positions.ts` | Offset → 1-based line and column |
| `src/core/detection/per-rule.ts` | `perRule` helper and `readSourceFile` |
| `src/detectors/regex.ts` | `regex` detector |
| `src/detectors/path.ts` | `path` detector |
| `src/detectors/index.ts` | Built-in detector list |
| `src/core/detection/cache.ts` | `diskCache`, `memoryCache` |
| `src/core/detection/select.ts` | Rule × file selection for events |
| `src/core/detection/run.ts` | Batched, parallel, deadline-bound detection |

---

### Task 9: Positions and `perRule`

**Files:**
- Create: `src/core/detection/positions.ts`, `src/core/detection/per-rule.ts`
- Test: `test/core/detection/positions.test.ts`, `test/core/detection/per-rule.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/core/detection/positions.test.ts`:
```ts
import { expect, test } from "vitest"

import { lineStarts, positionAt } from "../../../src/core/detection/positions"

test("positionAt maps offsets to 1-based line and column", () => {
  const text = "ab\ncd\r\nef"
  const starts = lineStarts(text)
  expect(starts).toEqual([0, 3, 7])
  expect(positionAt(starts, 0)).toEqual({ line: 1, column: 1 })
  expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 })
  expect(positionAt(starts, 8)).toEqual({ line: 3, column: 2 })
})
```

`test/core/detection/per-rule.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { perRule } from "../../../src/core/detection/per-rule"
import { memoryCache } from "../../../src/core/detection/cache"
import type { DetectorRun, Match } from "../../../src/core/types"

function run(rules: string[]): DetectorRun<null> {
  return {
    event: "edit",
    rules: rules.map((id) => ({ id, config: null, files: ["a.ts"], context: [] })),
    changes: new Map(),
    cache: memoryCache(),
    cwd: "/tmp",
    signal: new AbortController().signal,
  }
}

const match: Match = { file: "a.ts", line: 1, endLine: 1, column: 1, text: "x", captures: {} }

describe("perRule", () => {
  test("attributes matches to their rule and isolates errors", async () => {
    const detect = perRule<null>(async (rule) => {
      if (rule.id === "broken") throw new Error("bad input")
      return [match]
    })
    expect(await detect(run(["ok", "broken"]))).toEqual({
      findings: [{ rule: "ok", match }],
      errors: [{ rule: "broken", message: "bad input" }],
    })
  })

  test("rethrows once the run is aborted", async () => {
    const controller = new AbortController()
    const input = { ...run(["a"]), signal: controller.signal }
    const detect = perRule<null>(async () => {
      controller.abort()
      throw new Error("aborted work")
    })
    await expect(detect(input)).rejects.toThrow("aborted work")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core/detection`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 3: Create `src/core/detection/positions.ts`**

```ts
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

/** 1-based line and column of a string offset. */
export function positionAt(starts: number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return { line: low + 1, column: offset - starts[low]! + 1 }
}
```

- [ ] **Step 4: Create `src/core/detection/cache.ts` with `memoryCache` only**

(The disk cache is added in Task 12; `per-rule.test.ts` needs `memoryCache` now.)

```ts
import type { Cache } from "../types"

export function memoryCache(): Cache {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return values.has(key) ? (structuredClone(values.get(key)) as T) : undefined
    },
    async set(key, value) {
      values.set(key, structuredClone(value))
    },
  }
}
```

- [ ] **Step 5: Create `src/core/detection/per-rule.ts`**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"

import { errorMessage, isNotFound } from "../errors"
import type { Detector, DetectorResult, DetectorRuleInput, DetectorRun, Match } from "../types"

/** Turns a per-rule function into a detector run; an error in one rule does not affect the others. */
export function perRule<Config>(
  detect: (rule: DetectorRuleInput<Config>, input: DetectorRun<Config>) => Promise<Match[]>,
): Detector<Config>["run"] {
  return async (input) => {
    const result: DetectorResult = { findings: [], errors: [] }
    await Promise.all(
      input.rules.map(async (rule) => {
        try {
          for (const match of await detect(rule, input)) result.findings.push({ rule: rule.id, match })
        } catch (error) {
          if (input.signal.aborted) throw error
          result.errors.push({ rule: rule.id, message: errorMessage(error) })
        }
      }),
    )
    return result
  }
}

/** Reads a repo-relative file; null when it no longer exists. */
export async function readSourceFile(cwd: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.join(cwd, file), "utf8")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/core/detection && pnpm typecheck`
Expected: 3 tests pass; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/detection test/core/detection
git commit -m "feat: add perRule helper, positions and memory cache

Claude goes brr.. via Dash"
```

---

### Task 10: `regex` detector

**Files:**
- Create: `src/detectors/regex.ts`
- Test: `test/detectors/regex.test.ts`

- [ ] **Step 1: Write the failing test**

`test/detectors/regex.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { regexDetector } from "../../src/detectors/regex"
import { createProject } from "../helpers/project"

describe("regex detector", () => {
  test("schema applies default flags and rejects invalid patterns", () => {
    expect(regexDetector.schema.parse({ pattern: "a" })).toEqual({ pattern: "a", flags: "" })
    expect(regexDetector.schema.safeParse({ pattern: "(" }).success).toBe(false)
    expect(regexDetector.schema.safeParse({ pattern: "a", flags: "x" }).success).toBe(false)
  })

  test("captures are the pattern's named groups", () => {
    expect(regexDetector.captures({ pattern: "(?<name>\\w+)(?<=x)(?<args>.*)", flags: "" })).toEqual(["name", "args"])
    expect(regexDetector.events({ pattern: "a", flags: "" })).toEqual(["edit", "verify"])
  })

  test("reports every match with positions and captures", async () => {
    const cwd = await createProject({
      "app/services/users.py": "def get():\n    raise HTTPException(404)\n    raise HTTPException(\n        403)\n",
    })
    const result = await regexDetector.run({
      event: "edit",
      rules: [
        {
          id: "no-httpexception",
          config: regexDetector.schema.parse({ pattern: "raise HTTPException\\((?<args>[^)]*)\\)" }),
          files: ["app/services/users.py", "app/services/deleted.py"],
          context: [],
        },
      ],
      changes: new Map(),
      cache: memoryCache(),
      cwd,
      signal: new AbortController().signal,
    })
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 2,
          endLine: 2,
          column: 5,
          text: "raise HTTPException(404)",
          captures: { args: "404" },
        },
      },
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 3,
          endLine: 4,
          column: 5,
          text: "raise HTTPException(\n        403)",
          captures: { args: "\n        403" },
        },
      },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/detectors/regex.test.ts`
Expected: FAIL, cannot resolve `../../src/detectors/regex`.

- [ ] **Step 3: Create `src/detectors/regex.ts`**

```ts
import { z } from "zod"

import { perRule, readSourceFile } from "../core/detection/per-rule"
import { lineStarts, positionAt } from "../core/detection/positions"
import { errorMessage } from "../core/errors"
import type { Detector, Match } from "../core/types"

const schema = z
  .object({
    pattern: z.string().min(1),
    flags: z.string().regex(/^[dimsuvy]*$/, "allowed flags: d i m s u v y").default(""),
  })
  .strict()
  .superRefine((config, ctx) => {
    try {
      new RegExp(config.pattern, config.flags)
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: errorMessage(error) })
    }
  })

type RegexConfig = z.infer<typeof schema>

const NAMED_GROUP = /\(\?<([A-Za-z_$][\w$]*)>/g

function groupNames(pattern: string): string[] {
  return [...new Set([...pattern.matchAll(NAMED_GROUP)].map((match) => match[1]!))]
}

export const regexDetector: Detector<RegexConfig> = {
  kind: "regex",
  schema,
  captures: (config) => groupNames(config.pattern),
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    const names = groupNames(rule.config.pattern)
    const matches: Match[] = []
    for (const file of rule.files) {
      input.signal.throwIfAborted()
      const text = await readSourceFile(input.cwd, file)
      if (text === null) continue
      const starts = lineStarts(text)
      for (const found of text.matchAll(new RegExp(rule.config.pattern, `${rule.config.flags}g`))) {
        const start = found.index
        const end = start + found[0].length
        const from = positionAt(starts, start)
        const to = positionAt(starts, Math.max(start, end - 1))
        matches.push({
          file,
          line: from.line,
          endLine: to.line,
          column: from.column,
          text: found[0],
          captures: Object.fromEntries(names.map((name) => [name, found.groups?.[name] ?? ""])),
        })
      }
    }
    return matches
  }),
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/detectors/regex.test.ts && pnpm typecheck`
Expected: 3 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/detectors/regex.ts test/detectors/regex.test.ts
git commit -m "feat: add regex detector

Claude goes brr.. via Dash"
```

---

### Task 11: `path` detector and built-in list

**Files:**
- Create: `src/detectors/path.ts`, `src/detectors/index.ts`
- Test: `test/detectors/path.test.ts`

- [ ] **Step 1: Write the failing test**

`test/detectors/path.test.ts`:
```ts
import { expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { pathDetector } from "../../src/detectors/path"
import { builtinDetectors } from "../../src/detectors"
import { createProject } from "../helpers/project"

test("path detector matches each existing file across all its lines", async () => {
  const cwd = await createProject({ "src/client/api.ts": "export const a = 1\nexport const b = 2\n" })
  expect(pathDetector.schema.safeParse({ extra: true }).success).toBe(false)
  expect(pathDetector.captures({})).toEqual([])
  const result = await pathDetector.run({
    event: "edit",
    rules: [{ id: "no-generated-edits", config: {}, files: ["src/client/api.ts", "src/client/gone.ts"], context: [] }],
    changes: new Map(),
    cache: memoryCache(),
    cwd,
    signal: new AbortController().signal,
  })
  expect(result).toEqual({
    findings: [
      {
        rule: "no-generated-edits",
        match: { file: "src/client/api.ts", line: 1, endLine: 3, column: 1, text: "src/client/api.ts", captures: {} },
      },
    ],
    errors: [],
  })
})

test("built-in detectors have unique kinds", () => {
  expect(builtinDetectors.map((detector) => detector.kind)).toEqual(["regex", "path"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/detectors/path.test.ts`
Expected: FAIL, cannot resolve `../../src/detectors/path`.

- [ ] **Step 3: Create `src/detectors/path.ts`**

```ts
import { z } from "zod"

import { perRule, readSourceFile } from "../core/detection/per-rule"
import type { Detector, Match } from "../core/types"

const schema = z.object({}).strict()

export const pathDetector: Detector<z.infer<typeof schema>> = {
  kind: "path",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: perRule(async (rule, input) => {
    const matches: Match[] = []
    for (const file of rule.files) {
      const text = await readSourceFile(input.cwd, file)
      if (text === null) continue
      // The whole file, so any change in it counts as new (spec §8).
      matches.push({ file, line: 1, endLine: text.split(/\r?\n/).length, column: 1, text: file, captures: {} })
    }
    return matches
  }),
}
```

- [ ] **Step 4: Create `src/detectors/index.ts`**

```ts
import type { AnyDetector } from "../core/detection/registry"
import { pathDetector } from "./path"
import { regexDetector } from "./regex"

export const builtinDetectors: readonly AnyDetector[] = [regexDetector, pathDetector]
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/detectors && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/detectors test/detectors/path.test.ts
git commit -m "feat: add path detector and built-in detector list

Claude goes brr.. via Dash"
```

---

### Task 12: Disk cache

**Files:**
- Modify: `src/core/detection/cache.ts`
- Test: `test/core/detection/cache.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/detection/cache.test.ts`:
```ts
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { diskCache, memoryCache } from "../../../src/core/detection/cache"

describe.each([
  ["memory", async () => memoryCache()],
  ["disk", async () => diskCache(path.join(await mkdtemp(path.join(tmpdir(), "rulecast-cache-")), "regex"))],
])("%s cache", (_, create) => {
  test("returns undefined for unknown keys and round-trips JSON values", async () => {
    const cache = await create()
    expect(await cache.get("missing")).toBeUndefined()
    await cache.set("key:with/odd chars", { lines: [1, 2], ok: true })
    expect(await cache.get("key:with/odd chars")).toEqual({ lines: [1, 2], ok: true })
  })

  test("returned values are copies", async () => {
    const cache = await create()
    await cache.set("k", { list: [1] })
    const value = await cache.get<{ list: number[] }>("k")
    value!.list.push(2)
    expect(await cache.get("k")).toEqual({ list: [1] })
  })
})

test("disk cache leaves no temporary files", async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-cache-")), "regex")
  const cache = diskCache(dir)
  await Promise.all([cache.set("a", 1), cache.set("a", 2), cache.set("b", 3)])
  expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/detection/cache.test.ts`
Expected: FAIL, `diskCache` is not exported.

- [ ] **Step 3: Replace `src/core/detection/cache.ts`**

```ts
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"
import type { Cache } from "../types"

export function memoryCache(): Cache {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return values.has(key) ? (structuredClone(values.get(key)) as T) : undefined
    },
    async set(key, value) {
      values.set(key, structuredClone(value))
    },
  }
}

/** One JSON file per key; writes go through a temp file and rename, so readers never see partial values. */
export function diskCache(dir: string): Cache {
  const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex")}.json`)
  return {
    async get<T>(key: string) {
      try {
        return JSON.parse(await readFile(fileFor(key), "utf8")) as T
      } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
      }
    },
    async set(key, value) {
      await mkdir(dir, { recursive: true })
      const target = fileFor(key)
      const temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(value))
      await rename(temp, target)
    },
  }
}

/** Cache directory for a detector kind inside a project. */
export function detectorCacheDir(root: string, kind: string): string {
  return path.join(root, ".rulecast", ".state", "cache", kind)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/detection && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/detection/cache.ts test/core/detection/cache.test.ts
git commit -m "feat: add disk-backed detector cache

Claude goes brr.. via Dash"
```

---

### Task 13: Rule selection

**Files:**
- Create: `src/core/detection/select.ts`
- Create: `test/helpers/rules.ts`
- Test: `test/core/detection/select.test.ts`

- [ ] **Step 1: Create `test/helpers/rules.ts`**

```ts
import picomatch from "picomatch"

import type { CompiledRule } from "../../src/core/compile/compile"

/** Builds a CompiledRule for tests without going through compile(). */
export function rule(overrides: Partial<Omit<CompiledRule, "matches">> & { id: string; files?: string }): CompiledRule {
  const { files = "**", ...rest } = overrides
  const include = picomatch(files, { dot: true })
  return {
    source: `.rulecast/rules/${overrides.id}.yml`,
    severity: "error",
    on: ["violation"],
    detector: { kind: "regex", config: { pattern: "x", flags: "" }, captures: [], events: ["edit", "verify"] },
    message: "{{file}}:{{line}}",
    context: [],
    matches: (file) => include(file),
    ...rest,
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/core/detection/select.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { selectTouchRules, selectViolationRules } from "../../../src/core/detection/select"
import { rule } from "../../helpers/rules"

const tsx = rule({ id: "tsx", files: "src/**/*.tsx" })
const verifyOnly = rule({
  id: "verify-only",
  files: "src/**/*.tsx",
  detector: { kind: "regex", config: {}, captures: [], events: ["verify"] },
})
const touchOnly = rule({ id: "touch-only", files: "src/**", on: ["touch"], detector: null, message: null })
const both = rule({ id: "both", files: "backend/**", on: ["touch", "violation"] })

describe("selectViolationRules", () => {
  test("keeps violation rules for the event with their matching files", () => {
    const files = ["src/a.tsx", "src/b.ts", "backend/x.py"]
    expect(selectViolationRules([tsx, verifyOnly, touchOnly, both], "edit", files, new Set())).toEqual([
      { rule: tsx, files: ["src/a.tsx"] },
      { rule: both, files: ["backend/x.py"] },
    ])
    expect(selectViolationRules([tsx, verifyOnly], "verify", files, new Set(["tsx"]))).toEqual([
      { rule: verifyOnly, files: ["src/a.tsx"] },
    ])
  })

  test("drops rules with no matching files", () => {
    expect(selectViolationRules([tsx], "edit", ["README.md"], new Set())).toEqual([])
  })
})

describe("selectTouchRules", () => {
  test("keeps touch rules matching a file that have not fired and are not disabled", () => {
    expect(selectTouchRules([tsx, touchOnly, both], ["src/a.tsx"], new Set(), new Set())).toEqual([touchOnly])
    expect(selectTouchRules([touchOnly, both], ["src/a.tsx", "backend/x.py"], new Set(["touch-only"]), new Set())).toEqual([both])
    expect(selectTouchRules([touchOnly], ["src/a.tsx"], new Set(), new Set(["touch-only"]))).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/detection/select.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/detection/select`.

- [ ] **Step 4: Create `src/core/detection/select.ts`**

```ts
import type { CompiledRule } from "../compile/compile"
import type { DetectorEvent } from "../types"

export interface Selection {
  rule: CompiledRule
  files: string[]
}

export function selectViolationRules(
  rules: readonly CompiledRule[],
  event: DetectorEvent,
  files: readonly string[],
  disabled: ReadonlySet<string>,
): Selection[] {
  return rules
    .filter(
      (rule) =>
        rule.on.includes("violation") && rule.detector?.events.includes(event) === true && !disabled.has(rule.id),
    )
    .map((rule) => ({ rule, files: files.filter((file) => rule.matches(file)) }))
    .filter((selection) => selection.files.length > 0)
}

export function selectTouchRules(
  rules: readonly CompiledRule[],
  files: readonly string[],
  touched: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
): CompiledRule[] {
  return rules.filter(
    (rule) =>
      rule.on.includes("touch") &&
      !touched.has(rule.id) &&
      !disabled.has(rule.id) &&
      files.some((file) => rule.matches(file)),
  )
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core/detection/select.test.ts && pnpm typecheck`
Expected: 3 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/detection/select.ts test/helpers/rules.ts test/core/detection/select.test.ts
git commit -m "feat: select rules and files per event

Claude goes brr.. via Dash"
```

---

### Task 14: Detection runner

**Files:**
- Create: `src/core/detection/run.ts`
- Test: `test/core/detection/run.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/detection/run.test.ts`:
```ts
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { memoryCache } from "../../../src/core/detection/cache"
import { createRegistry } from "../../../src/core/detection/registry"
import { runDetection } from "../../../src/core/detection/run"
import type { Detector, DetectorRun, Match } from "../../../src/core/types"
import { rule } from "../../helpers/rules"

const match = (file: string, captures: Record<string, string> = {}): Match => ({
  file,
  line: 1,
  endLine: 1,
  column: 1,
  text: "x",
  captures,
})

function detector(kind: string, run: Detector<unknown>["run"]): Detector<unknown> {
  return { kind, schema: z.unknown(), captures: () => [], events: () => ["edit", "verify"], run }
}

const detectorRule = (id: string, kind: string, captures: string[] = []) =>
  rule({ id, detector: { kind, config: { id }, captures, events: ["edit", "verify"] } })

function input(selections: { rule: ReturnType<typeof rule>; files: string[] }[], detectors: Detector<unknown>[], timeoutMs = 1000) {
  return {
    root: "/project",
    event: "edit" as const,
    selections,
    changes: new Map(),
    registry: createRegistry(detectors),
    cacheFor: () => memoryCache(),
    contextFor: async () => [],
    timeoutMs,
  }
}

describe("runDetection", () => {
  test("calls each detector kind once with all its rules", async () => {
    const calls: DetectorRun<unknown>[] = []
    const a = detector("a", async (run) => {
      calls.push(run)
      return { findings: run.rules.map((r) => ({ rule: r.id, match: match(r.files[0]!) })), errors: [] }
    })
    const r1 = detectorRule("r1", "a")
    const r2 = detectorRule("r2", "a")
    const output = await runDetection(input([{ rule: r1, files: ["x.ts"] }, { rule: r2, files: ["y.ts"] }], [a]))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.rules.map((r) => [r.id, r.config, r.files])).toEqual([
      ["r1", { id: "r1" }, ["x.ts"]],
      ["r2", { id: "r2" }, ["y.ts"]],
    ])
    expect(output.findings.map((f) => [f.rule.id, f.match.file])).toEqual([
      ["r1", "x.ts"],
      ["r2", "y.ts"],
    ])
    expect(output.errors).toEqual([])
    expect(output.timedOut).toEqual([])
  })

  test("runs detector kinds in parallel", async () => {
    const order: string[] = []
    const slow = detector("slow", async () => {
      order.push("slow:start")
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push("slow:end")
      return { findings: [], errors: [] }
    })
    const fast = detector("fast", async () => {
      order.push("fast")
      return { findings: [], errors: [] }
    })
    await runDetection(
      input([{ rule: detectorRule("s", "slow"), files: ["a"] }, { rule: detectorRule("f", "fast"), files: ["a"] }], [slow, fast]),
    )
    expect(order).toEqual(["slow:start", "fast", "slow:end"])
  })

  test("per-rule errors drop that rule's findings; thrown errors fail the whole run", async () => {
    const partial = detector("partial", async () => ({
      findings: [
        { rule: "good", match: match("a") },
        { rule: "bad", match: match("a") },
      ],
      errors: [{ rule: "bad", message: "config broke" }],
    }))
    const crashing = detector("crashing", async () => {
      throw new Error("process died")
    })
    const output = await runDetection(
      input(
        [
          { rule: detectorRule("good", "partial"), files: ["a"] },
          { rule: detectorRule("bad", "partial"), files: ["a"] },
          { rule: detectorRule("c1", "crashing"), files: ["a"] },
          { rule: detectorRule("c2", "crashing"), files: ["a"] },
        ],
        [partial, crashing],
      ),
    )
    expect(output.findings.map((f) => f.rule.id)).toEqual(["good"])
    expect(output.errors).toEqual([
      { kind: "partial", rules: ["bad"], message: "config broke" },
      { kind: "crashing", rules: ["c1", "c2"], message: "process died" },
    ])
  })

  test("a match missing a declared capture is a rule error", async () => {
    const d = detector("caps", async () => ({ findings: [{ rule: "r", match: match("a", { other: "1" }) }], errors: [] }))
    const output = await runDetection(input([{ rule: detectorRule("r", "caps", ["NAMES"]), files: ["a"] }], [d]))
    expect(output.findings).toEqual([])
    expect(output.errors).toEqual([{ kind: "caps", rules: ["r"], message: 'match is missing declared capture "NAMES"' }])
  })

  test("findings for unselected rules are a whole-run error", async () => {
    const d = detector("stray", async () => ({ findings: [{ rule: "someone-else", match: match("a") }], errors: [] }))
    const output = await runDetection(input([{ rule: detectorRule("r", "stray"), files: ["a"] }], [d]))
    expect(output.errors).toEqual([{ kind: "stray", rules: ["r"], message: 'detector reported unknown rule "someone-else"' }])
  })

  test("runs past the deadline are aborted and reported as timed out", async () => {
    let aborted = false
    const hanging = detector("hanging", async (run) => {
      await new Promise((resolve) => run.signal.addEventListener("abort", resolve))
      aborted = true
      return { findings: [{ rule: "h", match: match("a") }], errors: [] }
    })
    const quick = detector("quick", async () => ({ findings: [{ rule: "q", match: match("a") }], errors: [] }))
    const output = await runDetection(
      input([{ rule: detectorRule("h", "hanging"), files: ["a"] }, { rule: detectorRule("q", "quick"), files: ["a"] }], [hanging, quick], 20),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(aborted).toBe(true)
    expect(output.findings.map((f) => f.rule.id)).toEqual(["q"])
    expect(output.timedOut).toEqual([{ kind: "hanging", rules: ["h"] }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/detection/run.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/detection/run`.

- [ ] **Step 3: Create `src/core/detection/run.ts`**

```ts
import type { CompiledRule } from "../compile/compile"
import { errorMessage } from "../errors"
import type { Cache, ChangeSet, DetectorEvent, DetectorResult, Match, ResolvedReference } from "../types"
import type { DetectorRegistry } from "./registry"
import type { Selection } from "./select"

export interface DetectionInput {
  root: string
  event: DetectorEvent
  selections: Selection[]
  changes: ReadonlyMap<string, ChangeSet>
  registry: DetectorRegistry
  cacheFor(kind: string): Cache
  contextFor(rule: CompiledRule): Promise<ResolvedReference[]>
  timeoutMs: number
}

export interface DetectionOutput {
  findings: { rule: CompiledRule; match: Match }[]
  errors: { kind: string; rules: string[]; message: string }[]
  timedOut: { kind: string; rules: string[] }[]
}

const TIMED_OUT = Symbol("timed out")

export async function runDetection(input: DetectionInput): Promise<DetectionOutput> {
  const output: DetectionOutput = { findings: [], errors: [], timedOut: [] }
  const byKind = new Map<string, Selection[]>()
  for (const selection of input.selections) {
    const kind = selection.rule.detector!.kind
    byKind.set(kind, [...(byKind.get(kind) ?? []), selection])
  }

  const controller = new AbortController()
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(TIMED_OUT), { once: true })
  })
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)

  type Outcome =
    | { status: "ok"; kind: string; selections: Selection[]; result: DetectorResult }
    | { status: "error"; kind: string; selections: Selection[]; message: string }
    | { status: "timedOut"; kind: string; selections: Selection[] }

  const perKind = await Promise.all(
    [...byKind].map(async ([kind, selections]): Promise<Outcome> => {
      const detector = input.registry.get(kind)
      if (!detector) return { status: "error", kind, selections, message: `detector "${kind}" is not registered` }
      try {
        const rules = await Promise.all(
          selections.map(async ({ rule, files }) => ({
            id: rule.id,
            config: rule.detector!.config,
            files,
            context: await input.contextFor(rule),
          })),
        )
        const result = await Promise.race([
          detector.run({
            event: input.event,
            rules,
            changes: input.changes,
            cache: input.cacheFor(kind),
            cwd: input.root,
            signal: controller.signal,
          }),
          deadline,
        ])
        if (result === TIMED_OUT) return { status: "timedOut", kind, selections }
        return { status: "ok", kind, selections, result }
      } catch (error) {
        if (controller.signal.aborted) return { status: "timedOut", kind, selections }
        return { status: "error", kind, selections, message: errorMessage(error) }
      }
    }),
  )
  clearTimeout(timer)

  for (const outcome of perKind) {
    const ids = outcome.selections.map((selection) => selection.rule.id)
    if (outcome.status === "timedOut") {
      output.timedOut.push({ kind: outcome.kind, rules: ids })
      continue
    }
    if (outcome.status === "error") {
      output.errors.push({ kind: outcome.kind, rules: ids, message: outcome.message })
      continue
    }
    const result = outcome.result
    const rulesById = new Map(outcome.selections.map((selection) => [selection.rule.id, selection.rule]))
    const stray = result.findings.find((finding) => !rulesById.has(finding.rule))
    const wholeRun = result.errors.find((error) => error.rule === null)
    if (stray || wholeRun) {
      const message = stray ? `detector reported unknown rule "${stray.rule}"` : wholeRun!.message
      output.errors.push({ kind: outcome.kind, rules: ids, message })
      continue
    }
    const failed = new Map<string, string>()
    for (const error of result.errors) failed.set(error.rule!, error.message)
    for (const finding of result.findings) {
      const rule = rulesById.get(finding.rule)!
      const missing = rule.detector!.captures.find((name) => typeof finding.match.captures[name] !== "string")
      if (missing && !failed.has(rule.id)) failed.set(rule.id, `match is missing declared capture "${missing}"`)
    }
    for (const [rule, message] of failed) output.errors.push({ kind: outcome.kind, rules: [rule], message })
    for (const finding of result.findings) {
      if (!failed.has(finding.rule)) output.findings.push({ rule: rulesById.get(finding.rule)!, match: finding.match })
    }
  }
  return output
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/detection/run.test.ts && pnpm typecheck`
Expected: 6 tests pass; typecheck exits 0.

- [ ] **Step 5: Export detection pieces from `src/index.ts`**

Append to `src/index.ts`:
```ts
export { perRule } from "./core/detection/per-rule"
export { builtinDetectors } from "./detectors"
```

- [ ] **Step 6: Run all tests and commit**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

```bash
git add src/core/detection/run.ts src/index.ts test/core/detection/run.test.ts
git commit -m "feat: run detectors batched per kind with a deadline

Claude goes brr.. via Dash"
```
