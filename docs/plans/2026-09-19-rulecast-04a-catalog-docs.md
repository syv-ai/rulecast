# rulecast Plan 4a — Catalog rule packages and agent docs Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rulecast repository a rule repo with a first catalog, and publish the agent-facing docs that `rulecast init`'s drafting prompt points at.

**Architecture:** Three rule packages (`packages/rules-general`, `rules-python`, `rules-react`) each hold a `rules.yaml` of complete rules and the convention docs those rules reference. A repo-tooling script, `packages/rulecast/scripts/generate-manifest.ts` (run with `tsx` as `pnpm manifest`), merges them into the root `.rulecast-rules.yaml`: ids get the package prefix and `@` paths are rewritten relative to the repository root. Tests keep the committed manifest fresh, compile it with `compileManifest`, and prove each catalog rule fires on a violating file and stays quiet on a clean one. The `agents/` docs are plain markdown, versioned by tag; a test checks that every link in them and every rulecast repository URL in `agents/` and `src/` points at a file that exists. Spec: `docs/specs/2026-09-15-rulecast-design.md` §4 (rule repos), §12 (agent docs), §16.

**Tech Stack:** Node ≥ 20, TypeScript 5, yaml 2, vitest, tsx (dev only).

Prerequisite: plan 3 (`2026-09-19-rulecast-03a-monorepo-config.md` to `03e-repos-compaction.md`) is done. Continue with `2026-09-19-rulecast-04b-init.md` afterwards.

---

## Decisions this plan implements

1. **Catalog contents.** The user approved this starter set on 2026-09-19. It is drawn from aka-agents2's `CLAUDE.md` conventions but written generically. Only the `regex` and `path` detectors and touch rules are used, because `ast-grep` arrives in plan 5.

   | Id | Kind | Severity | Files |
   |---|---|---|---|
   | `generated-code` | `path` | error | `\.gen\.[cm]?[jt]sx?$\|(^\|/)__generated__/` |
   | `python/no-httpexception-in-services` | `regex` `raise\s+HTTPException\b` | error | `(^\|/)services/.*\.py$` |
   | `python/no-queries-in-services` | `regex` `\b(session\|db)\.(exec\|execute\|query\|scalars?)\(` | error | `(^\|/)services/.*\.py$` |
   | `python/layering` | touch | — | `(^\|/)(routes\|services\|crud)/.*\.py$` |
   | `react/no-fetch-in-components` | `regex` `\bfetch\(\|\baxios\.(get\|post\|put\|patch\|delete\|request)\(` | warning | `(^\|/)components/.*\.[jt]sx$` |
   | `react/data-fetching` | touch | — | `(^\|/)(components\|routes\|hooks)/.*\.[jt]sx?$` |

