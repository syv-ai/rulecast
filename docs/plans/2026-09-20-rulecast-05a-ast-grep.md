# rulecast Plan 5a — The `ast-grep` detector Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Structural rules. A rule says `detect: { ast-grep: { language, rule } }` and rulecast matches the file's syntax tree instead of its text, with the pattern's metavariables available as message captures.

**Architecture:** `@ast-grep/napi` is loaded through one lazy, process-wide loader (`src/detectors/ast-grep/load.ts`), because the native module and ast-grep's dynamic-language registration are process-global. Loading it is a dynamic `import()`, so a hook process that compiles no ast-grep rule never touches the native module. To make that possible, detector schemas become async: `compileRule` switches to `safeParseAsync`, and the ast-grep schema's refinement compiles the rule object against the real parser — spec §5's "each detector's `schema` carries synchronous deep checks" becomes "deep checks", with the compile-time guarantee unchanged. The detector groups its rules by language, parses each file once per language, and runs every rule of that language against the parsed tree (spec §6). A last task compiles the CLI into a standalone binary with `bun build --compile` and runs it from a directory with no `node_modules`, settling spec §16's early risk.

**Tech Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest, `@ast-grep/napi` 0.45, `@ast-grep/lang-python` 0.0.6, bun (for the binary check only).

Prerequisite: plans 1–4 are done (`docs/plans/2026-09-15-rulecast-00-index.md`). Continue with `2026-09-20-rulecast-05b-command-linter.md`, then `05c-contracts-perf.md`.

---

## Decisions this plan implements

1. **Detector schemas are validated asynchronously.** `compileRule` calls `await implementation.schema.safeParseAsync(...)`. Every existing detector schema is synchronous and unaffected; zod runs a synchronous schema under `safeParseAsync` unchanged. This is what lets the ast-grep schema compile the rule object for real without a static import of the native module. Task 1 also writes the change into spec §5.

   The alternative — a synchronous `createRequire("@ast-grep/napi")` — was measured and rejected: it works under Node but **`bun build --compile` does not bundle a `createRequire` call**, so the standalone binary fails with `Cannot find module '@ast-grep/napi'`. A dynamic `import()` with a literal specifier is bundled correctly (verified 2026-09-20).

2. **One loader, one registration call, memoised per process.** `registerDynamicLanguage` is documented as "should be called exactly once in the program", and it behaves that way: a second call is silently ignored, so a language registered second is never available (verified 2026-09-20 — registering `python` then `go` leaves `go is not supported in napi`). The loader therefore registers **every** dynamic language rulecast supports in a single call, the first time any ast-grep rule needs the parser. Python is the only one in 0.1.

   The memo in `load.ts` is a deliberate, documented exception to the plans' "no module-level mutable state in `src/`" convention: the state it holds is the native module's own process-global registration, which cannot be per-invocation. It is a cache of an idempotent load, never rule- or project-derived.

3. **Languages in 0.1:** `css`, `html`, `javascript`, `python`, `tsx`, `typescript`. Five of the six are built into `@ast-grep/napi`; `python` comes from `@ast-grep/lang-python`, whose prebuilt parser is loaded by absolute path. Both are regular `dependencies`, not optional ones, because Task 8 verifies both survive `bun build --compile`.

   **Every dynamic language is imported by a literal specifier.** `await import(someVariable)` is not statically analysable, so a bundler cannot embed the parser it points at — the same failure mode as `createRequire` in Decision 1. The language table therefore holds a thunk with the specifier written out, not a string to be resolved later.

4. **The config accepts `rule`, `constraints` and `utils`** — ast-grep's `NapiConfig` minus `transform` (which its own types call "NOT useful in JavaScript") and `language` (which rulecast supplies). `constraints` and `utils` cost three lines of schema and are what makes non-trivial rules writable; metavariable scanning walks all three the same way. Task 4 writes them into spec §6.

5. **Captures come from a string scan of the whole config, not from ast-grep.** ast-grep has no API to list a rule's metavariables, and `captures(config)` must stay synchronous (the `Detector` contract). The scan walks every string in `rule`, `constraints` and `utils` and collects `$NAME` and `$$$NAMES`. Names starting with `_` are ast-grep's non-capturing metavariables and are dropped. A name seen as `$$$NAMES` anywhere is multi-node, and its capture is its matched nodes' text joined with `", "` (spec §6), counting only named nodes so tree-sitter's separator tokens do not leak into the message.

