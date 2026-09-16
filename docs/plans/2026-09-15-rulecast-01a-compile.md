# rulecast Plan 1a — Scaffold and Compile Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript package with rulecast's core types and a compile step that turns `.rulecast/config.yml` and rule files into ready rules plus diagnostics.

**Architecture:** Pure modules under `src/core/`: markdown anchors, reference parsing, templates, config and rule loading, and `compile()`, which validates everything against a detector registry. No module-level mutable state. Spec: `docs/specs/2026-09-15-rulecast-design.md` §3–§5.

**Tech Stack:** Node ≥ 20, TypeScript 5, pnpm, vitest, zod 3, yaml 2, picomatch 4, tinyglobby.

Part of plan 1 (see `docs/plans/2026-09-15-rulecast-00-index.md`). Continue with `2026-09-15-rulecast-01b-detection.md` afterwards.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Package scaffold |
| `src/index.ts` | Public exports |
| `src/core/types.ts` | Shared types from spec §3 |
| `src/core/errors.ts` | `isNotFound`, `errorMessage`, `formatZodError` |
| `src/core/anchors.ts` | Heading slugs, section ranges, section containment |
| `src/core/references.ts` | Parse `@path#anchor` references |
| `src/core/template.ts` | Template variable extraction and rendering |
| `src/core/compile/config.ts` | Config schema and loading |
| `src/core/compile/rules.ts` | Rule schema and rule file loading |
| `src/core/detection/registry.ts` | Detector registry |
| `src/core/compile/compile.ts` | `compile()`: ready rules + diagnostics |
| `test/helpers/project.ts` | Temporary project directories for tests |

---

### Task 1: Package scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`
- Test: `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@syv-ai/rulecast",
  "version": "0.0.0",
  "description": "Deliver project conventions to coding agents at the moment they matter.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "rulecast": "./dist/cli.js" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts src/cli.ts --format esm --dts --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
pnpm add zod@3 yaml@2 picomatch@4 tinyglobby diff@8
pnpm add -D typescript@5 vitest@3 tsup@8 @types/node@20 @types/picomatch
```
Expected: `pnpm-lock.yaml` created, no errors.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
})
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.rulecast/.state/
```

- [ ] **Step 6: Write the smoke test**

`test/smoke.test.ts`:
```ts
import { expect, test } from "vitest"

import * as rulecast from "../src/index"

test("package entry loads", () => {
  expect(rulecast).toBeTypeOf("object")
})
```

- [ ] **Step 7: Create `src/index.ts`**

```ts
export {}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 1 test passed; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore src/index.ts test/smoke.test.ts
git commit -m "chore: scaffold rulecast package

Claude goes brr.. via Dash"
```

---

### Task 2: Core types and error helpers

**Files:**
- Create: `src/core/types.ts`, `src/core/errors.ts`
- Test: `test/core/errors.test.ts`

- [ ] **Step 1: Create `src/core/types.ts`**

```ts
import type { ZodType, ZodTypeDef } from "zod"

export type EventKind = "touch" | "edit" | "verify" | "prompt" | "reset"
export type DetectorEvent = "edit" | "verify"
export type Severity = "error" | "warning"
export type Trigger = "touch" | "violation"
export type ReferenceMode = "inject" | "read"

export interface Event {
  kind: EventKind
  /** Repo-relative paths. Empty for prompt and reset. */
  files: string[]
  /** touch from a read: the whole file was read. */
  completeRead?: boolean
  /** verify from the CLI: --base. */
  baseRef?: string
  session?: { id: string; agentId?: string }
  cwd: string
}

export interface Match {
  file: string
  /** 1-based. */
  line: number
  endLine: number
  column: number
  text: string
  /** Exactly the names the detector declared for the rule. */
  captures: Record<string, string>
}

export interface ChangeSet {
  /** 1-based inclusive ranges in the current file. */
  changedLines: [start: number, end: number][]
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export interface ResolvedReference {
  /** "conventions/api-access.md#frontend-data-flow" */
  ref: string
  content: string
}

export interface DetectorRuleInput<Config> {
  id: string
  config: Config
  files: string[]
  context: ResolvedReference[]
}

export interface DetectorRun<Config> {
  event: DetectorEvent
  rules: DetectorRuleInput<Config>[]
  /** File absent = no baseline, the whole file is new. */
  changes: ReadonlyMap<string, ChangeSet>
  cache: Cache
  cwd: string
  signal: AbortSignal
}

export interface DetectorResult {
  findings: { rule: string; match: Match }[]
  /** rule null = the whole run failed. */
  errors: { rule: string | null; message: string }[]
}

export interface Detector<Config> {
  kind: string
  /** Input is unknown: schemas may apply defaults and refinements. */
  schema: ZodType<Config, ZodTypeDef, unknown>
  captures(config: Config): string[]
  events(config: Config): DetectorEvent[]
  run(input: DetectorRun<Config>): Promise<DetectorResult>
}

export interface Finding {
  rule: string
  severity: Severity
  status: "new" | "preexisting"
  file: string
  line: number
  column: number
  message: string
  count: number
}

export interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string
  reason?: "mode" | "budget" | "tooLarge"
}