2. **Prefixes.** `rules-<name>` publishes its ids as `<name>/<id>`, except `rules-general`, whose ids stay unprefixed (the spec's `generated-code` example). Aliases get the same prefix. Task 1 writes this into spec §4.
3. **The generator is repo tooling, not product.** It lives in `packages/rulecast/scripts/`, is not bundled into `dist/`, and runs with `tsx`. Comments in package `rules.yaml` files are not copied; the manifest starts with a "generated, do not edit" header. Staleness is enforced by `pnpm test`, which lefthook runs before every push. CI arrives in plan 7.
4. **Agent docs document only what exists.** `agents/reference/detectors.md` documents `regex` and `path`, and lists `ast-grep`, `command`, `linter` and `llm` as coming. Relative links in the docs resolve against the doc's own URL, and each doc says so, because agents read the docs from raw GitHub URLs.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/core/files.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths under `scripts/`, `src/` and `test/` are in `packages/rulecast/`. The others are relative to the repository root.

| File | Responsibility |
|---|---|
| `packages/rules-general/rules.yaml`, `generated-code.md` | Unprefixed catalog rules and their doc |
| `packages/rules-python/rules.yaml`, `errors.md`, `layering.md` | `python/` catalog rules and their docs |
| `packages/rules-react/rules.yaml`, `data-fetching.md` | `react/` catalog rules and their doc |
| `.rulecast-rules.yaml` | Generated root manifest: the rulecast repo as a rule repo |
| `scripts/manifest.ts` | `generateManifest(repoRoot)`: pure manifest generation |
| `scripts/generate-manifest.ts` | `pnpm manifest`: writes `.rulecast-rules.yaml`, or `--check` for staleness |
| `test/scripts/manifest.test.ts` | Generator behaviour on fixture packages |
| `test/catalog.test.ts` | Committed manifest is fresh, compiles clean; every catalog rule fires and stays quiet correctly |
| `agents/SETUP.md`, `agents/DRAFT-RULES.md`, `agents/reference/rule-format.md`, `agents/reference/detectors.md` | Agent-facing docs (spec §12) |
| `test/agents-docs.test.ts` | Links and repository URLs in the agent docs and `src/` exist |
| `package.json` (root), `packages/rulecast/package.json`, `packages/rulecast/tsconfig.json` | `manifest` scripts, `tsx`, `scripts/` typechecked |
| `docs/specs/2026-09-15-rulecast-design.md` | §4: prefix rule for `rules-general`, how the manifest is generated and checked; §12: `SETUP.md` runs `init` with `--agent` |

## Not in this plan

- **The drafting prompt and `rulecast init`**: `2026-09-19-rulecast-04b-init.md`. Its prompt URL (`https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/DRAFT-RULES.md`) is picked up by Task 2's `src/` URL scan once it exists, with no change to that test.
- **Publishing.** The raw GitHub links work only once the repository is public, which the user decides. Nothing here needs network access.
- **Structural catalog rules** (`ast-grep`): added with the detector in plan 5.

---

### Task 1: Catalog rule packages and the generated manifest

**Files:**
- Create: `packages/rules-general/rules.yaml`, `packages/rules-general/generated-code.md`, `packages/rules-python/rules.yaml`, `packages/rules-python/errors.md`, `packages/rules-python/layering.md`, `packages/rules-react/rules.yaml`, `packages/rules-react/data-fetching.md`, `.rulecast-rules.yaml` (generated)
- Create: `scripts/manifest.ts`, `scripts/generate-manifest.ts`
- Modify: `packages/rulecast/package.json` (script, `tsx`), `packages/rulecast/tsconfig.json` (`include`), root `package.json` (script), `docs/specs/2026-09-15-rulecast-design.md` §4
- Test: `test/scripts/manifest.test.ts`, `test/catalog.test.ts`

- [ ] **Step 1: Write the failing generator test**

`packages/rulecast/test/scripts/manifest.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { generateManifest, idPrefix } from "../../scripts/manifest"
import { createProject } from "../helpers/project"

describe("idPrefix", () => {
  test("rules-general is unprefixed; other packages prefix their name", () => {
    expect(idPrefix("rules-general")).toBe("")
    expect(idPrefix("rules-python")).toBe("python/")
    expect(idPrefix("rules-react-native")).toBe("react-native/")
    expect(() => idPrefix("rulecast")).toThrow("rulecast is not a rule package")
  })
})

describe("generateManifest", () => {
  test("merges rule packages in name order, prefixes ids and aliases, rewrites @ paths", async () => {
    const root = await createProject({
      "packages/rules-python/rules.yaml": [
        "- id: no-print",
        "  name: No print",
        "  alias: no-print-in-scripts",
        "  files: '\\.py$'",
        "  detect: { regex: { pattern: 'print\\(' } }",
        '  message: "{{file}}:{{line}} prints."',
        "  context:",
        '    - "@docs/logging.md#levels"',
        '    - { path: "@docs/style.md", mode: read }',
        "",
      ].join("\n"),
      "packages/rules-general/rules.yaml": [
        "# Comments in package files are not copied.",
        "- id: generated-code",
        "  name: Generated code",
        "  stages: [touch]",
        '  context: ["@generated.md"]',
        "",
      ].join("\n"),
      "packages/rulecast/package.json": "{}\n",
      "packages/notes/rules.yaml": "not a rule package\n",
    })
    expect(await generateManifest(root)).toBe(
      [
        "# Generated by `pnpm manifest` from packages/rules-*/rules.yaml. Do not edit by hand.",
        "",
        "- id: generated-code",
        "  name: Generated code",
        "  stages:",
        "    - touch",
        "  context:",
        '    - "@packages/rules-general/generated.md"',
        "- id: python/no-print",
        "  name: No print",
        "  alias: python/no-print-in-scripts",
        "  files: \\.py$",
        "  detect:",
        "    regex:",
        "      pattern: print\\(",
        '  message: "{{file}}:{{line}} prints."',
        "  context:",
        '    - "@packages/rules-python/docs/logging.md#levels"',
        '    - path: "@packages/rules-python/docs/style.md"',
        "      mode: read",
        "",
      ].join("\n"),
    )
  })

  test("rejects a package file that is not a list of rules with ids", async () => {
    const notList = await createProject({ "packages/rules-bad/rules.yaml": "a: 1\n" })
    await expect(generateManifest(notList)).rejects.toThrow("packages/rules-bad/rules.yaml: must be a list of rules")
    const noId = await createProject({ "packages/rules-bad/rules.yaml": "- name: x\n" })
    await expect(generateManifest(noId)).rejects.toThrow("packages/rules-bad/rules.yaml: rule 1 has no id")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/scripts/manifest.test.ts`
Expected: FAIL: the import `../../scripts/manifest` cannot be resolved.

- [ ] **Step 3: Add `tsx` and typecheck `scripts/`**

Run: `pnpm --filter @syv-ai/rulecast add -D tsx`

In `packages/rulecast/tsconfig.json`, replace:
```json
  "include": ["src", "test"]
```
with:
```json
  "include": ["src", "test", "scripts"]
```

- [ ] **Step 4: Write the generator**

`packages/rulecast/scripts/manifest.ts`:
```ts
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { parse, stringify } from "yaml"

export const MANIFEST_HEADER =
  "# Generated by `pnpm manifest` from packages/rules-*/rules.yaml. Do not edit by hand.\n\n"

const RULE_PACKAGE = /^rules-([a-z0-9-]+)$/

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** "rules-general" publishes ids as they are; "rules-python" publishes them under "python/". */
export function idPrefix(dir: string): string {
  const name = RULE_PACKAGE.exec(dir)?.[1]
  if (name === undefined) throw new Error(`${dir} is not a rule package`)
  return name === "general" ? "" : `${name}/`
}

function rewritePath(value: string, base: string): string {
  return value.startsWith("@") ? `@${path.posix.join(base, value.slice(1))}` : value
}

function rewriteReference(reference: unknown, base: string): unknown {
  if (typeof reference === "string") return rewritePath(reference, base)
  if (isObject(reference) && typeof reference.path === "string") {
    return { ...reference, path: rewritePath(reference.path, base) }
  }
  return reference
}

/** A package rule as the root manifest publishes it; key order is kept. */
function publish(rule: JsonObject, id: string, prefix: string, base: string): JsonObject {
  return {
    ...rule,
    id: `${prefix}${id}`,
    ...(typeof rule.alias === "string" ? { alias: `${prefix}${rule.alias}` } : {}),
    ...(Array.isArray(rule.context)
      ? { context: rule.context.map((reference) => rewriteReference(reference, base)) }
      : {}),
  }
}

/** The root manifest of the rulecast repository, built from every packages/rules-* package. */
export async function generateManifest(repoRoot: string): Promise<string> {
  const entries = await readdir(path.join(repoRoot, "packages"), { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory() && RULE_PACKAGE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const rules: JsonObject[] = []
  for (const dir of dirs) {
    const base = `packages/${dir}`
    const source = `${base}/rules.yaml`
    const data: unknown = parse(await readFile(path.join(repoRoot, source), "utf8"))
    if (!Array.isArray(data)) throw new Error(`${source}: must be a list of rules`)
    for (const [index, rule] of data.entries()) {
      const id = isObject(rule) ? rule.id : undefined
      if (!isObject(rule) || typeof id !== "string") throw new Error(`${source}: rule ${index + 1} has no id`)
      rules.push(publish(rule, id, idPrefix(dir), base))
    }
  }
  return MANIFEST_HEADER + stringify(rules, { lineWidth: 0 })
}
```

`lineWidth: 0` stops `yaml` from folding long messages across lines, so the output doesn't depend on message length.

- [ ] **Step 5: Run the generator test to verify it passes**

Run: `pnpm vitest run test/scripts/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing catalog test**

`packages/rulecast/test/catalog.test.ts`:
```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, test } from "vitest"