6. **The standalone binary is verified here, not in plan 7** (the user's decision on 2026-09-20). The result is already known from a spike on 2026-09-20 and Task 8 turns it into a repeatable check:

   | Question | Answer |
   |---|---|
   | Does `bun build --compile` embed `@ast-grep/napi`'s `.node`? | Yes |
   | Does it embed `@ast-grep/lang-python`'s prebuilt parser `.so`? | Yes |
   | Does the binary match Python patterns from a directory with no `node_modules`? | Yes |
   | Cost of loading the native module | **~4 ms under Node, ~270 ms inside the bun binary** |

   So spec §16's fallback ("if it fails, the binary ships without the `ast-grep` detector") is not needed. The 270 ms figure is a **plan 7** problem — the npm/Node path is the primary distribution and stays at ~4 ms — and Task 8 records it in the spec rather than solving it.

7. **Two structural catalog rules**, both verified against the real parser on 2026-09-20, chosen because a regex handles them badly:

   | Id | Language | Rule | Severity |
   |---|---|---|---|
   | `react/no-inline-style` | `tsx` | contextual pattern `<div style={{ $$$PROPS }}/>` selecting `jsx_attribute` | warning |
   | `python/no-silent-except` | `python` | `kind: except_clause` whose block `has` a `pass_statement` | error |

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/detectors/regex.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`, and a spawned CLI must get it in the child's env.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause. Biome runs with `--error-on-warnings`, so a warning fails the commit.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit after every task. Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths under `src/`, `test/` and `scripts/` are in `packages/rulecast/`. The others are relative to the repository root.

| File | Responsibility |
|---|---|
| `src/core/compile/rule.ts` | `safeParse` → `await safeParseAsync` (Task 1) |
| `src/detectors/ast-grep/languages.ts` | The language table: rulecast name → built-in `Lang` or dynamic package |
| `src/detectors/ast-grep/load.ts` | Lazy, memoised native-module load and the single `registerDynamicLanguage` call |
| `src/detectors/ast-grep/metavars.ts` | `metavariables(config)`: the `$NAME` / `$$$NAMES` scan |
| `src/detectors/ast-grep/schema.ts` | The zod schema, including the async rule-compiles-for-real refinement |
| `src/detectors/ast-grep/detector.ts` | The `Detector`: group by language, parse once per file, match every rule |
| `src/detectors/index.ts` | Registers `astGrepDetector` |
| `test/core/compile/project.test.ts` | An async detector schema is awaited during compile (Task 1) |
| `test/detectors/ast-grep/metavars.test.ts` | Metavariable scan |
| `test/detectors/ast-grep/schema.test.ts` | Languages, rule compilation diagnostics, captures, events |
| `test/detectors/ast-grep/detector.test.ts` | Matching, positions, captures, batching per language, errors, abort |
| `test/build.test.ts` | `dist/cli.js` never *statically* imports `@ast-grep/napi` (Task 6) |
| `test/binary.test.ts` | `bun build --compile` embeds the native modules (Task 8) |
| `packages/rules-react/rules.yaml`, `packages/rules-react/styling.md` | `react/no-inline-style` |
| `packages/rules-python/rules.yaml`, `packages/rules-python/errors.md` | `python/no-silent-except` |
| `.rulecast-rules.yaml` | Regenerated by `pnpm manifest` |
| `test/catalog.test.ts` | The two new catalog rules fire and stay quiet |
| `packages/rulecast/package.json` | `@ast-grep/napi`, `@ast-grep/lang-python` |
| `docs/specs/2026-09-15-rulecast-design.md` | §3 and §6 (the native-module exception), §5 (async schemas), §6 (`ast-grep` languages and keys), §13 and §16 (binary findings) |
| `docs/plans/2026-09-15-rulecast-00-index.md` | The no-module-level-state convention names its one exception |

## Not in this plan

- **`command` and `linter`**: `2026-09-20-rulecast-05b-command-linter.md`.
- **The exported contract suites, the perf fixture and `agents/reference/detectors.md`**: `2026-09-20-rulecast-05c-contracts-perf.md`. This plan leaves `detectors.md` listing `ast-grep` under "Coming later"; 5c rewrites that section once all three detectors exist, so the doc is never half-true for more than one plan.
- **`rulecast doctor`** (spec §5), which is where "ast-grep unavailable" becomes a user-facing report: plan 7.
- **Making the bun binary's 270 ms native-module load cheaper**: plan 7.
- **Languages beyond the six in Decision 3.** Adding one is a row in `languages.ts` plus a dependency.

---

### Task 1: Detector schemas are validated asynchronously

**Files:**
- Modify: `src/core/compile/rule.ts:70`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §5
- Test: `test/core/compile/project.test.ts`

**Behaviour:** A detector whose zod schema has an async refinement compiles without throwing, and its refinement's diagnostic reaches the rule the same way a synchronous one does.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/core/compile/project.test.ts` already has, at module scope: a `fake` detector, `const registry = createRegistry([fake])`, `const local = (...rules: unknown[]) => ({ repos: [{ repo: "local", rules }] })`, and `compileConfig(config, files?, fetch?)` which compiles against that one `registry`. This test needs a registry of its own, so it calls `compile` directly the way `compileConfig` does.

Append inside the existing top-level `describe("compile")`:

```ts
  test("awaits a detector schema with an async refinement", async () => {
    const asyncProbe: Detector<{ value: string }> = {
      kind: "async-probe",
      schema: z
        .object({ value: z.string() })
        .strict()
        .superRefine(async (config, ctx) => {
          await Promise.resolve()
          if (config.value === "bad") ctx.addIssue({ code: "custom", path: ["value"], message: "value is bad" })
        }),
      captures: () => [],
      events: () => ["edit", "verify"],
      run: async () => ({ findings: [], errors: [] }),
    }
    const root = await createProject({
      ".rulecast-config.yaml": stringify(
        local(
          { id: "ok", name: "Ok", detect: { "async-probe": { value: "fine" } }, message: "{{file}}" },
          { id: "nope", name: "Nope", detect: { "async-probe": { value: "bad" } }, message: "{{file}}" },
        ),
      ),
    })
    const project = await compile({
      root,
      registry: createRegistry([asyncProbe]),
      repos: cachedRepos(TEST_HOME),
    })
    expect(project.rules.map((rule) => rule.id)).toEqual(["ok"])
    expect(project.diagnostics.map((d) => d.message)).toEqual(["detect.async-probe: value: value is bad"])
  })
```

Every identifier it uses — `Detector`, `z`, `stringify`, `local`, `createProject`, `compile`, `createRegistry`, `cachedRepos`, `TEST_HOME` — is already imported by that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/core/compile/project.test.ts`
Expected: FAIL. zod throws `Async refinement encountered during synchronous parse operation. Use .parseAsync`, so the rule is not skipped with a diagnostic — the whole compile rejects.

- [ ] **Step 3: Await the schema**

In `packages/rulecast/src/core/compile/rule.ts:70`, replace:
```ts
    const parsed = implementation.schema.safeParse(rawConfig ?? {})
```
with:
```ts
    // Detector schemas may refine asynchronously: ast-grep compiles the rule object against the
    // real parser, which it loads on demand (plan 5a). A synchronous schema is unaffected.
    const parsed = await implementation.schema.safeParseAsync(rawConfig ?? {})
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/core/compile/project.test.ts` → passes.
Run: `pnpm test` → the whole suite still passes. Every existing detector schema is synchronous, so none of them changes behaviour.

- [ ] **Step 5: Update the spec**

In `docs/specs/2026-09-15-rulecast-design.md` §5, replace:
```
- the config and every manifest parse and match their zod schemas, including each detector's `schema` (which carries synchronous deep checks, e.g. that an ast-grep rule object compiles);
```
with:
```
- the config and every manifest parse and match their zod schemas, including each detector's `schema`, which carries deep checks — e.g. that an ast-grep rule object compiles. Schemas are parsed asynchronously, so a detector may load what it needs to check a config (ast-grep loads its parser) instead of importing it in every process.
```

- [ ] **Step 6: Commit**

`git add packages/rulecast/src/core/compile/rule.ts packages/rulecast/test/core/compile/project.test.ts docs/specs/2026-09-15-rulecast-design.md` then commit: `feat: validate detector schemas asynchronously`.

---

### Task 2: The metavariable scan

**Files:**
- Create: `src/detectors/ast-grep/metavars.ts`
- Test: `test/detectors/ast-grep/metavars.test.ts`

**Behaviour:** Given an ast-grep config, list the capture names in first-seen order, each marked single or multi-node, skipping ast-grep's non-capturing `$_`-prefixed metavariables.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/ast-grep/metavars.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { metavariables } from "../../../src/detectors/ast-grep/metavars"

describe("metavariables", () => {
  test("finds single and multi metavariables anywhere in the config, in first-seen order", () => {
    expect(
      metavariables({
        rule: { pattern: "raise HTTPException($$$ARGS)", inside: { kind: "function_definition" } },
        constraints: { ARGS: { regex: "$CODE" } },
      }),
    ).toEqual([
      { name: "ARGS", multi: true },
      { name: "CODE", multi: false },
    ])
  })

  test("a name seen once as $$$NAME is multi everywhere", () => {
    expect(metavariables({ rule: { any: [{ pattern: "f($A)" }, { pattern: "g($$$A)" }] } })).toEqual([
      { name: "A", multi: true },
    ])
  })

  test("skips non-capturing metavariables and anonymous $$$", () => {
    expect(metavariables({ rule: { pattern: "f($_IGNORED, $$$, $KEPT)" } })).toEqual([{ name: "KEPT", multi: false }])
  })

  test("ignores non-string values and a $ that starts no name", () => {
    expect(metavariables({ rule: { pattern: "cost($ + 1)", stopBy: "end", limit: 3, ok: true } })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/ast-grep/metavars.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the scan**

`packages/rulecast/src/detectors/ast-grep/metavars.ts`:
```ts
/**
 * ast-grep metavariables: `$NAME` matches one node, `$$$NAMES` matches several. The `$$$` branch
 * comes first so `$$$ARGS` is never read as the `$ARGS` inside it. Names starting with `_` are
 * ast-grep's non-capturing form.
 */
const METAVARIABLE = /\$\$\$([A-Z_][A-Z0-9_]*)|\$([A-Z_][A-Z0-9_]*)/g

export interface Metavariable {
  name: string
  /** Matched several nodes: the capture is their text joined with ", ". */
  multi: boolean
}

function scan(value: unknown, into: Map<string, boolean>): void {
  if (typeof value === "string") {
    for (const found of value.matchAll(METAVARIABLE)) {
      const multi = found[1] !== undefined
      const name = found[1] ?? found[2]!
      if (name.startsWith("_")) continue
      into.set(name, (into.get(name) ?? false) || multi)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) scan(item, into)
    return
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) scan(item, into)
  }
}

