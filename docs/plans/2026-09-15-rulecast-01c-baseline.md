# rulecast Plan 1c — Baseline Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide whether a finding is new: line-hash snapshots, change sets via Myers diff, git fallbacks, the baseline store, and classification.

**Architecture:** Snapshots are `{ fileHash, lines: Uint32Array }` of whitespace-trimmed lines hashed with 32-bit FNV-1a; no file content is stored. Change sets come from diffing line-hash arrays. The store is append-only JSONL with first-writer-wins folding. Spec: `docs/specs/2026-09-15-rulecast-design.md` §8.

**Tech Stack:** Node ≥ 20, TypeScript 5, vitest, `diff` 8, git CLI.

Prerequisite: `2026-09-15-rulecast-01b-detection.md` is done. Continue with `2026-09-15-rulecast-01d-session-delivery.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/baseline/hash.ts` | FNV-1a, line hashing, snapshots |
| `src/core/baseline/changes.ts` | Changed line ranges between two snapshots |
| `src/core/jsonl.ts` | Append and read JSONL stores (shared with session) |
| `src/core/baseline/git.ts` | HEAD, file at commit, merge base, changed files |
| `src/core/baseline/store.ts` | Baseline records: session-start commit and snapshots |
| `src/core/baseline/baseline.ts` | `computeChanges`, `isNew` |
| `test/helpers/git.ts` | Temporary git repositories for tests |

---

### Task 15: Line hashing and snapshots

**Files:**
- Create: `src/core/baseline/hash.ts`
- Test: `test/core/baseline/hash.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/baseline/hash.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { fnv1a, hashLines, snapshotOf } from "../../../src/core/baseline/hash"

describe("hashing", () => {
  test("fnv1a matches the reference 32-bit values", () => {
    expect(fnv1a("")).toBe(0x811c9dc5)
    expect(fnv1a("a")).toBe(0xe40c292c)
    expect(fnv1a("foobar")).toBe(0xbf9cf968)
  })

  test("lines are trimmed before hashing", () => {
    expect([...hashLines("  a\n\tb  \r\nc")]).toEqual([fnv1a("a"), fnv1a("b"), fnv1a("c")])
  })

  test("snapshots of reindented text are equal", () => {
    const flat = snapshotOf("if x:\nrun()\n")
    const indented = snapshotOf("if x:\n    run()\n")
    expect(indented.fileHash).toBe(flat.fileHash)
    expect([...indented.lines]).toEqual([...flat.lines])
  })

  test("different content gives a different file hash", () => {
    expect(snapshotOf("a\nb").fileHash).not.toBe(snapshotOf("a\nc").fileHash)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/baseline/hash.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/baseline/hash`.

- [ ] **Step 3: Create `src/core/baseline/hash.ts`**

```ts
export interface Snapshot {
  fileHash: number
  lines: Uint32Array
}

const OFFSET_BASIS = 0x811c9dc5
const PRIME = 0x01000193

/** 32-bit FNV-1a over UTF-16 code units. Not cryptographic; only equality matters. */
export function fnv1a(text: string): number {
  let hash = OFFSET_BASIS
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, PRIME)
  }
  return hash >>> 0
}

export function hashLines(text: string): Uint32Array {
  const lines = text.split(/\r?\n/)
  const hashes = new Uint32Array(lines.length)
  lines.forEach((line, index) => {
    hashes[index] = fnv1a(line.trim())
  })
  return hashes
}

function hashOfHashes(lines: Uint32Array): number {
  let hash = OFFSET_BASIS
  for (const value of lines) {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff
      hash = Math.imul(hash, PRIME)
    }
  }
  return hash >>> 0
}

export function snapshotOf(text: string): Snapshot {
  const lines = hashLines(text)
  return { fileHash: hashOfHashes(lines), lines }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/baseline/hash.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/baseline/hash.ts test/core/baseline/hash.test.ts
git commit -m "feat: hash lines into baseline snapshots

Claude goes brr.. via Dash"
```

---

### Task 16: Change sets