import { generateManifest } from "../scripts/manifest"
import { compileManifest } from "../src/core/compile/project"
import type { CompiledRule } from "../src/core/compile/rule"
import { defaultConfig } from "../src/core/config/schema"
import { runPipeline } from "../src/core/pipeline"
import { registry } from "./helpers/fixture"
import { stateDirFor } from "./helpers/home"
import { createProject } from "./helpers/project"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const CATALOG = [
  "generated-code",
  "python/no-httpexception-in-services",
  "python/no-queries-in-services",
  "python/layering",
  "react/no-fetch-in-components",
  "react/data-fetching",
]

interface Case {
  rule: string
  /** verify runs detectors; touch fires touch rules. */
  kind: "verify" | "touch"
  file: string
  content: string
  fires: boolean
}

const SERVICE_OK = "def get_user(session, user_id):\n    return crud.get_user(session, user_id)\n"
const COMPONENT_OK = "export function UserList() {\n  const { data } = useUsers()\n  return <List items={data} />\n}\n"

const cases: Case[] = [
  {
    rule: "generated-code",
    kind: "verify",
    file: "frontend/src/client/sdk.gen.ts",
    content: "export {}\n",
    fires: true,
  },
  { rule: "generated-code", kind: "verify", file: "src/__generated__/schema.ts", content: "export {}\n", fires: true },
  { rule: "generated-code", kind: "verify", file: "frontend/src/client.ts", content: "export {}\n", fires: false },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get_user(session, user_id):\n    raise HTTPException(status_code=404)\n",
    fires: true,
  },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def get_user(session, user_id):\n    raise UserNotFound(user_id)\n",
    fires: false,
  },
  {
    rule: "python/no-httpexception-in-services",
    kind: "verify",
    file: "app/api/routes/users.py",
    content: "def read_user(user_id):\n    raise HTTPException(status_code=404)\n",
    fires: false,
  },
  {
    rule: "python/no-queries-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: "def list_users(session):\n    return session.exec(select(User)).all()\n",
    fires: true,
  },
  {
    rule: "python/no-queries-in-services",
    kind: "verify",
    file: "app/services/users.py",
    content: SERVICE_OK,
    fires: false,
  },
  { rule: "python/layering", kind: "touch", file: "app/services/users.py", content: SERVICE_OK, fires: true },
  { rule: "python/layering", kind: "touch", file: "app/models/user.py", content: "class User: ...\n", fires: false },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/components/UserList.tsx",
    content: 'export async function load() {\n  return fetch("/api/users")\n}\n',
    fires: true,
  },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/components/UserList.tsx",
    content: COMPONENT_OK,
    fires: false,
  },
  {
    rule: "react/no-fetch-in-components",
    kind: "verify",
    file: "src/hooks/useUsers.ts",
    content: 'export const listUsers = () => fetch("/api/users")\n',
    fires: false,
  },
  {
    rule: "react/data-fetching",
    kind: "touch",
    file: "src/components/UserList.tsx",
    content: COMPONENT_OK,
    fires: true,
  },
  { rule: "react/data-fetching", kind: "touch", file: "src/utils/format.ts", content: "export {}\n", fires: false },
]

describe("the rulecast repository's rule manifest", () => {
  test("is up to date with packages/rules-*", async () => {
    const committed = await readFile(path.join(repoRoot, ".rulecast-rules.yaml"), "utf8")
    expect(committed, "run pnpm manifest").toBe(await generateManifest(repoRoot))
  })

  test("compiles without diagnostics", async () => {
    const { rules, diagnostics } = await compileManifest(repoRoot, registry)
    expect(diagnostics).toEqual([])
    expect(rules.map((rule) => rule.id)).toEqual(CATALOG)
  })
})

describe("catalog rules", () => {
  let rules: CompiledRule[] = []
  beforeAll(async () => {
    rules = (await compileManifest(repoRoot, registry)).rules
  })

  test("every rule has a case where it fires and one where it does not", () => {
    for (const id of CATALOG) {
      expect(
        cases.some((c) => c.rule === id && c.fires),
        `${id} fires`,
      ).toBe(true)
      expect(
        cases.some((c) => c.rule === id && !c.fires),
        `${id} stays quiet`,
      ).toBe(true)
    }
  })

  test.each(cases)("$rule on $file ($kind) fires: $fires", async ({ rule, kind, file, content, fires }) => {
    const root = await createProject({ [file]: content })
    const { delivery } = await runPipeline({
      project: { root, config: defaultConfig(), rules, diagnostics: [] },
      stateDir: stateDirFor(root),
      event: { kind, files: [file], cwd: root },
      registry,
      maxContextChars: null,
    })
    const fired =
      kind === "touch" ? delivery.touches.includes(rule) : delivery.findings.some((finding) => finding.rule === rule)
    expect(fired).toBe(fires)
  })
})
```

The rules come from `compileManifest(repoRoot)`, so their references point into the repository while the files are in a temporary project. The test checks only findings and touches, never reference content.

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run test/catalog.test.ts`
Expected: FAIL. `is up to date` fails with ENOENT for `.rulecast-rules.yaml`, `compiles without diagnostics` reports the missing manifest, and the `fires: true` cases find nothing.

- [ ] **Step 8: Write the rule packages**

`packages/rules-general/rules.yaml`:
```yaml
# Rules without an id prefix. "@" paths in context are relative to this directory.
- id: generated-code
  name: Generated code is never edited by hand
  description: Flags edits to generated files. Override files to match your generator's output directory.
  files: '\.gen\.[cm]?[jt]sx?$|(^|/)__generated__/'
  severity: error
  detect:
    path: {}
  message: "{{file}} is generated. Change its source and regenerate it; never edit it by hand."
  context:
    - "@generated-code.md"
```

`packages/rules-general/generated-code.md`:
````markdown
# Generated code

Files produced by a generator (API clients, route trees, schema types, protobuf stubs) are outputs, not sources. A hand edit is lost the next time the generator runs, and until then the output disagrees with its source.

## Changing generated code

1. Find the source the file is generated from: the backend's OpenAPI schema, the route files, the schema definition. The file's header comment or the project's scripts usually name the generator.
2. Change the source.
3. Run the project's generate command (look in `package.json` scripts, a `Makefile`, or a `scripts/` directory).
4. Commit the source change and the regenerated files together.