/** Every capture name in a rule, constraints and utils, in the order they first appear. */
export function metavariables(config: unknown): Metavariable[] {
  const found = new Map<string, boolean>()
  scan(config, found)
  return [...found].map(([name, multi]) => ({ name, multi }))
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/detectors/ast-grep/metavars.test.ts` → passes.

- [ ] **Step 5: Commit**

`feat: scan ast-grep rule objects for metavariables`

---

### Task 3: The language table and the lazy loader

**Files:**
- Create: `src/detectors/ast-grep/languages.ts`, `src/detectors/ast-grep/load.ts`
- Modify: `packages/rulecast/package.json` (dependencies)
- Test: covered by Tasks 4 and 5; no test file of its own (the loader has one branch that only fires when the native module is missing, which Task 8's binary check exercises end to end)

**Behaviour:** `parserFor("python")` returns something that parses Python source, loading `@ast-grep/napi` and registering every dynamic language on first use and never again. `parserFor("ruby")` is a type error, not a runtime one — the schema's enum is the gate.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @syv-ai/rulecast add @ast-grep/napi@^0.45.3 @ast-grep/lang-python@^0.0.6`

Check afterwards that they landed in `dependencies`, not `devDependencies`, in `packages/rulecast/package.json`.

- [ ] **Step 2: Write the language table**

`packages/rulecast/src/detectors/ast-grep/languages.ts`:
```ts
/**
 * The languages a rule may name. `@ast-grep/napi` builds in five; Python comes from a separate
 * package whose prebuilt parser is registered at runtime (see load.ts). `tsx` also handles `.jsx`.
 *
 * A dynamic language's specifier is written out inside a thunk, never resolved from a variable:
 * a bundler has to see the literal to embed the prebuilt parser in a standalone binary.
 */
export const LANGUAGES = {
  css: { builtin: "Css" },
  html: { builtin: "Html" },
  javascript: { builtin: "JavaScript" },
  python: { load: () => import("@ast-grep/lang-python") },
  tsx: { builtin: "Tsx" },
  typescript: { builtin: "TypeScript" },
} as const satisfies Record<string, { builtin: string } | { load: () => Promise<unknown> }>

export type Language = keyof typeof LANGUAGES

export const LANGUAGE_NAMES = Object.keys(LANGUAGES) as [Language, ...Language[]]

/** The name to hand `parse`: the built-in enum member, or the key the dynamic language registered under. */
export function napiLanguage(language: Language): string {
  const entry: { builtin: string } | { load: () => Promise<unknown> } = LANGUAGES[language]
  return "builtin" in entry ? entry.builtin : language
}
```

`@ast-grep/lang-python` has no type declarations of its own, so `pnpm typecheck` may want a one-line `declare module "@ast-grep/lang-python"` in a `src/types/` ambient file. Add it only if the compiler asks.

- [ ] **Step 3: Write the loader**

`packages/rulecast/src/detectors/ast-grep/load.ts`:
```ts
import type { SgRoot } from "@ast-grep/napi"

import { errorMessage } from "../../core/errors"
import { type Language, LANGUAGES, napiLanguage } from "./languages"

export interface Parser {
  parse(source: string): SgRoot
}

/**
 * The native module and ast-grep's dynamic-language registration are process-global: the napi
 * docs say registerDynamicLanguage "should be called exactly once in the program", and a second
 * call is ignored, so every dynamic language has to go in one call. This memo is therefore the one
 * place in src/ that keeps module-level state. It caches an idempotent load and holds nothing
 * derived from a rule, a project or an event.
 */
let loading: Promise<typeof import("@ast-grep/napi")> | null = null

async function load(): Promise<typeof import("@ast-grep/napi")> {
  loading ??= (async () => {
    const napi = await import("@ast-grep/napi")
    const dynamic: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(LANGUAGES)) {
      if (!("load" in entry)) continue
      const module = (await entry.load()) as { default?: unknown }
      dynamic[name] = module.default ?? module
    }
    // One call with every dynamic language: a second call is ignored, so a language registered
    // later would never be available (Decision 2).
    if (Object.keys(dynamic).length > 0) napi.registerDynamicLanguage(dynamic as never)
    return napi
  })()
  return loading
}

export class AstGrepUnavailable extends Error {
  constructor(cause: unknown) {
    super(`ast-grep is unavailable: ${errorMessage(cause)}`)
  }
}

/** A parser for one language. Throws AstGrepUnavailable when the native module cannot be loaded. */
export async function parserFor(language: Language): Promise<Parser> {
  let napi: typeof import("@ast-grep/napi")
  try {
    napi = await load()
  } catch (error) {
    loading = null
    throw new AstGrepUnavailable(error)
  }
  const name = napiLanguage(language)
  return { parse: (source) => napi.parse(name, source) }
}
```

`loading = null` on failure so a later call retries rather than replaying a rejected promise.

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm typecheck` → clean. (There is no behaviour to test yet; Task 4 is the first caller.)

Two things this step is really checking, because both are external and unverified by any test until Task 4: that `@ast-grep/lang-python` resolves without type declarations, and that `napi.parse` accepts a plain `string` language name — its published signature is `parse(lang: NapiLang, src: string)` where `NapiLang = Lang | (string & {})`, so a string should be fine. If either complains, fix it here rather than carrying it into Task 4.

- [ ] **Step 5: Record the exception to "no module-level state"**

Three documents state the rule this loader breaks. Each gets the exception named, so the next reader does not "fix" it:

In `docs/specs/2026-09-15-rulecast-design.md` §3, append to the sentence at line 59 (`… everything a module needs is passed in, and everything that must outlive the process is on disk in the user cache (§12, Cache and state).`):
```
The one exception is loading a native module: `@ast-grep/napi` and its dynamic languages register themselves process-globally, so the detector memoises that load (§6).
```

In §6's contract, replace:
```
- **Cache.** Detectors that persist work use `cache`, keyed by content hashes. No module-level state.
```
with:
```
- **Cache.** Detectors that persist work use `cache`, keyed by content hashes. No module-level state, except memoising a native module whose own registration is process-global — `ast-grep` does this and nothing derived from a rule, project or event may live there.
```

In `docs/plans/2026-09-15-rulecast-00-index.md`, replace the convention bullet:
```
- No module-level mutable state anywhere in `src/`. Anything a module needs is passed in.
```
with:
```
- No module-level mutable state anywhere in `src/`. Anything a module needs is passed in. The single exception is `src/detectors/ast-grep/load.ts`, which memoises a process-global native-module registration (plan 5a, Decision 2).
```

- [ ] **Step 6: Commit**

`git add` the two new `src/detectors/ast-grep/` files, `packages/rulecast/package.json`, `pnpm-lock.yaml`, `docs/specs/2026-09-15-rulecast-design.md` and `docs/plans/2026-09-15-rulecast-00-index.md`, then commit: `feat: load @ast-grep/napi lazily, with python registered once`

---

### Task 4: The schema, captures and events

**Files:**
- Create: `src/detectors/ast-grep/schema.ts`
- Test: `test/detectors/ast-grep/schema.test.ts`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §6

**Behaviour:** `detect: { ast-grep: … }` accepts a known `language` and a non-empty `rule`, plus optional `constraints` and `utils`; a rule object ast-grep rejects is a diagnostic naming what is wrong; captures are the config's metavariables; events are `edit` and `verify`.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/ast-grep/schema.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { astGrepSchema, captureNames } from "../../../src/detectors/ast-grep/schema"

const parse = (config: unknown) => astGrepSchema.safeParseAsync(config)

describe("ast-grep schema", () => {
  test("accepts every supported language", async () => {
    for (const language of ["css", "html", "javascript", "python", "tsx", "typescript"]) {
      const result = await parse({ language, rule: { pattern: "f($A)" } })
      expect(result.success, language).toBe(true)
    }
  })

  test("rejects an unknown language, a missing or empty rule, and unknown keys", async () => {
    expect((await parse({ language: "ruby", rule: { pattern: "f" } })).success).toBe(false)
    expect((await parse({ language: "python" })).success).toBe(false)
    expect((await parse({ language: "python", rule: {} })).success).toBe(false)
    expect((await parse({ language: "python", rule: { pattern: "f" }, oops: 1 })).success).toBe(false)
  })

  test("a rule object ast-grep cannot compile is a diagnostic naming the problem", async () => {
    const result = await parse({ language: "python", rule: { kind: "not_a_real_kind" } })
    expect(result.success).toBe(false)
    const issue = result.error!.issues[0]!
    expect(issue.path).toEqual(["rule"])
    expect(issue.message).toContain("rule` is not configured correctly")
    // Collapsed onto one line so compile diagnostics stay one line each.
    expect(issue.message).not.toContain("\n")
  })

  test("keeps constraints and utils", async () => {
    const result = await parse({
      language: "python",
      rule: { pattern: "f($A)" },
      constraints: { A: { regex: "^x" } },
      utils: { "is-call": { kind: "call" } },
    })
    expect(result.success).toBe(true)
  })

  test("captures are the config's metavariables", () => {
    expect(
      captureNames({
        language: "python",
        rule: { pattern: "raise HTTPException($$$ARGS)" },
        constraints: { ARGS: { regex: "$CODE" } },
      }),
    ).toEqual(["ARGS", "CODE"])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/ast-grep/schema.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the schema**

`packages/rulecast/src/detectors/ast-grep/schema.ts`:
```ts
import { z } from "zod"

import { errorMessage } from "../../core/errors"
import { LANGUAGE_NAMES } from "./languages"
import { parserFor } from "./load"
import { metavariables } from "./metavars"

const ruleObject = z
  .record(z.unknown())
  .refine((rule) => Object.keys(rule).length > 0, "rule must not be empty")

export const astGrepSchema = z
  .object({
    language: z.enum(LANGUAGE_NAMES),
    rule: ruleObject,
    constraints: z.record(ruleObject).optional(),
    utils: z.record(ruleObject).optional(),
  })
  .strict()
  .superRefine(async (config, ctx) => {
    try {
      // Compiling the matcher is the only way to find out whether ast-grep accepts the rule.
      // An empty source parses in microseconds and makes findAll do the compiling.
      const parser = await parserFor(config.language)
      parser.parse("").root().findAll(matcher(config))
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["rule"], message: oneLine(errorMessage(error)) })
    }
  })

export type AstGrepConfig = z.infer<typeof astGrepSchema>

/** ast-grep spreads its complaints over several lines; compile diagnostics are one line each. */
function oneLine(message: string): string {
  return message
    .split("\n")
    .map((line) => line.replace(/^\s*\|->\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
}

/** The NapiConfig handed to findAll. */
export function matcher(config: AstGrepConfig): Record<string, unknown> {
  const value: Record<string, unknown> = { rule: config.rule }
  if (config.constraints) value.constraints = config.constraints
  if (config.utils) value.utils = config.utils
  return value
}

export function captureNames(config: AstGrepConfig): string[] {
  return metavariables(matcher(config)).map((variable) => variable.name)
}
```

`z.enum` needs a non-empty tuple, which is why `LANGUAGE_NAMES` is typed `[Language, ...Language[]]`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/detectors/ast-grep/schema.test.ts` → passes.

If the "not configured correctly" assertion fails, read the message ast-grep actually produced and fix the **assertion** to the real text — but only after checking that the rule really is invalid. Do not weaken it to `.toBeDefined()`.

- [ ] **Step 5: Update the spec**

In `docs/specs/2026-09-15-rulecast-design.md` §6, replace the `ast-grep` paragraph (the prose after the YAML example) with:

```
Uses `@ast-grep/napi`. Parses each file once per language and runs every rule for that language against the parsed tree. Languages: `css`, `html`, `javascript`, `python`, `tsx`, `typescript` — `python` through `@ast-grep/lang-python`, registered at load. Keys: `language` and `rule`, plus optional `constraints` and `utils` (ast-grep's own). Captures: metavariable names found anywhere in the config (`$NAME` → `NAME`, `$$$NAMES` → `NAMES`, multi-node captures comma-joined, `$_NAME` non-capturing). Events: `edit`, `verify`.
```

- [ ] **Step 6: Commit**

`feat: ast-grep detector schema, captures and events`

---

### Task 5: The detector

**Files:**
- Create: `src/detectors/ast-grep/detector.ts`
- Test: `test/detectors/ast-grep/detector.test.ts`

**Behaviour:** For each language in the run, each selected file is read and parsed once and every rule of that language runs against that tree. Matches carry 1-based positions, the matched text and the declared captures. A rule whose matcher throws fails alone; a language whose parser cannot be loaded fails every rule that uses it; an aborted run throws.

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/detectors/ast-grep/detector.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import type { DetectorRuleInput } from "../../../src/core/types"
import { astGrepDetector } from "../../../src/detectors/ast-grep/detector"
import type { AstGrepConfig } from "../../../src/detectors/ast-grep/schema"
import { createProject } from "../../helpers/project"

async function ruleFor(id: string, config: unknown, files: string[]): Promise<DetectorRuleInput<AstGrepConfig>> {
  const parsed = await astGrepDetector.schema.parseAsync(config)
  return { id, config: parsed, files, context: [] }
}

const run = async (cwd: string, rules: DetectorRuleInput<AstGrepConfig>[], signal = new AbortController().signal) =>
  astGrepDetector.run({ event: "edit", rules, changes: new Map(), cache: memoryCache(), cwd, signal })

const PY = "def get(id):\n    if not id:\n        raise HTTPException(404, detail='missing')\n    raise HTTPException(403)\n"
const TSX = 'const a = <div style={{ padding: 8, color: "r" }} id="x"/>\n'

describe("ast-grep detector", () => {
  test("declares events and captures", async () => {
    const config = await astGrepDetector.schema.parseAsync({
      language: "python",
      rule: { pattern: "raise HTTPException($$$ARGS)" },
    })
    expect(astGrepDetector.kind).toBe("ast-grep")
    expect(astGrepDetector.events(config)).toEqual(["edit", "verify"])
    expect(astGrepDetector.captures(config)).toEqual(["ARGS"])
  })

  test("reports every match with 1-based positions and multi-node captures joined", async () => {
    const cwd = await createProject({ "app/services/users.py": PY })
    const result = await run(cwd, [
      await ruleFor("no-httpexception", { language: "python", rule: { pattern: "raise HTTPException($$$ARGS)" } }, [
        "app/services/users.py",
        "app/services/gone.py",
      ]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 3,
          endLine: 3,
          column: 9,
          text: "raise HTTPException(404, detail='missing')",
          captures: { ARGS: "404, detail='missing'" },
        },
      },
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 4,
          endLine: 4,
          column: 5,
          text: "raise HTTPException(403)",
          captures: { ARGS: "403" },
        },
      },
    ])
  })

  test("a single metavariable captures one node; an unmatched one is empty", async () => {
    const cwd = await createProject({ "a.py": "f(1)\ng()\n" })
    const result = await run(cwd, [
      await ruleFor("one", { language: "python", rule: { any: [{ pattern: "f($A)" }, { pattern: "g()" }] } }, ["a.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => finding.match.captures)).toEqual([{ A: "1" }, { A: "" }])
  })

  test("runs every rule of a language against one parse, and keeps languages apart", async () => {
    const cwd = await createProject({ "a.py": PY, "b.tsx": TSX })
    const result = await run(cwd, [
      await ruleFor("py-raise", { language: "python", rule: { pattern: "raise HTTPException($$$ARGS)" } }, ["a.py"]),
      await ruleFor("py-if", { language: "python", rule: { kind: "if_statement" } }, ["a.py"]),
      await ruleFor(
        "tsx-style",
        {
          language: "tsx",
          rule: { pattern: { context: "<div style={{ $$$PROPS }}/>", selector: "jsx_attribute" } },
        },
        ["b.tsx"],
      ),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.filter((finding) => finding.rule === "py-raise")).toHaveLength(2)
    expect(result.findings.filter((finding) => finding.rule === "py-if")).toHaveLength(1)
    const style = result.findings.find((finding) => finding.rule === "tsx-style")!
    expect(style.match.text).toBe('style={{ padding: 8, color: "r" }}')
    expect(style.match.captures).toEqual({ PROPS: 'padding: 8, color: "r"' })
  })

  test("a file that no longer exists is skipped, not an error", async () => {
    const cwd = await createProject({ "a.py": "x = 1\n" })
    const result = await run(cwd, [await ruleFor("r", { language: "python", rule: { kind: "module" } }, ["gone.py"])])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("an unparseable file still parses: tree-sitter recovers, so it reports what it can", async () => {
    const cwd = await createProject({ "a.py": "def (:\n    raise HTTPException(1)\n" })
    const result = await run(cwd, [
      await ruleFor("r", { language: "python", rule: { pattern: "raise HTTPException($$$A)" } }, ["a.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
  })

  test("no rules is an empty result and never loads the parser", async () => {
    const cwd = await createProject({})
    expect(await run(cwd, [])).toEqual({ findings: [], errors: [] })
  })

  test("an aborted run throws so the core can mark it timed out", async () => {
    const cwd = await createProject({ "a.py": PY })
    const controller = new AbortController()
    controller.abort()
    await expect(
      run(cwd, [await ruleFor("r", { language: "python", rule: { kind: "module" } }, ["a.py"])], controller.signal),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/detectors/ast-grep/detector.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the detector**

`packages/rulecast/src/detectors/ast-grep/detector.ts`:
```ts
import { readSourceFile } from "../../core/detection/per-rule"
import { errorMessage } from "../../core/errors"
import type { Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import type { Language } from "./languages"
import { parserFor } from "./load"
import { type Metavariable, metavariables } from "./metavars"
import { type AstGrepConfig, astGrepSchema, captureNames, matcher } from "./schema"

// A node of the parsed tree. Typed structurally so the module never imports @ast-grep/napi
// for a value: the entry bundle must reach the native module only through load.ts's import().
interface Node {
  text(): string
  isNamed(): boolean
  range(): { start: { line: number; column: number }; end: { line: number; column: number } }
  getMatch(name: string): Node | null
  getMultipleMatches(name: string): Node[]
  findAll(matcher: unknown): Node[]
}

function capturesOf(node: Node, variables: Metavariable[]): Record<string, string> {
  const captures: Record<string, string> = {}
  for (const variable of variables) {
    captures[variable.name] = variable.multi
      ? node
          .getMultipleMatches(variable.name)
          // tree-sitter hands back the separators between the matched nodes too.
          .filter((match) => match.isNamed())
          .map((match) => match.text())
          .join(", ")
      : (node.getMatch(variable.name)?.text() ?? "")
  }
  return captures
}

function matchOf(file: string, node: Node, variables: Metavariable[]): Match {
  const range = node.range()
  return {
    file,
    line: range.start.line + 1,
    endLine: range.end.line + 1,
    column: range.start.column + 1,
    text: node.text(),
    captures: capturesOf(node, variables),
  }
}

export const astGrepDetector: Detector<AstGrepConfig> = {
  kind: "ast-grep",
  schema: astGrepSchema,
  captures: captureNames,
  events: () => ["edit", "verify"],
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    const byLanguage = new Map<Language, DetectorRuleInput<AstGrepConfig>[]>()
    for (const rule of input.rules) {
      byLanguage.set(rule.config.language, [...(byLanguage.get(rule.config.language) ?? []), rule])
    }

    await Promise.all(
      [...byLanguage].map(async ([language, rules]) => {
        let parser: Awaited<ReturnType<typeof parserFor>>
        try {
          parser = await parserFor(language)
        } catch (error) {
          // The language is unusable, so every rule that names it is: one error each, never a
          // whole-run error, which would also disable the rules of the other languages.
          for (const rule of rules) result.errors.push({ rule: rule.id, message: errorMessage(error) })
          return
        }
        // Scanned once per rule, not once per matched node: the perf fixture has eight of these.
        const variables = new Map(rules.map((rule) => [rule.id, metavariables(matcher(rule.config))]))
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        for (const file of files) {
          input.signal.throwIfAborted()
          const source = await readSourceFile(input.cwd, file)
          if (source === null) continue
          const root = parser.parse(source).root() as unknown as Node
          for (const rule of rules) {
            if (!rule.files.includes(file)) continue
            try {
              for (const node of root.findAll(matcher(rule.config))) {
                result.findings.push({ rule: rule.id, match: matchOf(file, node, variables.get(rule.id)!) })
              }
            } catch (error) {
              if (input.signal.aborted) throw error
              if (!result.errors.some((existing) => existing.rule === rule.id)) {
                result.errors.push({ rule: rule.id, message: errorMessage(error) })
              }
            }
          }
        }
      }),
    )
    return result
  },
}
```

Findings come out grouped by language and then by file; the test above asserts per-rule subsets rather than a total order, except in the single-rule cases where the order is the file's.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/detectors/ast-grep/detector.test.ts` → passes.
Run: `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

`feat: ast-grep detector, one parse per file per language`

---

### Task 6: Register the detector and keep it out of the entry bundle

**Files:**
- Modify: `src/detectors/index.ts`
- Test: `test/build.test.ts`

**Behaviour:** `detect: { ast-grep: … }` compiles and runs through the real pipeline, and `dist/cli.js` reaches `@ast-grep/napi` only through a dynamic `import()`, so a hook in a project with no ast-grep rules never loads the native module.

- [ ] **Step 1: Write the failing tests**

In `packages/rulecast/src/detectors/index.ts` nothing has changed yet. Add to `packages/rulecast/test/build.test.ts`:

```ts
test("built CLI reaches @ast-grep/napi only through a dynamic import", () => {
  const source = readFileSync(cli, "utf8")
  // A static import would load the native module in every hook process, including the many
  // projects with no ast-grep rule. load.ts's import() is the only way in.
  expect(source).not.toMatch(/from\s*"@ast-grep\/napi"/)
  expect(source).toContain('import("@ast-grep/napi")')
})

test("built CLI runs an ast-grep rule", async () => {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig([
      {
        id: "no-silent-except",
        name: "No silent except",
        files: "\\.py$",
        detect: {
          "ast-grep": {
            language: "python",
            rule: { kind: "except_clause", has: { kind: "block", has: { kind: "pass_statement" } } },
          },
        },
        message: "{{file}}:{{line}} swallows an exception.",
      },
    ]),
    "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
  })
  const failure = await exec("node", [cli, "run", "--all-files", "--format", "agent"], { cwd: root, env }).catch(
    (error) => error,
  )
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("app/a.py:4 swallows an exception.")
}, 30_000)
```

`localConfig` is already imported by other tests in the repository (`test/helpers/config.ts`); add the import to `test/build.test.ts` if it is not there.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run test/build.test.ts`
Expected: FAIL — `dist/cli.js` contains neither form of the specifier, and `run` reports `unknown detector "ast-grep"`.

- [ ] **Step 3: Register the detector**

`packages/rulecast/src/detectors/index.ts`:
```ts
import type { AnyDetector } from "../core/detection/registry"
import { astGrepDetector } from "./ast-grep/detector"
import { pathDetector } from "./path"
import { regexDetector } from "./regex"

export const builtinDetectors: readonly AnyDetector[] = [regexDetector, pathDetector, astGrepDetector]
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run test/build.test.ts` → passes.

If `expect(source).toContain('import("@ast-grep/napi")')` fails, look at what tsup emitted before changing the assertion: esbuild sometimes writes the specifier with different quoting. Match the real output, and keep the negative assertion exactly as it is — it is the one that carries the decision.

- [ ] **Step 5: Verify nothing else regressed**

Run: `pnpm test` and `pnpm typecheck` → both clean.

- [ ] **Step 6: Commit**

`feat: register the ast-grep detector`

---

### Task 7: Structural catalog rules

**Files:**
- Modify: `packages/rules-react/rules.yaml`, `packages/rules-python/rules.yaml`
- Create: `packages/rules-react/styling.md`
- Modify: `packages/rules-python/errors.md`
- Modify: `.rulecast-rules.yaml` (regenerated)
- Test: `test/catalog.test.ts`

**Behaviour:** The catalog ships the two rules in Decision 7; both fire on a violating file and stay quiet on a clean one; the committed manifest is fresh and compiles.

- [ ] **Step 1: Read the existing catalog and its test**

Read `packages/rules-react/rules.yaml`, `packages/rules-python/rules.yaml` and `test/catalog.test.ts` first. `catalog.test.ts` holds a `CATALOG` array of every published id and a `cases: Case[]` table of `{ rule, kind, file, content, fires }` — one entry per scenario, positive and negative separately. The new rules go into both in that shape.

- [ ] **Step 2: Add the failing cases**

Add both ids to `CATALOG` in `packages/rulecast/test/catalog.test.ts` and these entries to `cases`.

**`CATALOG` is order-sensitive** — `catalog.test.ts` asserts `rules.map((rule) => rule.id)` equals it exactly. `scripts/manifest.ts` emits packages in sorted directory order (`rules-general`, `rules-python`, `rules-react`) and each package's rules in file order, so appending to the two `rules.yaml` files in Step 4 puts `python/no-silent-except` last among the `python/` ids and `react/no-inline-style` last among the `react/` ones. Place them in `CATALOG` accordingly.

```ts
  {
    rule: "react/no-inline-style",
    kind: "verify",
    file: "src/components/Card.tsx",
    content: "export const Card = () => <div style={{ padding: 8 }}>x</div>\n",
    fires: true,
  },
  {
    rule: "react/no-inline-style",
    kind: "verify",
    file: "src/components/Card.tsx",
    content: 'export const Card = () => <div className="p-2">x</div>\n',
    fires: false,
  },
  {
    rule: "python/no-silent-except",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get():\n    try:\n        fetch()\n    except ValueError:\n        pass\n",
    fires: true,
  },
  {
    rule: "python/no-silent-except",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get():\n    try:\n        fetch()\n    except ValueError:\n        log.warning('missing')\n",
    fires: false,
  },
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run test/catalog.test.ts`
Expected: FAIL — neither id exists in the manifest.

- [ ] **Step 4: Add the rules**

Append to `packages/rules-react/rules.yaml`:
```yaml
- id: no-inline-style
  name: No inline style props
  description: Style components with the design system's classes, not inline style objects.
  files: '(^|/)(components|routes)/.*\.[jt]sx$'
  severity: warning
  detect:
    ast-grep:
      language: tsx
      rule:
        pattern:
          context: '<div style={{ $$$PROPS }}/>'
          selector: jsx_attribute
  message: '{{file}}:{{line}} styles inline with {{text}}. Use the design system''s classes instead.'
  context:
    - "@styling.md#inline-styles"
```

Append to `packages/rules-python/rules.yaml`:
```yaml
- id: no-silent-except
  name: No silently swallowed exceptions
  description: An except clause whose only statement is pass hides the failure.
  files: '\.py$'
  detect:
    ast-grep:
      language: python
      rule:
        kind: except_clause
        has:
          kind: block
          has:
            kind: pass_statement
  message: '{{file}}:{{line}} swallows an exception with a bare pass. Handle it or let it propagate.'
  context:
    - "@errors.md#swallowed-exceptions"
```

The contextual pattern in the react rule matches a `style` attribute on **any** element, not only `<div>`: the `context` is just a parse harness and `selector` picks the node out of it. Verified 2026-09-20.

- [ ] **Step 5: Write the referenced sections**

Create `packages/rules-react/styling.md` with an `## Inline styles` heading (slug `inline-styles`) explaining the convention in a paragraph or two. Add a `## Swallowed exceptions` heading and section to `packages/rules-python/errors.md`. Keep both in the voice of the existing catalog docs — read one first.

- [ ] **Step 6: Regenerate the manifest**

Run: `pnpm manifest`
Then check `git diff .rulecast-rules.yaml` shows only the two new rules with their prefixes (`react/no-inline-style`, `python/no-silent-except`) and rewritten `@` paths.

- [ ] **Step 7: Verify**

Run: `pnpm vitest run test/catalog.test.ts` → passes, including the manifest-freshness and compile checks.
Run: `pnpm test` → clean.

- [ ] **Step 8: Commit**

`feat: add structural catalog rules for inline styles and swallowed exceptions`

---

### Task 8: The standalone binary embeds the native modules

**Files:**
- Create: `test/binary.test.ts`
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §13, §16

**Behaviour:** `bun build --compile` over the built CLI produces a binary that runs `rulecast run` against a Python ast-grep rule from a directory with no `node_modules` anywhere above it. This settles spec §16's early risk. The test skips when `bun` is not installed.

- [ ] **Step 1: Write the test**

`packages/rulecast/test/binary.test.ts`:
```ts
import { execFile, spawnSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, describe, expect, test } from "vitest"

import { localConfig } from "./helpers/config"
import { createRepo } from "./helpers/git"
import { TEST_HOME } from "./helpers/home"

const exec = promisify(execFile)
const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0

const PY_RULE = {
  id: "no-silent-except",
  name: "No silent except",
  files: "\\.py$",
  detect: {
    "ast-grep": {
      language: "python",
      rule: { kind: "except_clause", has: { kind: "block", has: { kind: "pass_statement" } } },
    },
  },
  message: "{{file}}:{{line}} swallows an exception.",
}

/**
 * Spec §16's early risk: the standalone binary has to embed @ast-grep/napi's native module and
 * @ast-grep/lang-python's prebuilt parser. Both are loaded from absolute paths inside node_modules
 * under Node, so this proves bun's bundler rewrote them into the binary. The binary is copied
 * outside the repository and run from an empty directory: nothing can resolve node_modules there.
 */
describe.runIf(hasBun)("standalone binary", () => {
  let binary: string

  beforeAll(async () => {
    await exec("pnpm", ["build"])
    const out = await mkdtemp(path.join(tmpdir(), "rulecast-binary-"))
    binary = path.join(out, "rulecast")
    await exec("bun", ["build", path.resolve("dist/cli.js"), "--compile", "--outfile", binary])
  }, 180_000)

  test("matches a Python ast-grep rule with no node_modules in reach", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([PY_RULE]),
      "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
    })
    const result = spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
      cwd: root,
      env: { ...process.env, RULECAST_HOME: TEST_HOME },
      encoding: "utf8",
    })
    expect(result.stderr).not.toContain("Cannot find module")
    expect(result.stdout).toContain("app/a.py:4 swallows an exception.")
    expect(result.status).toBe(1)
  }, 60_000)
})
```

`createRepo` writes into a fresh temp directory, which is outside the repository, so no `node_modules` is resolvable from it.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/binary.test.ts`
Expected: PASS (this was verified with a spike on 2026-09-20). If it fails with `Cannot find module`, the cause is almost certainly a `require`/`createRequire` that crept into the ast-grep path — bun bundles `import()` with a literal specifier but not `createRequire`. Fix the import, not the test.

If `bun` is missing on the machine, the suite skips; note that in the commit message and say so when reporting the task, rather than reporting a pass that did not happen.

- [ ] **Step 3: Measure the binary's native-module cost**

Run the binary's `run` a few times and time it, and separately time `node dist/cli.js run` on the same fixture. Record the two numbers; the spike measured ~270 ms in the binary against ~4 ms under Node for the module load alone.

- [ ] **Step 4: Update the spec**

In §16, replace:
```
**Early risk:** the standalone binary must embed `@ast-grep/napi`'s native module. Verified in the first implementation milestone; if it fails, the binary ships without the `ast-grep` detector and `doctor` reports it unavailable.
```
with:
```
**Resolved (2026-09-20, plan 5a):** `bun build --compile` embeds both `@ast-grep/napi`'s native module and `@ast-grep/lang-python`'s prebuilt parser; a binary run from a directory with no `node_modules` matches Python patterns. `test/binary.test.ts` keeps it that way, and skips where `bun` is absent. The detector reaches the native module only through a dynamic `import()`: `createRequire` is not bundled by bun and must not be used on that path. Loading the module costs ~4 ms under Node but ~<N> ms inside the binary, so the binary's hook latency is a release concern of its own.
```

Replace `<N>` with the number measured in Step 3.

In §13's budget line, replace ``process start with `@ast-grep/napi` ~80–120 ms`` (the spec has no "is" there) with the measured Node figure and a pointer to §16 for the binary:
```
Budget: process start with `@ast-grep/napi` ~<measured> ms under Node (the binary is slower, §16); compile and session open ~20 ms; detection and change sets within `timeouts.edit_deadline_ms` (350 ms); commit and rendering the remainder.
```

- [ ] **Step 5: Commit**

`test: verify the standalone binary embeds ast-grep's native modules`

---

## End-to-end verification

- [ ] `pnpm test` from the repository root — everything green, and the skipped count is still 1 unless `bun` is missing, in which case it is 2.
- [ ] `pnpm typecheck` and `pnpm lint` — clean.
- [ ] `pnpm test:perf` — p95 still well under 500 ms. Record p50/p95 and compare with plan 4's **83 / 91 ms**. The perf fixture has no ast-grep rule yet (plan 5c adds one), so a regression here means the native module is being loaded on a path that does not need it — check `dist/cli.js` for a static import.
- [ ] A hand check that the detector is real, from a scratch directory:

```bash
cd "$(mktemp -d)" && git init -q .
cat > .rulecast-config.yaml <<'YAML'
repos:
  - repo: local
    rules:
      - id: no-silent-except
        name: No silent except
        files: '\.py$'
        detect:
          ast-grep:
            language: python
            rule:
              kind: except_clause
              has: { kind: block, has: { kind: pass_statement } }
        message: '{{file}}:{{line}} swallows an exception.'
YAML
printf 'def f():\n    try:\n        g()\n    except ValueError:\n        pass\n' > a.py
node <path-to-repo>/packages/rulecast/dist/cli.js run --all-files --format agent; echo "exit=$?"
```
Expected: `a.py:4 swallows an exception.` and `exit=1`.

- [ ] `ls ~/.cache/rulecast` is still absent.
- [ ] Everything pushed to `main`.