**Files:**
- Create: `src/core/baseline/changes.ts`
- Test: `test/core/baseline/changes.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/baseline/changes.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { changedLines } from "../../../src/core/baseline/changes"
import { hashLines } from "../../../src/core/baseline/hash"

const changes = (before: string[], after: string[]) =>
  changedLines(hashLines(before.join("\n")), hashLines(after.join("\n")))

describe("changedLines", () => {
  test("identical content has no changes", () => {
    expect(changes(["a", "b"], ["a", "b"])).toEqual([])
  })

  test("insertion marks the inserted lines", () => {
    expect(changes(["a", "b", "c"], ["a", "x", "y", "b", "c"])).toEqual([[2, 3]])
  })

  test("replacement marks the replaced line", () => {
    expect(changes(["a", "b", "c"], ["a", "y", "c"])).toEqual([[2, 2]])
  })

  test("deletion marks the line after it", () => {
    expect(changes(["a", "b", "c"], ["a", "c"])).toEqual([[2, 2]])
  })

  test("deletion at the end marks the last line", () => {
    expect(changes(["a", "b", "c"], ["a", "b"])).toEqual([[2, 2]])
  })

  test("separate changes stay separate, adjacent ones merge", () => {
    expect(changes(["a", "b", "c", "d", "e"], ["x", "b", "c", "d", "y"])).toEqual([
      [1, 1],
      [5, 5],
    ])
    expect(changes(["a", "b", "c"], ["x", "y", "c"])).toEqual([[1, 2]])
  })

  test("reindentation is not a change", () => {
    expect(changes(["if x:", "run()"], ["if x:", "    run()"])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/baseline/changes.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/baseline/changes`.

- [ ] **Step 3: Create `src/core/baseline/changes.ts`**

```ts
import { diffArrays } from "diff"

/** 1-based inclusive ranges of lines in `after` that differ from `before`. */
export function changedLines(before: Uint32Array, after: Uint32Array): [number, number][] {
  const ranges: [number, number][] = []
  const mark = (start: number, end: number) => {
    const previous = ranges.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
  }

  let line = 1
  for (const part of diffArrays(Array.from(before), Array.from(after))) {
    const count = part.count ?? part.value.length
    if (part.added) {
      mark(line, line + count - 1)
      line += count
    } else if (part.removed) {
      // A deletion has no line of its own: mark the line that now sits where it was.
      if (after.length > 0) {
        const at = Math.min(line, after.length)
        mark(at, at)
      }
    } else {
      line += count
    }
  }
  return ranges
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/baseline/changes.test.ts && pnpm typecheck`
Expected: 7 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/baseline/changes.ts test/core/baseline/changes.test.ts
git commit -m "feat: compute changed line ranges from snapshots

Claude goes brr.. via Dash"
```

---

### Task 17: JSONL stores

**Files:**
- Create: `src/core/jsonl.ts`
- Test: `test/core/jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/jsonl.test.ts`:
```ts
import { appendFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { appendRecords, CorruptStoreError, readRecords } from "../../src/core/jsonl"
import { createProject } from "../helpers/project"

describe("jsonl", () => {
  test("a missing file reads as empty", async () => {
    const root = await createProject({})
    expect(await readRecords(path.join(root, "nope.jsonl"))).toEqual([])
  })

  test("appends create directories and preserve order", async () => {
    const file = path.join(await createProject({}), "sessions", "s1", "work.jsonl")
    await appendRecords(file, [{ t: "a" }, { t: "b" }])
    await appendRecords(file, [{ t: "c" }])
    expect(await readRecords(file)).toEqual([{ t: "a" }, { t: "b" }, { t: "c" }])
  })

  test("an unparseable final line is ignored", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendRecords(file, [{ t: "a" }])
    await appendFile(file, '{"t":"b"')
    expect(await readRecords(file)).toEqual([{ t: "a" }])
  })

  test("an unparseable line before the end is corruption", async () => {
    const file = path.join(await createProject({}), "work.jsonl")
    await appendFile(file, 'garbage\n{"t":"a"}\n')
    await expect(readRecords(file)).rejects.toBeInstanceOf(CorruptStoreError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/jsonl.test.ts`
Expected: FAIL, cannot resolve `../../src/core/jsonl`.

- [ ] **Step 3: Create `src/core/jsonl.ts`**

```ts
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "./errors"

export class CorruptStoreError extends Error {}

/** Appends records as one write; small O_APPEND writes do not interleave across processes. */
export async function appendRecords(file: string, records: readonly unknown[]): Promise<void> {
  if (records.length === 0) return
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, records.map((record) => `${JSON.stringify(record)}\n`).join(""))
}

export async function readRecords<T>(file: string): Promise<T[]> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const lines = text.split("\n")
  const records: T[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line) as T)
    } catch {
      // Only a crash mid-append can leave a partial record, and only as the last line.
      if (i === lines.length - 1) break
      throw new CorruptStoreError(`${file}: unparseable record on line ${i + 1}`)
    }
  }
  return records
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/jsonl.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/jsonl.ts test/core/jsonl.test.ts
git commit -m "feat: add append-only JSONL stores

Claude goes brr.. via Dash"
```

---

### Task 18: Git helpers

**Files:**
- Create: `src/core/baseline/git.ts`, `test/helpers/git.ts`
- Test: `test/core/baseline/git.test.ts`

- [ ] **Step 1: Create `test/helpers/git.ts`**

```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createProject } from "./project"

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args],
    { cwd },
  )
  return stdout.trim()
}