If the generator itself produces wrong output, fix its configuration or report it; don't patch the output.

## Which files are generated

This rule matches `*.gen.ts`-style files and `__generated__/` directories by default. A project whose generator writes elsewhere overrides the rule's `files` in `.rulecast-config.yaml`:

```yaml
- id: generated-code
  files: ^frontend/src/client/
```
````

`packages/rules-python/rules.yaml`:
```yaml
# Published with the "python/" id prefix. "@" paths in context are relative to this directory.
- id: no-httpexception-in-services
  name: Services raise domain exceptions, not HTTPException
  description: Flags HTTPException raised in the service layer, which must stay independent of HTTP.
  files: '(^|/)services/.*\.py$'
  severity: error
  detect:
    regex:
      pattern: 'raise\s+HTTPException\b'
  message: "{{file}}:{{line}} raises HTTPException in the service layer. Raise a domain exception; the API layer maps it to an HTTP response."
  context:
    - "@errors.md#services-raise-domain-exceptions"
- id: no-queries-in-services
  name: Services reach the database through CRUD functions
  description: Flags database queries written directly in the service layer.
  files: '(^|/)services/.*\.py$'
  severity: error
  detect:
    regex:
      pattern: '\b(session|db)\.(exec|execute|query|scalars?)\('
  message: "{{file}}:{{line}} queries the database from the service layer. Move the query into a CRUD function."
  context:
    - "@layering.md#data-access-goes-through-crud"
- id: layering
  name: Route, service and CRUD layering
  description: Delivers the layering conventions the first time an agent works on a route, service or CRUD module.
  files: '(^|/)(routes|services|crud)/.*\.py$'
  stages: [touch]
  context:
    - "@layering.md"
```

`packages/rules-python/errors.md`:
````markdown
# Errors in Python services

## Services raise domain exceptions

Services hold the business logic and know nothing about HTTP. When an operation cannot go ahead, the service raises a domain exception that names what went wrong: `UserNotFound`, `PermissionDenied`, `InvalidTransition`. It never raises `HTTPException` and never picks a status code.

Domain exceptions live in one module (for example `app/core/exceptions.py`) and share a base class. The API layer maps them to HTTP responses in one place: an exception handler registered on the app, or the route that calls the service.

```python
# app/services/users.py
def get_user(session: Session, user_id: int) -> User:
    user = crud.get_user(session, user_id)
    if user is None:
        raise UserNotFound(user_id)
    return user
```

```python
# app/main.py
@app.exception_handler(UserNotFound)
async def user_not_found(request: Request, error: UserNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(error)})
```

Why: the same service runs from routes, background jobs, scripts and tests, which have no HTTP response to send. Mapping in one place keeps status codes and messages consistent.

## Messages users see

Write the user-facing message on the domain exception, in the language the product uses. Routes and handlers pass it through; they don't rewrite it.
````

`packages/rules-python/layering.md`:
````markdown
# Layering in Python backends

A request passes through three layers, each with one job:

```
HTTP request → route → service → CRUD → database
```

| Layer | Directory | Does | Never |
|---|---|---|---|
| Route | `routes/` (often `api/routes/`) | Parses input, resolves auth dependencies, calls one service, returns the response | Business rules, database queries |
| Service | `services/` | Business logic, authorization decisions, domain exceptions | HTTP (`HTTPException`, status codes), database queries |
| CRUD | `crud/` | Database queries, one function per query | Business rules, HTTP |

## Business logic goes in services

A route that does more than parse, call and return is hiding logic that other entry points (jobs, scripts, other routes) will need. Move it into a service function and call that. Keep the route thin:

```python
@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, session: SessionDep, current_user: CurrentUser) -> UserPublic:
    return users_service.deactivate(session, user_id, actor=current_user)
```

## Data access goes through CRUD

Services never build or execute queries: no `session.exec(...)`, `session.execute(...)`, `session.query(...)` or `session.scalars(...)` in `services/`. Put the query in a CRUD function whose name says what it returns, and call it from the service with the session:

```python
# app/crud/users.py
def get_active_users(session: Session) -> list[User]:
    return list(session.exec(select(User).where(User.is_active)).all())

# app/services/users.py
def active_user_count(session: Session) -> int:
    return len(crud.get_active_users(session))
```

Shared query helpers belong in the CRUD package too. The service decides what to do; CRUD knows how to fetch it.
````

`packages/rules-react/rules.yaml`:
```yaml
# Published with the "react/" id prefix. "@" paths in context are relative to this directory.
- id: no-fetch-in-components
  name: Components get server data through query hooks
  description: Flags network calls (fetch, axios) made directly in components.
  files: '(^|/)components/.*\.[jt]sx$'
  severity: warning
  detect:
    regex:
      pattern: '\bfetch\(|\baxios\.(get|post|put|patch|delete|request)\('
  message: "{{file}}:{{line}} calls the network from a component. Fetch server data through a query or mutation hook."
  context:
    - "@data-fetching.md"
- id: data-fetching
  name: Server state lives in the query layer
  description: Delivers the data-fetching conventions the first time an agent works on a component, route or hook.
  files: '(^|/)(components|routes|hooks)/.*\.[jt]sx?$'
  stages: [touch]
  context:
    - "@data-fetching.md"
```

`packages/rules-react/data-fetching.md`:
````markdown
# Data fetching in React

## Server state lives in the query layer

Data that comes from the API is server state. A query library (TanStack Query, SWR or similar) fetches, caches and invalidates it; components don't keep their own copies in `useState`.

Each resource gets hooks next to its feature, which call the API client and own the query keys:

```tsx
// hooks/useUsers.ts
export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() })
}

export function useDeactivateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  })
}
```

UI state (open dialogs, form input, selection) stays in components or React context.

## Components never fetch

Components render data and handle interaction. They read server data from query hooks and change it through mutation hooks; they never call `fetch`, `axios` or the API client themselves.

```tsx
export function UserList() {
  const { data: users = [], isPending } = useUsers()
  if (isPending) return <Spinner />
  return <ul>{users.map((user) => <li key={user.id}>{user.name}</li>)}</ul>
}
```

Why: a request inside a component bypasses the cache, runs again on every mount, and leaves loading, error and invalidation handling to each call site.

## Generated API clients

When the API client is generated from an OpenAPI schema, don't edit the generated files. Change the backend, then run the project's generate command.
````