export interface Delivery {
  findings: Finding[]
  preexistingSummary: { rule: string; file: string; count: number }[]
  references: DeliveredReference[]
  touches: string[]
  stop: "block" | "allow" | "capReached" | null
  warnings: string[]
}

export interface Adapter {
  name: string
  supports: EventKind[]
  maxContextChars: number | null
  parse(input: unknown): Event | null
  format(delivery: Delivery, event: Event): { stdout: string; exitCode: number }
}

export function emptyDelivery(): Delivery {
  return { findings: [], preexistingSummary: [], references: [], touches: [], stop: null, warnings: [] }
}
```

- [ ] **Step 2: Write the failing test for error helpers**

`test/core/errors.test.ts`:
```ts
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { errorMessage, formatZodError, isNotFound } from "../../src/core/errors"

describe("errors", () => {
  test("isNotFound recognises ENOENT only", () => {
    expect(isNotFound(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true)
    expect(isNotFound(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false)
    expect(isNotFound("ENOENT")).toBe(false)
  })

  test("errorMessage reads Error and non-Error values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("plain")).toBe("plain")
  })

  test("formatZodError joins paths and messages", () => {
    const result = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: "x" } })
    expect(result.success).toBe(false)
    if (!result.success) expect(formatZodError(result.error)).toBe("a.b: Expected number, received string")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/errors.test.ts`
Expected: FAIL, cannot resolve `../../src/core/errors`.

- [ ] **Step 4: Create `src/core/errors.ts`**

```ts
import type { ZodError } from "zod"

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ")
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run test/core/errors.test.ts && pnpm typecheck`
Expected: 3 tests passed; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/errors.ts test/core/errors.test.ts
git commit -m "feat: add core types and error helpers

Claude goes brr.. via Dash"
```

---

### Task 3: Markdown anchors

**Files:**
- Create: `src/core/anchors.ts`
- Test: `test/core/anchors.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/anchors.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { scanHeadings, sectionContains, sectionRange, sectionText, slugify } from "../../src/core/anchors"

const doc = [
  "# Conventions", //                 1
  "", //                              2
  "## Frontend data flow", //         3
  "Use query hooks.", //              4
  "### Errors", //                    5
  "Map errors in the hook.", //       6
  "```md", //                         7
  "## Not a heading", //              8
  "```", //                           9
  "## State", //                     10
  "Server state in queries.", //     11
  "", //                             12
  "Forms", //                        13
  "-----", //                        14
  "Use react-hook-form.", //         15
  "## State", //                     16
].join("\n")

describe("slugify", () => {
  test("follows GitHub heading slugs", () => {
    expect(slugify("Frontend data flow")).toBe("frontend-data-flow")
    expect(slugify("API: `useQuery` & errors!")).toBe("api-usequery--errors")
    expect(slugify("Æblegrød 2")).toBe("æblegrød-2")
  })
})

describe("scanHeadings", () => {
  test("finds ATX and setext headings, skips fenced code, numbers duplicates", () => {
    expect(scanHeadings(doc).map((h) => [h.level, h.slug, h.line])).toEqual([
      [1, "conventions", 1],
      [2, "frontend-data-flow", 3],
      [3, "errors", 5],
      [2, "state", 10],
      [2, "forms", 13],
      [2, "state-1", 16],
    ])
  })

  test("strips closing hashes from ATX headings", () => {
    expect(scanHeadings("## Title ##")[0]?.text).toBe("Title")
    expect(scanHeadings("## C#")[0]?.text).toBe("C#")
  })
})

describe("sectionRange", () => {
  test("runs to the next heading of the same or higher level", () => {
    expect(sectionRange(doc, "frontend-data-flow")).toEqual({ slug: "frontend-data-flow", start: 3, end: 9 })
    expect(sectionRange(doc, "errors")).toEqual({ slug: "errors", start: 5, end: 9 })
    expect(sectionRange(doc, "state")).toEqual({ slug: "state", start: 10, end: 12 })
    expect(sectionRange(doc, "conventions")).toEqual({ slug: "conventions", start: 1, end: 16 })
    expect(sectionRange(doc, "missing")).toBeNull()
  })

  test("sectionText returns the lines without trailing blank lines", () => {
    expect(sectionText(doc, sectionRange(doc, "state")!)).toBe("## State\nServer state in queries.")
  })
})

describe("sectionContains", () => {
  test("a section contains its subsections and itself, not its parent", () => {
    expect(sectionContains(doc, "frontend-data-flow", "errors")).toBe(true)
    expect(sectionContains(doc, "errors", "errors")).toBe(true)
    expect(sectionContains(doc, "errors", "frontend-data-flow")).toBe(false)
    expect(sectionContains(doc, "state", "forms")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/anchors.test.ts`
Expected: FAIL, cannot resolve `../../src/core/anchors`.

- [ ] **Step 3: Create `src/core/anchors.ts`**

```ts
export interface Heading {
  level: number
  text: string
  slug: string
  /** 1-based line of the heading text. */
  line: number
}

export interface Section {
  slug: string
  /** 1-based, inclusive. */
  start: number
  end: number
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const SETEXT_1 = /^ {0,3}=+[ \t]*$/
const SETEXT_2 = /^ {0,3}-+[ \t]*$/
const LIST_ITEM = /^ {0,3}[-*+][ \t]/

function linesOf(markdown: string): string[] {
  return markdown.split(/\r?\n/)
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
}

export function scanHeadings(markdown: string): Heading[] {
  const lines = linesOf(markdown)
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  let fence: { char: string; length: number } | null = null

  const add = (level: number, text: string, line: number) => {
    const base = slugify(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ level, text, slug: count === 0 ? base : `${base}-${count}`, line })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (fence) {
      const close = line.match(FENCE_CLOSE)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null
      continue
    }
    const open = line.match(FENCE_OPEN)
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length }
      continue
    }
    const atx = line.match(ATX)
    if (atx) {
      add(atx[1]!.length, (atx[2] ?? "").trim(), i + 1)
      continue
    }
    const next = lines[i + 1]
    if (next === undefined || line.trim() === "") continue
    if (SETEXT_1.test(next)) {
      add(1, line.trim(), i + 1)
      i++
    } else if (SETEXT_2.test(next) && !LIST_ITEM.test(line)) {
      add(2, line.trim(), i + 1)
      i++
    }
  }
  return headings
}

export function sectionRange(markdown: string, slug: string): Section | null {
  const headings = scanHeadings(markdown)
  const index = headings.findIndex((heading) => heading.slug === slug)
  if (index === -1) return null
  const heading = headings[index]!
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
  return { slug, start: heading.line, end: next ? next.line - 1 : linesOf(markdown).length }
}

export function sectionText(markdown: string, section: Section): string {
  return linesOf(markdown)
    .slice(section.start - 1, section.end)
    .join("\n")
    .trimEnd()
}

export function sectionContains(markdown: string, parentSlug: string, childSlug: string): boolean {
  const parent = sectionRange(markdown, parentSlug)
  const child = sectionRange(markdown, childSlug)
  if (!parent || !child) return false
  return child.start >= parent.start && child.end <= parent.end
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/anchors.test.ts && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/anchors.ts test/core/anchors.test.ts
git commit -m "feat: resolve markdown section anchors

Claude goes brr.. via Dash"
```

---

### Task 4: Reference parsing

**Files:**
- Create: `src/core/references.ts`
- Test: `test/core/references.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/references.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { parseReference, ReferenceSyntaxError } from "../../src/core/references"

describe("parseReference", () => {
  test("parses a whole-file string reference with the default mode", () => {
    expect(parseReference("@conventions/api.md", "inject")).toEqual({
      ref: "conventions/api.md",
      path: "conventions/api.md",
      anchor: null,
      mode: "inject",
    })
  })

  test("parses an anchor and an explicit mode", () => {
    expect(parseReference({ path: "@conventions/api.md#errors", mode: "read" }, "inject")).toEqual({
      ref: "conventions/api.md#errors",
      path: "conventions/api.md",
      anchor: "errors",
      mode: "read",
    })
  })

  test("object without mode uses the default", () => {
    expect(parseReference({ path: "@src/queries.ts" }, "read").mode).toBe("read")
  })

  test("rejects malformed references", () => {
    expect(() => parseReference("conventions/api.md", "inject")).toThrow(ReferenceSyntaxError)
    expect(() => parseReference("@", "inject")).toThrow(/has no path/)
    expect(() => parseReference("@conventions/api.md#", "inject")).toThrow(/empty anchor/)
    expect(() => parseReference("@src/queries.ts#exports", "inject")).toThrow(/only supported in .md and .mdx/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/references.test.ts`
Expected: FAIL, cannot resolve `../../src/core/references`.

- [ ] **Step 3: Create `src/core/references.ts`**

```ts
import { z } from "zod"

import type { ReferenceMode } from "./types"

export const referenceInputSchema = z.union([
  z.string(),
  z.object({ path: z.string(), mode: z.enum(["inject", "read"]).optional() }).strict(),
])

export type ReferenceInput = z.infer<typeof referenceInputSchema>

export interface ReferenceSpec {
  /** Path plus optional "#anchor", without "@". */
  ref: string
  path: string
  anchor: string | null
  mode: ReferenceMode
}

export class ReferenceSyntaxError extends Error {}

export function parseReference(input: ReferenceInput, defaultMode: ReferenceMode): ReferenceSpec {
  const raw = typeof input === "string" ? input : input.path
  const mode = typeof input === "string" ? defaultMode : (input.mode ?? defaultMode)
  if (!raw.startsWith("@")) throw new ReferenceSyntaxError(`reference "${raw}" must start with "@"`)
  const body = raw.slice(1)
  const hash = body.indexOf("#")
  const path = hash === -1 ? body : body.slice(0, hash)
  const anchor = hash === -1 ? null : body.slice(hash + 1)
  if (!path) throw new ReferenceSyntaxError(`reference "${raw}" has no path`)
  if (anchor === "") throw new ReferenceSyntaxError(`reference "${raw}" has an empty anchor`)
  if (anchor !== null && !/\.mdx?$/.test(path)) {
    throw new ReferenceSyntaxError(`anchors are only supported in .md and .mdx files: "${raw}"`)
  }
  return { ref: body, path, anchor, mode }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/references.test.ts && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/references.ts test/core/references.test.ts
git commit -m "feat: parse context references

Claude goes brr.. via Dash"
```

---

### Task 5: Templates

**Files:**
- Create: `src/core/template.ts`
- Test: `test/core/template.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/template.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { CORE_VARIABLES, renderTemplate, templateVariables, UnknownTemplateVariable } from "../../src/core/template"

describe("templates", () => {
  test("lists each variable once", () => {
    expect(templateVariables("{{file}}:{{ line }} {{NAMES}} again {{file}}")).toEqual(["file", "line", "NAMES"])
  })

  test("core variables", () => {
    expect(CORE_VARIABLES).toEqual(["file", "line", "column", "text", "rule"])
  })

  test("renders values, including empty strings", () => {
    expect(renderTemplate("{{file}}:{{line}} {{NAMES}}", { file: "a.tsx", line: "3", NAMES: "" })).toBe("a.tsx:3 ")
  })

  test("throws on a missing value", () => {
    expect(() => renderTemplate("{{reason}}", {})).toThrow(UnknownTemplateVariable)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/template.test.ts`
Expected: FAIL, cannot resolve `../../src/core/template`.

- [ ] **Step 3: Create `src/core/template.ts`**

```ts
const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export const CORE_VARIABLES = ["file", "line", "column", "text", "rule"] as const

export class UnknownTemplateVariable extends Error {
  constructor(readonly variable: string) {
    super(`template variable "${variable}" has no value`)
  }
}

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((match) => match[1]!))]
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new UnknownTemplateVariable(name)
    return value
  })
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/template.test.ts && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/template.ts test/core/template.test.ts
git commit -m "feat: render message templates

Claude goes brr.. via Dash"
```

---

### Task 6: Test project helper and config loading

**Files:**
- Create: `test/helpers/project.ts`, `src/core/compile/config.ts`
- Test: `test/core/compile/config.test.ts`

- [ ] **Step 1: Create `test/helpers/project.ts`**

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/** Writes files (repo-relative path → content) into a fresh temp directory and returns its path. */
export async function createProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rulecast-test-"))
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return root
}
```

- [ ] **Step 2: Write the failing test**

`test/core/compile/config.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { loadConfig } from "../../../src/core/compile/config"
import { createProject } from "../../helpers/project"

describe("loadConfig", () => {
  test("missing config file gives defaults", async () => {
    const root = await createProject({})
    const result = await loadConfig(root)
    expect(result).toEqual({
      ok: true,
      config: {
        rules: ".rulecast/rules/**/*.yml",
        context: { mode: "inject", maxBytes: 32768 },
        maxMatchesPerRule: 10,
        timeouts: { editDeadlineMs: 350, verifyMs: 60000 },
        stopGate: { maxBlocks: 3 },
        llm: {
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          baseUrl: null,
          apiKeyEnv: "ANTHROPIC_API_KEY",
          maxFilesPerVerify: 10,
        },
      },
    })
  })

  test("partial config merges with defaults", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context:\n  mode: read\n" })
    const result = await loadConfig(root)
    expect(result.ok && result.config.context).toEqual({ mode: "read", maxBytes: 32768 })
  })

  test("invalid config is reported, not thrown", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context:\n  mode: shout\n" })
    const result = await loadConfig(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(".rulecast/config.yml: context.mode:")
  })

  test("unparseable YAML is reported", async () => {
    const root = await createProject({ ".rulecast/config.yml": "context: [" })
    const result = await loadConfig(root)
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/compile/config.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/compile/config`.

- [ ] **Step 4: Create `src/core/compile/config.ts`**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"
import { z } from "zod"

import { errorMessage, formatZodError, isNotFound } from "../errors"

export const CONFIG_PATH = ".rulecast/config.yml"

export const configSchema = z
  .object({
    rules: z.string().default(".rulecast/rules/**/*.yml"),
    context: z
      .object({
        mode: z.enum(["inject", "read"]).default("inject"),
        maxBytes: z.number().int().positive().default(32768),
      })
      .strict()
      .default({}),
    maxMatchesPerRule: z.number().int().positive().default(10),
    timeouts: z
      .object({
        editDeadlineMs: z.number().int().positive().default(350),
        verifyMs: z.number().int().positive().default(60000),
      })
      .strict()
      .default({}),
    stopGate: z.object({ maxBlocks: z.number().int().nonnegative().default(3) }).strict().default({}),
    llm: z
      .object({
        provider: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
        model: z.string().default("claude-haiku-4-5-20251001"),
        baseUrl: z.string().nullable().default(null),
        apiKeyEnv: z.string().default("ANTHROPIC_API_KEY"),
        maxFilesPerVerify: z.number().int().positive().default(10),
      })
      .strict()
      .default({}),
  })
  .strict()

export type Config = z.infer<typeof configSchema>

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string }

export function defaultConfig(): Config {
  return configSchema.parse({})
}

export async function loadConfig(root: string): Promise<ConfigResult> {
  let text: string
  try {
    text = await readFile(path.join(root, CONFIG_PATH), "utf8")
  } catch (error) {
    if (isNotFound(error)) return { ok: true, config: defaultConfig() }
    throw error
  }
  let data: unknown
  try {
    data = parse(text) ?? {}
  } catch (error) {
    return { ok: false, message: `${CONFIG_PATH}: ${errorMessage(error)}` }
  }
  const result = configSchema.safeParse(data)
  if (!result.success) return { ok: false, message: `${CONFIG_PATH}: ${formatZodError(result.error)}` }
  return { ok: true, config: result.data }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core/compile/config.test.ts && pnpm typecheck`
Expected: 4 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/project.ts src/core/compile/config.ts test/core/compile/config.test.ts
git commit -m "feat: load project config with defaults

Claude goes brr.. via Dash"
```

---

### Task 7: Rule schema and rule file loading

**Files:**
- Create: `src/core/compile/rules.ts`
- Test: `test/core/compile/rules.test.ts`

- [ ] **Step 1: Write the failing test**

`test/core/compile/rules.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { loadRuleFiles, ruleSchema } from "../../../src/core/compile/rules"
import { createProject } from "../../helpers/project"

describe("ruleSchema", () => {
  test("applies defaults", () => {
    const rule = ruleSchema.parse({ id: "api/no-client", files: "src/**/*.tsx", detect: { path: {} }, message: "x" })
    expect(rule).toMatchObject({ severity: "error", on: ["violation"], ignore: [], context: [] })
  })

  test("rejects bad ids, several detectors and unknown keys", () => {
    expect(ruleSchema.safeParse({ id: "Api", files: "x" }).success).toBe(false)
    expect(ruleSchema.safeParse({ id: "a", files: "x", detect: { path: {}, regex: {} } }).success).toBe(false)
    expect(ruleSchema.safeParse({ id: "a", files: "x", colour: "red" }).success).toBe(false)
  })
})

describe("loadRuleFiles", () => {
  test("loads matching files in sorted order and reports YAML errors", async () => {
    const root = await createProject({
      ".rulecast/rules/b.yml": "id: b\n",
      ".rulecast/rules/nested/a.yml": "id: a\n",
      ".rulecast/rules/broken.yml": "id: [",
      ".rulecast/rules/notes.md": "not a rule",
    })
    const files = await loadRuleFiles(root, ".rulecast/rules/**/*.yml")
    expect(files.map((file) => [file.source, file.ok])).toEqual([
      [".rulecast/rules/b.yml", true],
      [".rulecast/rules/broken.yml", false],
      [".rulecast/rules/nested/a.yml", true],
    ])
    expect(files[0]).toMatchObject({ ok: true, data: { id: "b" } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core/compile/rules.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/compile/rules`.

- [ ] **Step 3: Create `src/core/compile/rules.ts`**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { glob } from "tinyglobby"
import { parse } from "yaml"
import { z } from "zod"

import { errorMessage } from "../errors"
import { referenceInputSchema } from "../references"

export const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, "must be lowercase segments separated by /"),
    files: z.union([z.string(), z.array(z.string()).nonempty()]),
    ignore: z.array(z.string()).default([]),
    severity: z.enum(["error", "warning"]).default("error"),
    on: z.array(z.enum(["touch", "violation"])).nonempty().default(["violation"]),
    detect: z
      .record(z.unknown())
      .refine((value) => Object.keys(value).length === 1, "must name exactly one detector")
      .optional(),
    events: z.array(z.enum(["edit", "verify"])).nonempty().optional(),
    message: z.string().optional(),
    context: z.array(referenceInputSchema).default([]),
  })
  .strict()

export type RuleData = z.infer<typeof ruleSchema>

export type RuleFile = { source: string; ok: true; data: unknown } | { source: string; ok: false; message: string }

export async function loadRuleFiles(root: string, pattern: string): Promise<RuleFile[]> {
  const sources = (await glob([pattern], { cwd: root, dot: true })).sort()
  return Promise.all(
    sources.map(async (source): Promise<RuleFile> => {
      const text = await readFile(path.join(root, source), "utf8")
      try {
        return { source, ok: true, data: parse(text) }
      } catch (error) {
        return { source, ok: false, message: errorMessage(error) }
      }
    }),
  )
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core/compile/rules.test.ts && pnpm typecheck`
Expected: 3 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/compile/rules.ts test/core/compile/rules.test.ts
git commit -m "feat: load and validate rule files

Claude goes brr.. via Dash"
```

---

### Task 8: Detector registry and compile

**Files:**
- Create: `src/core/detection/registry.ts`, `src/core/compile/compile.ts`
- Modify: `src/index.ts`
- Test: `test/core/compile/compile.test.ts`

- [ ] **Step 1: Create `src/core/detection/registry.ts`**

```ts
import type { Detector } from "../types"

// Detector<any>: each detector has its own config type; the registry erases it.
export type AnyDetector = Detector<any>

export interface DetectorRegistry {
  get(kind: string): AnyDetector | undefined
  kinds(): string[]
}

export function createRegistry(detectors: AnyDetector[]): DetectorRegistry {
  const byKind = new Map<string, AnyDetector>()
  for (const detector of detectors) {
    if (byKind.has(detector.kind)) throw new Error(`detector "${detector.kind}" registered twice`)
    byKind.set(detector.kind, detector)
  }
  return {
    get: (kind) => byKind.get(kind),
    kinds: () => [...byKind.keys()],
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/core/compile/compile.test.ts`:
```ts
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { compile } from "../../../src/core/compile/compile"
import { createRegistry } from "../../../src/core/detection/registry"
import type { Detector } from "../../../src/core/types"
import { createProject } from "../../helpers/project"

const fake: Detector<{ capture?: string }> = {
  kind: "fake",
  schema: z.object({ capture: z.string().optional() }).strict(),
  captures: (config) => (config.capture ? [config.capture] : []),
  events: () => ["edit", "verify"],
  run: async () => ({ findings: [], errors: [] }),
}

const registry = createRegistry([fake])

const conventions = "# API\n\n## Errors\nMap them.\n"

async function compileRules(rules: Record<string, string>, extra: Record<string, string> = {}) {
  const root = await createProject({ "conventions/api.md": conventions, ...extra, ...rules })
  return compile(root, registry)
}

describe("compile", () => {
  test("compiles a valid rule", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": [
        "id: api/a",
        "files: src/**/*.tsx",
        "ignore: ['**/*.test.tsx']",
        "detect: { fake: { capture: NAMES } }",
        "message: '{{file}}:{{line}} {{NAMES}}'",
        "context: ['@conventions/api.md#errors', { path: '@conventions/api.md', mode: read }]",
      ].join("\n"),
    })
    expect(project.diagnostics).toEqual([])
    const [rule] = project.rules
    expect(rule).toMatchObject({
      id: "api/a",
      source: ".rulecast/rules/a.yml",
      severity: "error",
      on: ["violation"],
      message: "{{file}}:{{line}} {{NAMES}}",
      detector: { kind: "fake", config: { capture: "NAMES" }, captures: ["NAMES"], events: ["edit", "verify"] },
      context: [
        { ref: "conventions/api.md#errors", path: "conventions/api.md", anchor: "errors", mode: "inject" },
        { ref: "conventions/api.md", path: "conventions/api.md", anchor: null, mode: "read" },
      ],
    })
    expect(rule!.matches("src/components/Card.tsx")).toBe(true)
    expect(rule!.matches("src/components/Card.test.tsx")).toBe(false)
    expect(rule!.matches("backend/app.py")).toBe(false)
  })

  test("a rule's events override the detector's", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": "id: a\nfiles: '**'\ndetect: { fake: {} }\nmessage: m\nevents: [verify]",
    })
    expect(project.rules[0]!.detector!.events).toEqual(["verify"])
  })

  test("touch-only rules need context but no detector", async () => {
    const project = await compileRules({
      ".rulecast/rules/ok.yml": "id: ok\nfiles: '**'\non: [touch]\ncontext: ['@conventions/api.md']",
      ".rulecast/rules/bad.yml": "id: bad\nfiles: '**'\non: [touch]",
    })
    expect(project.rules.map((rule) => rule.id)).toEqual(["ok"])
    expect(project.rules[0]!.detector).toBeNull()
    expect(project.diagnostics).toEqual([
      { source: ".rulecast/rules/bad.yml", rule: "bad", message: "rules with on: [touch] only need context" },
    ])
  })

  test("reports each problem as a diagnostic and excludes the rule", async () => {
    const project = await compileRules({
      ".rulecast/rules/1.yml": "id: no-detect\nfiles: '**'\nmessage: m",
      ".rulecast/rules/2.yml": "id: no-message\nfiles: '**'\ndetect: { fake: {} }",
      ".rulecast/rules/3.yml": "id: unknown-detector\nfiles: '**'\ndetect: { nope: {} }\nmessage: m",
      ".rulecast/rules/4.yml": "id: bad-config\nfiles: '**'\ndetect: { fake: { colour: 1 } }\nmessage: m",
      ".rulecast/rules/5.yml": "id: bad-variable\nfiles: '**'\ndetect: { fake: {} }\nmessage: '{{reason}}'",
      ".rulecast/rules/6.yml": "id: missing-file\nfiles: '**'\non: [touch]\ncontext: ['@conventions/nope.md']",
      ".rulecast/rules/7.yml": "id: missing-anchor\nfiles: '**'\non: [touch]\ncontext: ['@conventions/api.md#nope']",
      ".rulecast/rules/8.yml": "id: bad-syntax\nfiles: '**'\non: [touch]\ncontext: ['conventions/api.md']",
      ".rulecast/rules/9.yml": "id: [",
      ".rulecast/rules/10.yml": "files: '**'",
    })
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => [d.source, d.rule, d.message])).toEqual([
      [".rulecast/rules/1.yml", "no-detect", "rules with on: violation need detect and message"],
      [".rulecast/rules/10.yml", null, "id: Required"],
      [".rulecast/rules/2.yml", "no-message", "rules with on: violation need detect and message"],
      [".rulecast/rules/3.yml", "unknown-detector", 'unknown detector "nope"'],
      [".rulecast/rules/4.yml", "bad-config", "detect.fake: (root): Unrecognized key(s) in object: 'colour'"],
      [".rulecast/rules/5.yml", "bad-variable", 'unknown template variable "reason"'],
      [".rulecast/rules/6.yml", "missing-file", "referenced file not found: conventions/nope.md"],
      [".rulecast/rules/7.yml", "missing-anchor", 'anchor "#nope" not found in conventions/api.md'],
      [".rulecast/rules/8.yml", "bad-syntax", 'reference "conventions/api.md" must start with "@"'],
      [".rulecast/rules/9.yml", null, expect.stringContaining("")],
    ])
  })

  test("duplicate ids exclude every rule with that id", async () => {
    const project = await compileRules({
      ".rulecast/rules/a.yml": "id: dup\nfiles: '**'\ndetect: { fake: {} }\nmessage: m",
      ".rulecast/rules/b.yml": "id: dup\nfiles: '**'\ndetect: { fake: {} }\nmessage: m",
    })
    expect(project.rules).toEqual([])
    expect(project.diagnostics.map((d) => d.message)).toEqual([
      'duplicate rule id "dup" (also in .rulecast/rules/b.yml)',
      'duplicate rule id "dup" (also in .rulecast/rules/a.yml)',
    ])
  })

  test("an invalid config disables all rules", async () => {
    const project = await compileRules(
      { ".rulecast/rules/a.yml": "id: a\nfiles: '**'\ndetect: { fake: {} }\nmessage: m" },
      { ".rulecast/config.yml": "maxMatchesPerRule: -1" },
    )
    expect(project.rules).toEqual([])
    expect(project.diagnostics).toEqual([
      { source: ".rulecast/config.yml", rule: null, message: expect.stringContaining("maxMatchesPerRule") },
    ])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core/compile/compile.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/compile/compile`.

- [ ] **Step 4: Create `src/core/compile/compile.ts`**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import picomatch from "picomatch"

import { sectionRange } from "../anchors"
import type { DetectorRegistry } from "../detection/registry"
import { formatZodError, isNotFound } from "../errors"
import { parseReference, ReferenceSyntaxError, type ReferenceSpec } from "../references"
import { CORE_VARIABLES, templateVariables } from "../template"
import type { DetectorEvent, Severity, Trigger } from "../types"
import { CONFIG_PATH, defaultConfig, loadConfig, type Config } from "./config"
import { loadRuleFiles, ruleSchema, type RuleData } from "./rules"

export interface CompiledDetector {
  kind: string
  config: unknown
  captures: string[]
  events: DetectorEvent[]
}

export interface CompiledRule {
  id: string
  source: string
  severity: Severity
  on: Trigger[]
  matches(file: string): boolean
  detector: CompiledDetector | null
  message: string | null
  context: ReferenceSpec[]
}

export interface Diagnostic {
  source: string
  rule: string | null
  message: string
}

export interface CompiledProject {
  root: string
  config: Config
  rules: CompiledRule[]
  diagnostics: Diagnostic[]
}

/** Reads a repo-relative text file once per compile; null when missing. */
function createReader(root: string) {
  const texts = new Map<string, Promise<string | null>>()
  return (file: string) => {
    let text = texts.get(file)
    if (!text) {
      text = readFile(path.join(root, file), "utf8").catch((error: unknown) => {
        if (isNotFound(error)) return null
        throw error
      })
      texts.set(file, text)
    }
    return text
  }
}

async function compileRule(
  data: RuleData,
  source: string,
  config: Config,
  registry: DetectorRegistry,
  read: (file: string) => Promise<string | null>,
): Promise<CompiledRule | string> {
  const violation = data.on.includes("violation")
  if (violation && (!data.detect || data.message === undefined)) {
    return "rules with on: violation need detect and message"
  }
  if (!violation && (data.detect || data.message !== undefined || data.context.length === 0)) {
    return "rules with on: [touch] only need context"
  }

  let detector: CompiledDetector | null = null
  if (data.detect) {
    const [kind, rawConfig] = Object.entries(data.detect)[0]!
    const implementation = registry.get(kind)
    if (!implementation) return `unknown detector "${kind}"`
    const parsed = implementation.schema.safeParse(rawConfig ?? {})
    if (!parsed.success) return `detect.${kind}: ${formatZodError(parsed.error)}`
    detector = {
      kind,
      config: parsed.data,
      captures: implementation.captures(parsed.data),
      events: data.events ?? implementation.events(parsed.data),
    }
    const known = new Set<string>([...CORE_VARIABLES, ...detector.captures])
    const unknown = templateVariables(data.message ?? "").find((name) => !known.has(name))
    if (unknown) return `unknown template variable "${unknown}"`
  }

  const context: ReferenceSpec[] = []
  for (const input of data.context) {
    let spec: ReferenceSpec
    try {
      spec = parseReference(input, config.context.mode)
    } catch (error) {
      if (error instanceof ReferenceSyntaxError) return error.message
      throw error
    }
    const text = await read(spec.path)
    if (text === null) return `referenced file not found: ${spec.path}`
    if (spec.anchor !== null && !sectionRange(text, spec.anchor)) {
      return `anchor "#${spec.anchor}" not found in ${spec.path}`
    }
    context.push(spec)
  }

  const include = picomatch(data.files, { dot: true })
  const exclude = data.ignore.length ? picomatch(data.ignore, { dot: true }) : () => false
  return {
    id: data.id,
    source,
    severity: data.severity,
    on: data.on,
    matches: (file) => include(file) && !exclude(file),
    detector,
    message: data.message ?? null,
    context,
  }
}

export async function compile(root: string, registry: DetectorRegistry): Promise<CompiledProject> {
  const loaded = await loadConfig(root)
  if (!loaded.ok) {
    return {
      root,
      config: defaultConfig(),
      rules: [],
      diagnostics: [{ source: CONFIG_PATH, rule: null, message: loaded.message }],
    }
  }
  const config = loaded.config
  const read = createReader(root)
  const diagnostics: Diagnostic[] = []
  const compiled: CompiledRule[] = []

  for (const file of await loadRuleFiles(root, config.rules)) {
    if (!file.ok) {
      diagnostics.push({ source: file.source, rule: null, message: file.message })
      continue
    }
    const parsed = ruleSchema.safeParse(file.data)
    if (!parsed.success) {
      const id = (file.data as { id?: unknown } | null)?.id
      diagnostics.push({
        source: file.source,
        rule: typeof id === "string" ? id : null,
        message: formatZodError(parsed.error),
      })
      continue
    }
    const result = await compileRule(parsed.data, file.source, config, registry, read)
    if (typeof result === "string") {
      diagnostics.push({ source: file.source, rule: parsed.data.id, message: result })
    } else {
      compiled.push(result)
    }
  }

  const sourcesById = new Map<string, string[]>()
  for (const rule of compiled) sourcesById.set(rule.id, [...(sourcesById.get(rule.id) ?? []), rule.source])
  const rules = compiled.filter((rule) => {
    const sources = sourcesById.get(rule.id)!
    if (sources.length === 1) return true
    const others = sources.filter((source) => source !== rule.source).join(", ")
    diagnostics.push({ source: rule.source, rule: rule.id, message: `duplicate rule id "${rule.id}" (also in ${others})` })
    return false
  })

  // Code-point order, like loadRuleFiles: independent of the machine's locale.
  diagnostics.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
  return { root, config, rules, diagnostics }
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run test/core/compile/compile.test.ts`
Expected: PASS. If the `bad-config` message differs only in zod's wording, update the expected string to zod's actual message for unrecognized keys — the format `detect.fake: (root): <message>` must stay.

- [ ] **Step 6: Export compile from `src/index.ts`**

Replace `src/index.ts` with:
```ts
export type * from "./core/types"
export { emptyDelivery } from "./core/types"
export { compile, type CompiledProject, type CompiledRule, type Diagnostic } from "./core/compile/compile"
export { createRegistry, type DetectorRegistry } from "./core/detection/registry"
```

- [ ] **Step 7: Run all tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/core/detection/registry.ts src/core/compile/compile.ts src/index.ts test/core/compile/compile.test.ts
git commit -m "feat: compile config and rules into ready rules and diagnostics

Claude goes brr.. via Dash"
```