/** A git repository with `files` committed on branch main. Returns the root. */
export async function createRepo(files: Record<string, string>): Promise<string> {
  const root = await createProject(files)
  await git(root, "init", "-q", "-b", "main")
  await git(root, "add", "-A")
  await git(root, "commit", "-q", "--allow-empty", "-m", "initial")
  return root
}
```

- [ ] **Step 2: Write the failing test**

`test/core/baseline/git.test.ts`:
```ts
import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { changedFilesSince, fileAtCommit, headCommit, mergeBase } from "../../../src/core/baseline/git"
import { createRepo, git } from "../../helpers/git"
import { createProject } from "../../helpers/project"

describe("git helpers", () => {
  test("headCommit is null outside a repository", async () => {
    expect(await headCommit(await createProject({}))).toBeNull()
  })

  test("fileAtCommit returns content, or null when absent", async () => {
    const root = await createRepo({ "src/a.ts": "one\n" })
    const head = (await headCommit(root))!
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    await writeFile(path.join(root, "src/a.ts"), "two\n")
    expect(await fileAtCommit(root, head, "src/a.ts")).toBe("one\n")
    expect(await fileAtCommit(root, head, "src/missing.ts")).toBeNull()
  })

  test("mergeBase and changedFilesSince cover committed, modified and untracked files", async () => {
    const root = await createRepo({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
    const base = await headCommit(root)
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, "a.ts"), "a2\n")
    await git(root, "commit", "-q", "-am", "change a")
    await writeFile(path.join(root, "b.ts"), "b2\n")
    await writeFile(path.join(root, "new.ts"), "new\n")
    await rm(path.join(root, "c.ts"))
    expect(await mergeBase(root, "main")).toBe(base)
    expect(await changedFilesSince(root, base!)).toEqual(["a.ts", "b.ts", "new.ts"])
  })

  test("mergeBase with an unknown ref throws", async () => {
    const root = await createRepo({ "a.ts": "a\n" })
    await expect(mergeBase(root, "does-not-exist")).rejects.toThrow(/cannot find merge base with does-not-exist/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/baseline/git.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/baseline/git`.

- [ ] **Step 4: Create `src/core/baseline/git.ts`**

```ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string }

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return { ok: true, stdout }
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: string }
    if (failure.code === "ENOENT") throw new Error("git is not installed or not on PATH")
    if (typeof failure.code === "number") return { ok: false, stderr: failure.stderr ?? "" }
    throw error
  }
}

/** HEAD commit, or null outside a repository or before the first commit. */
export async function headCommit(cwd: string): Promise<string | null> {
  const result = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"])
  return result.ok ? result.stdout.trim() : null
}

/** A repo-relative file's content at a commit, or null when it does not exist there. */
export async function fileAtCommit(cwd: string, commit: string, file: string): Promise<string | null> {
  const result = await git(cwd, ["show", `${commit}:./${file}`])
  return result.ok ? result.stdout : null
}

export async function mergeBase(cwd: string, ref: string): Promise<string> {
  const result = await git(cwd, ["merge-base", "HEAD", ref])
  if (!result.ok) throw new Error(`cannot find merge base with ${ref}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** Files that exist now and differ from `commit`: committed, uncommitted and untracked. Sorted. */
export async function changedFilesSince(cwd: string, commit: string): Promise<string[]> {
  const diff = await git(cwd, ["diff", "--name-only", "--relative", "--diff-filter=d", commit])
  if (!diff.ok) throw new Error(`git diff against ${commit} failed: ${diff.stderr.trim()}`)
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"])
  if (!untracked.ok) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`)
  const files = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean)
  return [...new Set(files)].sort()
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core/baseline/git.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/baseline/git.ts test/helpers/git.ts test/core/baseline/git.test.ts
git commit -m "feat: add git helpers for baseline fallbacks

Claude goes brr.. via Dash"
```

---

### Task 19: Baseline store

**Files:**
- Create: `src/core/baseline/store.ts`
- Test: `test/core/baseline/store.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/baseline/store.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { snapshotOf } from "../../../src/core/baseline/hash"
import { appendBaseline, readBaseline, snapshotRecord, startRecord } from "../../../src/core/baseline/store"
import { createProject } from "../../helpers/project"

describe("baseline store", () => {
  test("an empty session has no start commit and no snapshots", async () => {
    const dir = await createProject({})
    expect(await readBaseline(dir)).toEqual({ started: false, startCommit: null, snapshots: new Map() })
  })

  test("round-trips snapshots and keeps the first start record and first snapshot per file", async () => {
    const dir = await createProject({})
    const first = snapshotOf("a\nb\n")
    const later = snapshotOf("changed\n")
    await appendBaseline(dir, [startRecord("abc123"), snapshotRecord("src/a.ts", first)])
    await appendBaseline(dir, [startRecord("def456"), snapshotRecord("src/a.ts", later)])
    const state = await readBaseline(dir)
    expect(state.started).toBe(true)
    expect(state.startCommit).toBe("abc123")
    const snapshot = state.snapshots.get("src/a.ts")!
    expect(snapshot.fileHash).toBe(first.fileHash)
    expect([...snapshot.lines]).toEqual([...first.lines])
  })

  test("a session started outside git records a null commit", async () => {
    const dir = await createProject({})
    await appendBaseline(dir, [startRecord(null)])
    expect(await readBaseline(dir)).toMatchObject({ started: true, startCommit: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/baseline/store.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/baseline/store`.

- [ ] **Step 3: Create `src/core/baseline/store.ts`**

```ts
import path from "node:path"

import { appendRecords, readRecords } from "../jsonl"
import type { Snapshot } from "./hash"

type BaselineRecord =
  | { t: "start"; commit: string | null }
  | { t: "snapshot"; file: string; fileHash: number; lines: string }

export interface BaselineState {
  started: boolean
  startCommit: string | null
  snapshots: Map<string, Snapshot>
}

function storeFile(sessionDir: string): string {
  return path.join(sessionDir, "baseline.jsonl")
}

function encodeLines(lines: Uint32Array): string {
  return Buffer.from(lines.buffer, lines.byteOffset, lines.byteLength).toString("base64")
}

function decodeLines(encoded: string): Uint32Array {
  const bytes = Buffer.from(encoded, "base64")
  const aligned = new Uint8Array(bytes.length)
  aligned.set(bytes)
  return new Uint32Array(aligned.buffer)
}

export function startRecord(commit: string | null): BaselineRecord {
  return { t: "start", commit }
}

export function snapshotRecord(file: string, snapshot: Snapshot): BaselineRecord {
  return { t: "snapshot", file, fileHash: snapshot.fileHash, lines: encodeLines(snapshot.lines) }
}

export async function appendBaseline(sessionDir: string, records: BaselineRecord[]): Promise<void> {
  await appendRecords(storeFile(sessionDir), records)
}

/** First start record wins; first snapshot per file wins. */
export async function readBaseline(sessionDir: string): Promise<BaselineState> {
  const state: BaselineState = { started: false, startCommit: null, snapshots: new Map() }
  for (const record of await readRecords<BaselineRecord>(storeFile(sessionDir))) {
    if (record.t === "start" && !state.started) {
      state.started = true
      state.startCommit = record.commit
    } else if (record.t === "snapshot" && !state.snapshots.has(record.file)) {
      state.snapshots.set(record.file, { fileHash: record.fileHash, lines: decodeLines(record.lines) })
    }
  }
  return state
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/baseline/store.test.ts && pnpm typecheck`
Expected: 3 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/baseline/store.ts test/core/baseline/store.test.ts
git commit -m "feat: persist baseline snapshots per session

Claude goes brr.. via Dash"
```

---

### Task 20: Change sets for files and classification

**Files:**
- Create: `src/core/baseline/baseline.ts`
- Test: `test/core/baseline/baseline.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/baseline/baseline.test.ts`:
```ts
import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { computeChanges, isNew } from "../../../src/core/baseline/baseline"
import { headCommit } from "../../../src/core/baseline/git"
import { snapshotOf } from "../../../src/core/baseline/hash"
import type { Match } from "../../../src/core/types"
import { createRepo } from "../../helpers/git"
import { createProject } from "../../helpers/project"

const at = (file: string, line: number, endLine = line): Match => ({ file, line, endLine, column: 1, text: "", captures: {} })

describe("computeChanges", () => {
  test("uses snapshots first", async () => {
    const root = await createProject({ "a.ts": "one\nTWO\nthree\n", "same.ts": "x\n" })
    const snapshots = new Map([
      ["a.ts", snapshotOf("one\ntwo\nthree\n")],
      ["same.ts", snapshotOf("x\n")],
    ])
    const changes = await computeChanges(root, ["a.ts", "same.ts"], { snapshots, fallbackCommit: null })
    expect(changes).toEqual(
      new Map([
        ["a.ts", { changedLines: [[2, 2]] }],
        ["same.ts", { changedLines: [] }],
      ]),
    )
  })

  test("falls back to the commit, and has no baseline for files absent there", async () => {
    const root = await createRepo({ "a.ts": "one\ntwo\n" })
    const commit = await headCommit(root)
    await writeFile(path.join(root, "a.ts"), "one\ntwo\nthree\n")
    await writeFile(path.join(root, "new.ts"), "fresh\n")
    const changes = await computeChanges(root, ["a.ts", "new.ts"], { snapshots: new Map(), fallbackCommit: commit })
    expect(changes).toEqual(new Map([["a.ts", { changedLines: [[3, 3]] }]]))
  })

  test("skips deleted files and has no baseline without snapshot or commit", async () => {
    const root = await createProject({ "a.ts": "x\n", "gone.ts": "y\n" })
    await rm(path.join(root, "gone.ts"))
    const changes = await computeChanges(root, ["a.ts", "gone.ts"], {
      snapshots: new Map([["gone.ts", snapshotOf("y\n")]]),
      fallbackCommit: null,
    })
    expect(changes).toEqual(new Map())
  })
})

describe("isNew", () => {
  const changes = new Map([
    ["a.ts", { changedLines: [[5, 7]] as [number, number][] }],
    ["same.ts", { changedLines: [] as [number, number][] }],
  ])

  test("a finding touching a changed line is new", () => {
    expect(isNew(at("a.ts", 6), changes)).toBe(true)
    expect(isNew(at("a.ts", 1, 5), changes)).toBe(true)
    expect(isNew(at("a.ts", 7, 9), changes)).toBe(true)
  })

  test("a finding on unchanged lines is pre-existing", () => {
    expect(isNew(at("a.ts", 4), changes)).toBe(false)
    expect(isNew(at("a.ts", 8, 9), changes)).toBe(false)
    expect(isNew(at("same.ts", 1), changes)).toBe(false)
  })

  test("a file without a baseline makes every finding new", () => {
    expect(isNew(at("other.ts", 1), changes)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/baseline/baseline.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/baseline/baseline`.

- [ ] **Step 3: Create `src/core/baseline/baseline.ts`**

```ts
import { readSourceFile } from "../detection/per-rule"
import type { ChangeSet, Match } from "../types"
import { changedLines } from "./changes"
import { fileAtCommit } from "./git"
import { snapshotOf, type Snapshot } from "./hash"

export interface BaselineSources {
  snapshots: ReadonlyMap<string, Snapshot>
  /** Session-start commit (hooks) or merge base (check --base); null for none. */
  fallbackCommit: string | null
}

/**
 * Change sets for files that exist now. A file is absent from the result when it was deleted
 * or has no baseline (no snapshot, and not present at the fallback commit).
 */
export async function computeChanges(
  root: string,
  files: readonly string[],
  sources: BaselineSources,
): Promise<Map<string, ChangeSet>> {
  const changes = new Map<string, ChangeSet>()
  for (const file of files) {
    // Without any baseline source there is nothing to compare; don't read the file.
    if (!sources.snapshots.has(file) && !sources.fallbackCommit) continue
    let before = sources.snapshots.get(file) ?? null
    if (!before && sources.fallbackCommit) {
      const text = await fileAtCommit(root, sources.fallbackCommit, file)
      before = text === null ? null : snapshotOf(text)
    }
    if (!before) continue
    const current = await readSourceFile(root, file)
    if (current === null) continue
    const after = snapshotOf(current)
    changes.set(file, {
      changedLines: after.fileHash === before.fileHash ? [] : changedLines(before.lines, after.lines),
    })
  }
  return changes
}

export function isNew(match: Match, changes: ReadonlyMap<string, ChangeSet>): boolean {
  const change = changes.get(match.file)
  if (!change) return true
  return change.changedLines.some(([start, end]) => match.line <= end && match.endLine >= start)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/baseline && pnpm typecheck`
Expected: all baseline tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/baseline/baseline.ts test/core/baseline/baseline.test.ts
git commit -m "feat: compute change sets per file and classify findings

Claude goes brr.. via Dash"
```