- [ ] **Step 9: Write the `pnpm manifest` entry point and scripts**

`packages/rulecast/scripts/generate-manifest.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { generateManifest } from "./manifest"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const target = path.join(repoRoot, ".rulecast-rules.yaml")
const manifest = await generateManifest(repoRoot)

if (process.argv.includes("--check")) {
  const committed = await readFile(target, "utf8").catch(() => null)
  if (committed !== manifest) {
    process.stderr.write(".rulecast-rules.yaml is stale: run pnpm manifest\n")
    process.exitCode = 1
  }
} else {
  await writeFile(target, manifest)
  process.stdout.write("wrote .rulecast-rules.yaml\n")
}
```

In `packages/rulecast/package.json`, add to `scripts`:
```json
    "manifest": "tsx scripts/generate-manifest.ts",
```

In the root `package.json`, add to `scripts`:
```json
    "manifest": "pnpm --filter @syv-ai/rulecast manifest",
```

- [ ] **Step 10: Generate the manifest**

Run: `pnpm manifest`
Expected: prints `wrote .rulecast-rules.yaml`. The file at the repository root is exactly:

```yaml
# Generated by `pnpm manifest` from packages/rules-*/rules.yaml. Do not edit by hand.

- id: generated-code
  name: Generated code is never edited by hand
  description: Flags edits to generated files. Override files to match your generator's output directory.
  files: \.gen\.[cm]?[jt]sx?$|(^|/)__generated__/
  severity: error
  detect:
    path: {}
  message: "{{file}} is generated. Change its source and regenerate it; never edit it by hand."
  context:
    - "@packages/rules-general/generated-code.md"
- id: python/no-httpexception-in-services
  name: Services raise domain exceptions, not HTTPException
  description: Flags HTTPException raised in the service layer, which must stay independent of HTTP.
  files: (^|/)services/.*\.py$
  severity: error
  detect:
    regex:
      pattern: raise\s+HTTPException\b
  message: "{{file}}:{{line}} raises HTTPException in the service layer. Raise a domain exception; the API layer maps it to an HTTP response."
  context:
    - "@packages/rules-python/errors.md#services-raise-domain-exceptions"
- id: python/no-queries-in-services
  name: Services reach the database through CRUD functions
  description: Flags database queries written directly in the service layer.
  files: (^|/)services/.*\.py$
  severity: error
  detect:
    regex:
      pattern: \b(session|db)\.(exec|execute|query|scalars?)\(
  message: "{{file}}:{{line}} queries the database from the service layer. Move the query into a CRUD function."
  context:
    - "@packages/rules-python/layering.md#data-access-goes-through-crud"
- id: python/layering
  name: Route, service and CRUD layering
  description: Delivers the layering conventions the first time an agent works on a route, service or CRUD module.
  files: (^|/)(routes|services|crud)/.*\.py$
  stages:
    - touch
  context:
    - "@packages/rules-python/layering.md"
- id: react/no-fetch-in-components
  name: Components get server data through query hooks
  description: Flags network calls (fetch, axios) made directly in components.
  files: (^|/)components/.*\.[jt]sx$
  severity: warning
  detect:
    regex:
      pattern: \bfetch\(|\baxios\.(get|post|put|patch|delete|request)\(
  message: "{{file}}:{{line}} calls the network from a component. Fetch server data through a query or mutation hook."
  context:
    - "@packages/rules-react/data-fetching.md"
- id: react/data-fetching
  name: Server state lives in the query layer
  description: Delivers the data-fetching conventions the first time an agent works on a component, route or hook.
  files: (^|/)(components|routes|hooks)/.*\.[jt]sx?$
  stages:
    - touch
  context:
    - "@packages/rules-react/data-fetching.md"
```

If it differs, the package files differ from Step 8. Fix them, not the manifest.

Run: `pnpm manifest --check`
Expected: no output, exit 0.

- [ ] **Step 11: Run the catalog test to verify it passes**

Run: `pnpm vitest run test/catalog.test.ts`
Expected: PASS: 2 manifest tests, the coverage test, and 15 cases.

If `compiles without diagnostics` reports an anchor, the heading in the doc does not slugify to the anchor. Check the heading text against `#services-raise-domain-exceptions` and `#data-access-goes-through-crud`.

- [ ] **Step 12: Record the prefix rule and the generator in the spec**

In `docs/specs/2026-09-15-rulecast-design.md` §4 (Rule repos), replace:
```markdown
The rulecast repository is itself a rule repo (§16): its root manifest is generated from `packages/rules-*/rules.yaml`, with package-prefixed ids (`rules-python` → `python/`) and `@` paths rewritten relative to the repo root. CI fails when the committed manifest is stale. One tag versions the CLI and every rule package.
```
with:
```markdown
The rulecast repository is itself a rule repo (§16): its root manifest is generated from `packages/rules-*/rules.yaml`, with package-prefixed ids and aliases (`rules-python` → `python/`; `rules-general` publishes its ids unprefixed) and `@` paths rewritten relative to the repo root. `pnpm manifest` (`packages/rulecast/scripts/generate-manifest.ts`) writes it, and `pnpm test` fails when the committed manifest is stale or does not compile. One tag versions the CLI and every rule package.
```

- [ ] **Step 13: Run everything**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors, including `scripts/`.

- [ ] **Step 14: Commit**

```bash
git add packages/rules-general/rules.yaml packages/rules-general/generated-code.md packages/rules-python/rules.yaml packages/rules-python/errors.md packages/rules-python/layering.md packages/rules-react/rules.yaml packages/rules-react/data-fetching.md .rulecast-rules.yaml packages/rulecast/scripts/manifest.ts packages/rulecast/scripts/generate-manifest.ts packages/rulecast/test/scripts/manifest.test.ts packages/rulecast/test/catalog.test.ts packages/rulecast/package.json packages/rulecast/tsconfig.json package.json pnpm-lock.yaml docs/specs/2026-09-15-rulecast-design.md
git commit -m "feat: add the catalog rule packages and the generated manifest

Claude goes brr.. via Dash"
```

---

### Task 2: Agent docs

**Files:**
- Create: `agents/SETUP.md`, `agents/DRAFT-RULES.md`, `agents/reference/rule-format.md`, `agents/reference/detectors.md` (repository root)
- Modify: `docs/specs/2026-09-15-rulecast-design.md` §12 (Agent docs: `SETUP.md` passes `--agent`)
- Test: `test/agents-docs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rulecast/test/agents-docs.test.ts`:
```ts
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { sectionRange } from "../src/core/anchors"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

const DOCS = [
  "agents/SETUP.md",
  "agents/DRAFT-RULES.md",
  "agents/reference/rule-format.md",
  "agents/reference/detectors.md",
]

const FENCE = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const REPOSITORY_URL =
  /https:\/\/(?:raw\.githubusercontent\.com\/syv-ai\/rulecast|github\.com\/syv-ai\/rulecast\/blob)\/[^/\s]+\/([^\s)"'`#>]+)/g

/** Repository paths that rulecast's raw and blob URLs in `text` point at; the ref segment can be anything, such as a template placeholder. */
function repositoryPaths(text: string): string[] {
  return [...text.matchAll(REPOSITORY_URL)].map((match) => match[1]!)
}

async function filesUnder(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(path.join(repoRoot, dir), { recursive: true })
  return entries
    .filter((entry) => entry.endsWith(extension))
    .map((entry) => path.join(repoRoot, dir, entry))
    .sort()
}

describe("agent docs", () => {
  test("exist", () => {
    for (const doc of DOCS) expect(existsSync(path.join(repoRoot, doc)), doc).toBe(true)
  })

  test("relative links resolve to files and headings in the repository", async () => {
    const failures: string[] = []
    let checked = 0
    for (const file of await filesUnder("agents", ".md")) {
      const text = (await readFile(file, "utf8")).replace(FENCE, "")
      for (const [, href] of text.matchAll(LINK)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href!)) continue
        checked++
        const [target = "", anchor] = href!.split("#")
        const resolved = target === "" ? file : path.resolve(path.dirname(file), target)
        const where = `${path.relative(repoRoot, file)} → ${href}`
        if (!resolved.startsWith(repoRoot) || !existsSync(resolved)) {
          failures.push(`${where}: no such file`)
        } else if (anchor && /\.mdx?$/.test(resolved) && !sectionRange(await readFile(resolved, "utf8"), anchor)) {
          failures.push(`${where}: no such heading`)
        }
      }
    }
    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test("repositoryPaths finds raw and blob URLs", () => {
    const text = [
      "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md and",
      "https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md#regex, not",
      "https://github.com/syv-ai/rulecast or `https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/SETUP.md`.",
    ].join("\n")
    expect(repositoryPaths(text)).toEqual(["agents/DRAFT-RULES.md", "agents/reference/detectors.md", "agents/SETUP.md"])
  })

  test("every rulecast repository URL in agents/ and src/ points at a file in the repository", async () => {
    const files = [...(await filesUnder("agents", ".md")), ...(await filesUnder("packages/rulecast/src", ".ts"))]
    const failures: string[] = []
    for (const file of files) {
      for (const target of repositoryPaths(await readFile(file, "utf8"))) {
        if (!existsSync(path.join(repoRoot, target))) failures.push(`${path.relative(repoRoot, file)} → ${target}`)
      }
    }
    expect(failures).toEqual([])
  })
})
```

The `src/` scan also covers the drafting prompt that plan 4b adds: `src/init/draft-prompt.ts` writes the URL out as one template literal, `https://raw.githubusercontent.com/syv-ai/rulecast/${tag}/agents/DRAFT-RULES.md`, whose `${tag}` ref segment the pattern accepts.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/agents-docs.test.ts`
Expected: FAIL. `exist` fails on `agents/SETUP.md`, and the two scans fail with ENOENT for `agents/`. `repositoryPaths finds raw and blob URLs` passes.

- [ ] **Step 3: Write `agents/SETUP.md`**

````markdown
# Set up rulecast in a project

Use this when the developer asks you to set up rulecast and has not run `rulecast init` themselves. rulecast delivers a project's conventions to coding agents while they work: rules in `.rulecast-config.yaml` pair a check with a message and a pointer to the doc section it enforces.

Relative links in this file resolve against this file's own URL.

## Steps

1. Work from the project's root directory: the git repository root, unless the developer names a subdirectory.
2. Run `init` with `--agent` set to your own adapter name, `claude-code` if you are Claude Code:

   ```sh
   npx @syv-ai/rulecast init --yes --agent claude-code
   ```

   `--agent` installs your hooks even when nothing in the project marks you yet (for Claude Code, a `.claude/` directory or a `CLAUDE.md`); without it, `--yes` installs hooks only for the agents it detects. `init` detects the project, selects the catalog rules that apply to its files, writes `.rulecast-config.yaml`, installs your hooks in your shared settings file, validates the result, and prints every file it created or changed, followed by a drafting prompt.
3. If it fails with `unknown agent`, rulecast has no adapter for you yet (the message lists the ones it has). Run `npx @syv-ai/rulecast init --yes` without `--agent`, and tell the developer that rulecast cannot deliver rules to you yet. If it exits non-zero for any other reason, show the developer its output and stop.
4. Show the developer `.rulecast-config.yaml` and the other files `init` listed. Name the selected rules and say that any of them can be removed from the config.
5. Ask whether to draft rules for the project's own conventions. If yes, follow [DRAFT-RULES.md](DRAFT-RULES.md), using the doc named in the drafting prompt `init` printed.

## Never

- Never edit agent hook settings (such as `.claude/settings.json`) by hand: `rulecast install` and `rulecast uninstall` manage them.
- Never commit. The developer reviews and commits the changes.
````

- [ ] **Step 4: Write `agents/DRAFT-RULES.md`**

````markdown
# Draft rulecast rules from a project's docs

Use this when asked to draft rulecast rules for a project from a document, usually `AGENTS.md` or `CLAUDE.md`. Every convention in the doc that code can visibly break becomes a rule that catches the break and points back at the doc. The developer decides which rules stay.

Load these when you need them. Relative links resolve against this file's own URL.

- [reference/rule-format.md](reference/rule-format.md): config and rule keys.
- [reference/detectors.md](reference/detectors.md): the detectors this rulecast version has, their config and template variables.

Commands below say `rulecast`. If it is not on the PATH, use `npx @syv-ai/rulecast`.

## 1. Read

1. Read the doc you were pointed at in full.
2. Read `.rulecast-config.yaml`. If it is missing, stop and ask the developer to run `npx @syv-ai/rulecast init`. Note the rules already configured, so you don't draft duplicates.
3. For each convention, read a few of the files it talks about, so your file and code patterns match the code as it is.

## 2. Sort the conventions

- **Checkable**: a break is visible in one file's path or text. "Never edit `src/client/`", "services never raise `HTTPException`", "no `print(` in the backend".
- **Guidance**: true and useful, but not visible as a pattern. "Keep services small", "test RBAC both ways".
- **Not about code**: commands, deployment, process. Skip these.

For checkable conventions, prefer `path` (the file itself is the break), then `regex`. Write the narrowest pattern that catches the break: a noisy rule gets ignored.

## 3. Draft one rule at a time

For each checkable convention:

1. Show the developer the rule as YAML and the doc section it enforces.
2. Add it to the `rules` of the `repo: local` entry in `.rulecast-config.yaml`. Add that entry at the end of `repos` if there is none:

   ```yaml
   - repo: local
     rules:
       - id: backend/no-print
         name: Backend code logs instead of printing
         files: ^backend/.*\.py$
         exclude: ^backend/tests/
         detect:
           regex:
             pattern: '^\s*print\('
             flags: m
         message: "{{file}}:{{line}} prints. Use the logger instead."
         context:
           - "@AGENTS.md#logging"
   ```

   - `id`: lowercase `area/name`, unique in the config.
   - `files`: a regex searched in the repo-relative path. Anchor it with `^` so it matches the directory you mean.
   - `message`: what is wrong at `{{file}}:{{line}}` and what to do instead, in one or two sentences.
   - `context`: the doc section the rule enforces, as `@<file>#<heading-slug>`. The slug is the heading in lowercase, punctuation dropped, spaces turned into `-`.
3. Run `rulecast validate` and fix every diagnostic for your rule.
4. Run `rulecast run <id> --all-files --format json`. Tell the developer how many findings it reports and show up to three as `file:line` with the line's text. Many findings mean the code does not follow the convention today: say so. Existing violations never block an agent; only new ones do.
5. Ask the developer to keep, edit or drop the rule. After an edit, repeat steps 3 and 4. Remove dropped rules from the config.

For each guidance convention, add a touch rule. It delivers the section the first time an agent reads or edits a matching file, and has no detector or message:

```yaml
- id: backend/services
  name: Service layer conventions
  files: ^backend/app/services/
  stages: [touch]
  context:
    - "@AGENTS.md#services"
```

Validate it the same way. `rulecast run` reports no findings for touch rules, so skip step 4.

## 4. Finish

Run `rulecast validate` a last time. Then summarise: the rules kept (id and one line each), the rules dropped, and the conventions you skipped, with the reason.

## Never

- Never change rules or overrides under other `repos` entries; only the `repo: local` entry.
- Never change code to make a rule pass. Report findings; the developer decides.
- Never commit.
````

- [ ] **Step 5: Write `agents/reference/rule-format.md`**

````markdown
# rulecast rule format

Rules and settings live in `.rulecast-config.yaml` at the project root. Keys are snake_case. `rulecast validate` checks the file.

Relative links in this file resolve against this file's own URL.

```yaml
exclude: ^vendor/
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.2.0
    rules:
      - id: python/no-httpexception-in-services
        files: ^app/services/
        context: ["@AGENTS.md#errors"]
  - repo: local
    rules:
      - id: api/no-client-in-components
        name: Components never call the API client
        files: ^frontend/src/components/
        types: [tsx]
        exclude: \.test\.tsx$
        detect:
          regex:
            pattern: 'from "@/client"'
        message: "{{file}}:{{line}} imports the API client. Use the feature's query hook."
        context:
          - "@docs/api-access.md#frontend-data-flow"
```

## Top-level keys

| Key | Default | Meaning |
|---|---|---|
| `repos` | required | Repo entries (below) |
| `minimum_rulecast_version` | none | `X.Y.Z`: older rulecast versions reject the config |
| `files` | `""` | Regex every rule's files must also match |
| `exclude` | `^$` | Regex no rule's files may match |
| `default_stages` | none | Stages for rules without `stages` |
| `context.mode` | `inject` | Default reference mode: `inject` or `read` |
| `context.max_bytes` | `32768` | A larger reference is delivered as `read` |
| `max_matches_per_rule` | `10` | Findings shown per rule |
| `timeouts.edit_deadline_ms` | `350` | Detection deadline after an edit |
| `timeouts.verify_ms` | `60000` | Detection timeout when an agent stops and in `rulecast run` |
| `stop_gate.max_blocks` | `1` | Stops blocked per agent per user prompt |
| `llm.provider`, `llm.model`, `llm.base_url`, `llm.api_key_env`, `llm.max_files_per_verify` | `anthropic`, `claude-haiku-4-5-20251001`, `null`, `ANTHROPIC_API_KEY`, `10` | Settings for the `llm` detector (not available yet) |

## Repo entries

- `repo`: a git URL, or `local` for rules written in this file.
- `rev`: required for a URL, not allowed for `local`. A tag or a full commit SHA; `rulecast autoupdate` moves it to the latest tag.
- `rules`: for a URL, entries that select rules from the repo's `.rulecast-rules.yaml` by `id` and may override any other key. For `local`, complete rules.

## Rule keys

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | `[a-z0-9-]+(/[a-z0-9-]+)*`, unique within its repo |
| `alias` | no | A second name, unique across the config, so one repo rule can be selected twice with different overrides. Findings use it |
| `name` | for `local` and published rules | Short title |
| `description` | no | Longer text, shown by `rulecast init` |
| `files` | no, default `""` | Regex searched in the repo-relative path (forward slashes, not anchored: add `^` and `$` yourself) |
| `exclude` | no, default `^$` | Regex: matching files are skipped |
| `types` | no, default `[file]` | The file has every one of these type tags |
| `types_or` | no | The file has at least one of these |
| `exclude_types` | no | The file has none of these |
| `stages` | no | Subset of `touch`, `edit`, `verify` (below) |
| `severity` | no, default `error` | `error` blocks the agent's stop and fails `rulecast run`; `warning` is delivered and never blocks |
| `detect` | unless `stages: [touch]` | One detector, `{ <kind>: <config> }`: see [detectors.md](detectors.md) |
| `message` | with `detect` | Template with `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}`, `{{rule}}` and the detector's captures |
| `context` | for touch rules | References delivered with the rule (below) |
| `minimum_rulecast_version` | no | `X.Y.Z`, for rules published in rule repos |

A rule applies to a file when the top-level `files` and `exclude`, the rule's `files` and `exclude`, and its type keys all match.

### File types

`file` (every file), `text` (every extension below), `python` (`.py`, `.pyi`), `pyi`, `ts` (`.ts`, `.mts`, `.cts`), `tsx`, `javascript` (`.js`, `.mjs`, `.cjs`), `jsx`, `markdown` (`.md`), `mdx`, `yaml` (`.yaml`, `.yml`), `json`, `toml`, `css`, `scss`, `html`, `shell` (`.sh`), `sql`, `go`, `rust` (`.rs`), `plain-text` (`.txt`). `ts` does not include `tsx`: write `types_or: [ts, tsx]`. An unknown tag is a `rulecast validate` error.

### Stages

- `touch`: the first time an agent reads or edits a matching file in its context, the rule's `context` is delivered, without a message.
- `edit`: the detector runs on each file the agent edits.
- `verify`: the detector runs when the agent stops, on the files it changed, and in `rulecast run`.

Defaults, in order: the rule's `stages`, then `default_stages`, then `[touch]` for rules without `detect` or the detector's own defaults. A rule without `detect` needs `stages: [touch]` and `context`. A rule with `detect` needs `edit` or `verify` among its stages.

### Overrides

An entry under a URL repo is merged over the published rule key by key. The merge is shallow: an overridden `detect` or `context` replaces the whole value. `@` paths in an overriding `context` resolve against your project; the published rule's own paths resolve against the rule repo.

## Context references

```yaml
context:
  - "@AGENTS.md"                       # the whole file
  - "@AGENTS.md#frontend-data-flow"    # one section
  - path: "@docs/state.md"
    mode: read                         # tell the agent to read it instead
```

- **Path**: `@` plus a path relative to the project root, or to the rule repo's root for rules published there. Any text file. A path may not leave its root.
- **Anchor**: `.md` and `.mdx` only. The GitHub heading slug: lowercase, punctuation dropped, spaces turned into `-`; repeated headings get `-1`, `-2`. The section runs from its heading to the next heading of the same or a higher level, subsections included.
- **Mode**: `inject` delivers the content; `read` tells the agent to read the file. The default is `context.mode`.

rulecast dedupes references: content the agent already has in its context is not delivered again.
````

- [ ] **Step 6: Write `agents/reference/detectors.md`**

````markdown
# rulecast detectors

A rule's `detect` names one detector and its config. The message template of every match can use `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}` (the matched text) and `{{rule}}`, plus the detector's captures. Any other variable is a `rulecast validate` error.

## `regex`

```yaml
detect:
  regex:
    pattern: 'raise HTTPException\((?<args>[^)]*)\)'
    flags: m
```

- `pattern`: a JavaScript regular expression, searched in the whole file. Quote it with single quotes in YAML so backslashes stay as written.
- `flags`: any of `d`, `i`, `m`, `s`, `u`, `v`, `y`; default none. `g` is always added. Use `m` for `^` and `$` at each line, `s` for `.` across lines.
- Captures: the pattern's named groups. `(?<args>…)` gives `{{args}}`, an empty string when the group did not take part in the match.
- Position: the line and column where the match starts. A match that spans lines counts as new when any of its lines changed.
- Default stages: `edit`, `verify`.

## `path`

```yaml
detect:
  path: {}
```

- Every file the rule selects is a match at line 1, so the rule's `files` is the whole check. Use it for files that must not be edited at all, such as generated code.
- Captures: none. `{{text}}` is the file path.
- Default stages: `edit`, `verify`.

## Coming later

`ast-grep` (structural patterns), `command` (your own script), `linter` (ruff, oxlint, eslint) and `llm` (a model's judgement) are designed but not in this version: `rulecast validate` reports `unknown detector` for them. Until then, write the convention as a `regex` rule when a text pattern catches it well, or as a `stages: [touch]` rule that delivers the section.
````

- [ ] **Step 7: Record `--agent` in the spec's agent docs table**

In `docs/specs/2026-09-15-rulecast-design.md` §12 (Agent docs), replace:
```markdown
| `agents/SETUP.md` | For agents asked to set rulecast up without the developer running `init`: run `npx @syv-ai/rulecast init --yes`, show the developer the resulting config, continue with `DRAFT-RULES.md` |
```
with:
```markdown
| `agents/SETUP.md` | For agents asked to set rulecast up without the developer running `init`: run `npx @syv-ai/rulecast init --yes --agent <its own adapter>` (so its hooks are installed even when nothing in the project marks it yet), show the developer the resulting config, continue with `DRAFT-RULES.md` |
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run test/agents-docs.test.ts`
Expected: PASS (4 tests). The link scan checks at least the four links in `SETUP.md`, `DRAFT-RULES.md` and `rule-format.md`.

- [ ] **Step 9: Run everything**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit and push**

```bash
git add agents/SETUP.md agents/DRAFT-RULES.md agents/reference/rule-format.md agents/reference/detectors.md packages/rulecast/test/agents-docs.test.ts docs/specs/2026-09-15-rulecast-design.md
git commit -m "docs: add agent docs for setup and rule drafting

Claude goes brr.. via Dash"
git fetch
git push origin main
```

Plan 4a is done. Continue with `2026-09-19-rulecast-04b-init.md`.

## End-to-end check

From the repository root:

1. `pnpm manifest --check` exits 0.
2. `pnpm vitest run test/catalog.test.ts test/agents-docs.test.ts test/scripts/manifest.test.ts` passes.
3. In a scratch git repository (not a real project), with a `.rulecast-config.yaml` whose `repos` entry is `{ repo: <path to this repository>, rev: <a commit SHA of HEAD>, rules: [{ id: python/no-httpexception-in-services }] }` and a file `app/services/users.py` containing `raise HTTPException(404)`, `node <repo>/packages/rulecast/dist/cli.js run --all-files --format agent` (after `pnpm build`) exits 1. It reports the finding and delivers the `errors.md` section, labelled `<repository directory name>@<sha>:packages/rules-python/errors.md#services-raise-domain-exceptions`.
