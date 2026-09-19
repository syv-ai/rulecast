# rulecast Plan 4b — Interactive rulecast init Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim `rulecast init` with the interactive setup of spec §12: detect the project, choose catalog rules, point them at the project's own docs, choose agents and scopes, review, write, validate, and hand the developer a drafting prompt.

**Architecture:** Five small units under `src/init/` do the work and never touch the terminal: `detect.ts` (stack, docs with headings, agents), `config-text.ts` (adds catalog rules to `.rulecast-config.yaml` by text insertion, so comments and formatting survive), `plan.ts` (selections → every file change with its full new content), `clipboard.ts` and `draft-prompt.ts`. `prompts.ts` defines the `Prompter` interface; `clack.ts` implements it on `@clack/prompts` and is loaded with a dynamic import, so hooks never pay for it. `commands/init.ts` orchestrates: flags or prompts decide each choice, the plan is reviewed, then written, validated and followed by the drafting prompt. Spec: `docs/specs/2026-09-15-rulecast-design.md` §4 (rule repos), §12 (`rulecast init`, agent docs); design record `docs/specs/2026-09-16-rulecast-interactive-init-design.md`.

**Tech Stack:** Node ≥ 20.12, TypeScript 5, `@clack/prompts` 1.8, `yaml` 2 (CST ranges), vitest.

Prerequisite: plan 3 (`2026-09-19-rulecast-03a…03e`) and `2026-09-19-rulecast-04a-catalog-docs.md` are done: the config format, rule repos, `install`, `validate`, the catalog packages, the generated root `.rulecast-rules.yaml` and `agents/DRAFT-RULES.md` exist. This part completes plan 4.

---

## Decisions this plan implements

1. **`--yes` means no prompts.** Every choice without a flag takes its detected default and the Review and clipboard questions are skipped, in a terminal too. `agents/SETUP.md` (plan 4a) tells agents to run `init --yes --agent <their adapter>`, so an agent setting a project up always installs its own hooks even when no marker (`.claude/`, `CLAUDE.md`) detects it; a person typing `--yes` expects the same no-prompt result.
2. **Prompts load on demand.** `CliIo.prompter()` returns a `Promise<Prompter>`; `src/cli.ts` imports `init/clack.ts` dynamically. tsup splits it into its own chunk (verified), so `rulecast hook` never loads `@clack/prompts`.
3. **Config updates are text insertions.** `yaml`'s `Document.toString()` keeps comments but rewrites other formatting (`[touch]` becomes `[ touch ]`, comment spacing collapses; verified). `config-text.ts` inserts block-style entries at CST offsets instead and changes nothing else; a non-empty flow list it cannot extend is a `ConfigTextError` telling the developer to use block style.
4. **init writes what Review showed.** `plan.ts` computes each file's full new content, the Claude Code settings through the adapter's own `install.merge`, so the files init writes are the ones Review listed and match what `rulecast install` writes. Validation compiles with `fetchingRepos`, which fetches any other rule repo in the config. Nothing else runs `install`.
5. **Project root.** The configured project when there is one, else the enclosing git repository's top level, else the current directory.
6. **Docs.** Markdown inside dot-directories (`.claude/commands/*.md`, `.github/*.md`) is agent or tool configuration, not conventions, and is not offered.
7. **Disabled options.** `@clack/prompts` 1.8 supports `disabled` options: installed rules are shown with the hint `installed`, detected agents without an adapter with `not supported yet`.
8. **Exit codes.** Declining Review exits 0 with nothing written. Ctrl+C at any prompt exits 130. Files are written only after Review, so cancelling the final clipboard question leaves them in place. Validation errors after writing exit 2.
9. **Node ≥ 20.12**, because `@clack/prompts` 1.8 declares it.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/` (e.g. `pnpm vitest run test/init/detect.test.ts`). Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout: other sessions work in this repository. Check that `git commit` exited 0; don't filter its output.
- Commit messages end with a blank line and `Claude goes brr.. via Dash`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths in **Files:** lists are under `packages/rulecast/`; `git add` paths are from the repository root.

| File | Responsibility |
|---|---|
| `src/init/detect.ts` | Stack, docs (with headings) and agents; the one-line summary; heading choices |
| `src/init/config-text.ts` | New config text; adding catalog rules to existing config text |
| `src/init/clipboard.ts` | Finds a clipboard command on `PATH` and pipes text into it |
| `src/init/draft-prompt.ts` | The drafting prompt |
| `src/init/prompts.ts` | `Prompter` interface, `Choice`, `Cancelled` (no dependencies) |
| `src/init/clack.ts` | `Prompter` on `@clack/prompts` (loaded on demand) |
| `src/init/plan.ts` | Selections → planned file changes; Review text |
| `src/commands/init.ts` | Orchestration, flags, catalog, output |
| `src/commands/main.ts`, `src/cli.ts` | `CliIo` gains `interactive`, `prompter(): Promise<Prompter>`, `copyToClipboard()`; `init` dispatch becomes `initCommand(args, registry, io)`; usage line |
| `test/helpers/cli.ts` | Captures the new `CliIo` members |
| `test/commands/help.test.ts`, `test/build.test.ts` | Pinned usage line; `init --yes` through the built CLI |
| `package.json` (package), repository root `docs/specs/2026-09-15-rulecast-design.md` §16, `docs/plans/2026-09-15-rulecast-00-index.md` | `@clack/prompts`, Node ≥ 20.12; plan 4 marked done |
| `test/helpers/prompter.ts` | Scripted `Prompter` for tests |
| `test/helpers/catalog.ts` | A bare "rulecast repository" built from this repository's catalog |

## Not in this plan

- Catalogs other than the rulecast repository; other adapters (spec §17, 0.2).
- Publishing the repository, which the raw GitHub link in the drafting prompt needs (a release prerequisite; the user decides when). Tests check the linked file exists in the repository instead.

---

### Task 3: Detect the project

**Files:**
- Create: `src/init/detect.ts`
- Test: `test/init/detect.test.ts`

- [ ] **Step 1: Write the failing test**

`test/init/detect.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { ADAPTERS } from "../../src/adapters"
import { readSourceFile } from "../../src/core/detection/per-rule"
import { type Detection, detectionSummary, detectProject, docChoices, markerExists } from "../../src/init/detect"
import { createProject } from "../helpers/project"

/** Detects a project written from `files`; `dirs` (with a trailing "/") are created empty. */
async function detect(files: Record<string, string>, dirs: string[] = []): Promise<Detection> {
  const root = await createProject({ ...files, ...Object.fromEntries(dirs.map((dir) => [`${dir}.keep`, ""])) })
  return detectProject({
    files: Object.keys(files).sort(),
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })
}

const docFiles = (detection: Detection) => detection.docs.map((doc) => [doc.file, doc.importedBy])

describe("detectProject: docs", () => {
  test("AGENTS.md only", async () => {
    const detection = await detect({ "AGENTS.md": "# Agents\n\n## Errors\n" })
    expect(docFiles(detection)).toEqual([["AGENTS.md", null]])
    expect(detection.primaryDoc).toBe("AGENTS.md")
    expect(detection.docs[0]!.headings.map((heading) => heading.slug)).toEqual(["agents", "errors"])
  })

  test("a CLAUDE.md that imports AGENTS.md is the same document", async () => {
    const detection = await detect({ "AGENTS.md": "# Agents\n", "CLAUDE.md": "# Claude\n\n@AGENTS.md\n" })
    expect(docFiles(detection)).toEqual([["AGENTS.md", "CLAUDE.md"]])
    expect(detection.primaryDoc).toBe("AGENTS.md")
  })

  test("a CLAUDE.md without the import is a doc of its own", async () => {
    const detection = await detect({ "CLAUDE.md": "# Claude\n\n## Rules\n" })
    expect(docFiles(detection)).toEqual([["CLAUDE.md", null]])
    expect(detection.primaryDoc).toBe("CLAUDE.md")
  })

  test("other markdown docs, without READMEs, changelogs, licences, node_modules or dot-directories", async () => {
    const detection = await detect({
      "README.md": "# Readme\n",
      "CHANGELOG.md": "# Changes\n",
      "LICENSE.md": "MIT\n",
      "docs/api.md": "# API\n",
      "docs/README.md": "# Docs readme\n",
      "ways-of-working/backend.md": "# Backend\n",
      "node_modules/pkg/guide.md": "# Guide\n",
      ".claude/commands/review.md": "# Review\n",
    })
    expect(docFiles(detection)).toEqual([
      ["docs/api.md", null],
      ["ways-of-working/backend.md", null],
    ])
    expect(detection.primaryDoc).toBeNull()
  })

  test("nested AGENTS.md files come after the root one, then standalone CLAUDE.md files", async () => {
    const detection = await detect({
      "backend/AGENTS.md": "# Backend\n",
      "backend/CLAUDE.md": "@./AGENTS.md\n",
      "AGENTS.md": "# Root\n",
      "frontend/CLAUDE.md": "# Frontend\n",
      "docs/guide.md": "# Guide\n",
    })
    expect(docFiles(detection)).toEqual([
      ["AGENTS.md", null],
      ["backend/AGENTS.md", "backend/CLAUDE.md"],
      ["frontend/CLAUDE.md", null],
      ["docs/guide.md", null],
    ])
    expect(detection.primaryDoc).toBe("AGENTS.md")
  })
})

describe("detectProject: stack and agents", () => {
  test("python from sources or pyproject.toml; typescript and react from package.json", async () => {
    expect((await detect({ "pyproject.toml": "[project]\n" })).stack).toEqual(["python"])
    const web = await detect({
      "frontend/package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "frontend/src/App.tsx": "export {}\n",
      "node_modules/x/index.js": "",
    })
    expect(web.stack).toEqual(["typescript", "react"])
  })

  test("agents with an adapter and known agents without one", async () => {
    const detection = await detect({ "app.py": "" }, [".claude/", ".cursor/"])
    expect(detection.agents.map((agent) => [agent.name, agent.marker, agent.adapter?.name ?? null])).toEqual([
      ["claude-code", ".claude/", "claude-code"],
      ["cursor", ".cursor/", null],
    ])
    expect((await detect({ "CLAUDE.md": "# Claude\n" })).agents.map((agent) => agent.marker)).toEqual(["CLAUDE.md"])
    expect((await detect({ "app.py": "" })).agents).toEqual([])
  })
})

describe("detectionSummary and docChoices", () => {
  test("summarises stack, agent docs, other docs and agents", async () => {
    const detection = await detect(
      { "AGENTS.md": "# A\n", "CLAUDE.md": "@AGENTS.md\n", "docs/a.md": "# A\n", "app.py": "" },
      [".claude/", ".codex/"],
    )
    expect(detectionSummary(detection)).toBe(
      "python · AGENTS.md (imported by CLAUDE.md) · 1 other doc · Claude Code (.claude/) · Codex (.codex/, not supported yet)",
    )
  })

  test("lists the whole file and every heading as a breadcrumb", async () => {
    const detection = await detect({ "AGENTS.md": "# Backend\n\n## Errors\n\n### HTTP\n\n## Services\n\n# !!!\n" })
    expect(docChoices(detection.docs[0]!)).toEqual([
      { value: "@AGENTS.md", label: "AGENTS.md" },
      { value: "@AGENTS.md#backend", label: "AGENTS.md › Backend" },
      { value: "@AGENTS.md#errors", label: "AGENTS.md › Backend › Errors" },
      { value: "@AGENTS.md#http", label: "AGENTS.md › Backend › Errors › HTTP" },
      { value: "@AGENTS.md#services", label: "AGENTS.md › Backend › Services" },
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/init/detect.test.ts`
Expected: FAIL: cannot find module `../../src/init/detect`.

- [ ] **Step 3: Implement**

`src/init/detect.ts`:
```ts
import { statSync } from "node:fs"
import path from "node:path"

import { type Heading, scanHeadings } from "../core/anchors"
import { tagsOf } from "../core/files"
import type { Adapter } from "../core/types"

export interface DetectedDoc {
  /** Repo-relative, forward slashes. */
  file: string
  headings: Heading[]
  /** The CLAUDE.md that imports this AGENTS.md: the two are one document. */
  importedBy: string | null
}

export interface DetectedAgent {
  name: string
  label: string
  /** null: rulecast has no adapter for this agent yet. */
  adapter: Adapter | null
  /** The marker that was found. */
  marker: string
}

export interface Detection {
  /** Summary labels: "python", "typescript", "javascript", "react". */
  stack: string[]
  /** AGENTS.md files (root first), standalone CLAUDE.md files, then other markdown. */
  docs: DetectedDoc[]
  /** The doc the drafting prompt names: the first AGENTS.md, else the first standalone CLAUDE.md, else null. */
  primaryDoc: string | null
  agents: DetectedAgent[]
}

export interface DetectInput {
  /** Every project file (git ls-files --cached --others --exclude-standard). */
  files: readonly string[]
  /** Reads a repo-relative file; null when missing. */
  read(file: string): Promise<string | null>
  /** Whether a marker exists; a trailing "/" asks for a directory. */
  exists(marker: string): boolean
  adapters: readonly Adapter[]
}

/** Agents rulecast recognises but has no adapter for yet; init lists them as "not supported yet". */
export const KNOWN_AGENTS: readonly { name: string; label: string; markers: string[] }[] = [
  { name: "cursor", label: "Cursor", markers: [".cursor/"] },
  { name: "codex", label: "Codex", markers: [".codex/"] },
]

/** Claude Code's import line for a sibling AGENTS.md. */
const IMPORTS_AGENTS = /^[ \t]*@(\.\/)?AGENTS\.md[ \t]*$/m
const NOT_A_DOC = /^(readme|changelog|license)/i
const AGENT_DOCS = new Set(["AGENTS.md", "CLAUDE.md"])

const basename = (file: string) => path.posix.basename(file)
const segments = (file: string) => file.split("/")
const inNodeModules = (file: string) => segments(file).includes("node_modules")
/** Inside a dot-directory such as .claude/ or .github/: agent and tool configuration, not conventions. */
const inDotDir = (file: string) =>
  segments(file)
    .slice(0, -1)
    .some((segment) => segment.startsWith("."))
/** Root files first, then by path in code-point order. */
const byDepth = (a: string, b: string) => segments(a).length - segments(b).length || (a < b ? -1 : a > b ? 1 : 0)

function usesReact(text: string | null): boolean {
  if (text === null) return false
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>
    return ["dependencies", "devDependencies", "peerDependencies"].some((key) => {
      const dependencies = manifest[key]
      return typeof dependencies === "object" && dependencies !== null && "react" in dependencies
    })
  } catch {
    return false
  }
}

async function detectStack(files: readonly string[], read: DetectInput["read"]): Promise<string[]> {
  const tags = new Set<string>()
  const names = new Set<string>()
  for (const file of files) {
    for (const tag of tagsOf(file)) tags.add(tag)
    names.add(basename(file))
  }
  const stack: string[] = []
  const pythonMarker = names.has("pyproject.toml") || [...names].some((name) => /^requirements.*\.txt$/.test(name))
  if (tags.has("python") || pythonMarker) stack.push("python")
  if (tags.has("ts") || tags.has("tsx")) stack.push("typescript")
  if (tags.has("javascript") || tags.has("jsx")) stack.push("javascript")
  for (const file of files.filter((candidate) => basename(candidate) === "package.json")) {
    if (usesReact(await read(file))) {
      stack.push("react")
      break
    }
  }
  return stack
}

async function detectDocs(files: readonly string[], read: DetectInput["read"]): Promise<DetectedDoc[]> {
  const present = new Set(files)
  const named = (name: string) => files.filter((file) => basename(file) === name).sort(byDepth)
  const importedBy = new Map<string, string>()
  const standalone: string[] = []
  for (const file of named("CLAUDE.md")) {
    const sibling = path.posix.join(path.posix.dirname(file), "AGENTS.md")
    const text = await read(file)
    if (text !== null && present.has(sibling) && IMPORTS_AGENTS.test(text)) importedBy.set(sibling, file)
    else standalone.push(file)
  }
  const others = files
    .filter((file) => {
      const tags = tagsOf(file)
      const name = basename(file)
      return (
        (tags.has("markdown") || tags.has("mdx")) && !AGENT_DOCS.has(name) && !NOT_A_DOC.test(name) && !inDotDir(file)
      )
    })
    .sort()

  const docs: DetectedDoc[] = []
  const add = async (file: string, by: string | null) => {
    const text = await read(file)
    if (text !== null) docs.push({ file, headings: scanHeadings(text), importedBy: by })
  }
  for (const file of named("AGENTS.md")) await add(file, importedBy.get(file) ?? null)
  for (const file of standalone) await add(file, null)
  for (const file of others) await add(file, null)
  return docs
}

function detectAgents(input: DetectInput): DetectedAgent[] {
  const agents: DetectedAgent[] = []
  for (const adapter of input.adapters) {
    const marker = adapter.install?.markers.find((candidate) => input.exists(candidate))
    if (marker !== undefined) agents.push({ name: adapter.name, label: adapter.label, adapter, marker })
  }
  for (const known of KNOWN_AGENTS) {
    const marker = known.markers.find((candidate) => input.exists(candidate))
    if (marker !== undefined) agents.push({ name: known.name, label: known.label, adapter: null, marker })
  }
  return agents
}

/** `DetectInput.exists` for a project on disk. */
export function markerExists(root: string): (marker: string) => boolean {
  return (marker) => {
    try {
      const stat = statSync(path.join(root, marker))
      return !marker.endsWith("/") || stat.isDirectory()
    } catch {
      return false
    }
  }
}

/** Detects the stack, the convention docs and the coding agents of a project. Every result is only a default. */
export async function detectProject(input: DetectInput): Promise<Detection> {
  const files = input.files.filter((file) => !inNodeModules(file))
  const docs = await detectDocs(files, input.read)
  const primary =
    docs.find((doc) => basename(doc.file) === "AGENTS.md") ?? docs.find((doc) => basename(doc.file) === "CLAUDE.md")
  return {
    stack: await detectStack(files, input.read),
    docs,
    primaryDoc: primary?.file ?? null,
    agents: detectAgents(input),
  }
}

/** One line for init's "Detected" step. */
export function detectionSummary(detection: Detection): string {
  const parts = [...detection.stack]
  for (const doc of detection.docs) {
    if (!AGENT_DOCS.has(basename(doc.file))) continue
    parts.push(doc.importedBy === null ? doc.file : `${doc.file} (imported by ${doc.importedBy})`)
  }
  const others = detection.docs.filter((doc) => !AGENT_DOCS.has(basename(doc.file))).length
  if (others > 0) parts.push(`${others} other ${others === 1 ? "doc" : "docs"}`)
  for (const agent of detection.agents) {
    parts.push(`${agent.label} (${agent.marker}${agent.adapter === null ? ", not supported yet" : ""})`)
  }
  return parts.length === 0 ? "nothing yet" : parts.join(" · ")
}

/** Reference choices for a doc: the whole file, then every heading as "file › heading › subheading". */
export function docChoices(doc: DetectedDoc): { value: string; label: string }[] {
  const choices = [{ value: `@${doc.file}`, label: doc.file }]
  const trail: Heading[] = []
  for (const heading of doc.headings) {
    while (trail.length > 0 && trail.at(-1)!.level >= heading.level) trail.pop()
    trail.push(heading)
    // A heading without letters or digits has no slug to point at.
    if (heading.slug === "") continue
    choices.push({
      value: `@${doc.file}#${heading.slug}`,
      label: [doc.file, ...trail.map((entry) => entry.text)].join(" › "),
    })
  }
  return choices
}
```

`Heading` and `scanHeadings` are the anchor scanner from `src/core/anchors.ts`, so the headings offered are exactly the anchors compile accepts. `Adapter.label` and `Adapter.install.markers` come from plan 3 Task 13.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/init/detect.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/init/detect.ts packages/rulecast/test/init/detect.test.ts
git commit -m "feat: detect a project's stack, convention docs and agents for init

Claude goes brr.. via Dash"
```

---

### Task 4: Add catalog rules to config text

**Files:**
- Create: `src/init/config-text.ts`
- Test: `test/init/config-text.test.ts`

- [ ] **Step 1: Write the failing test**

`test/init/config-text.test.ts`:
```ts
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { addCatalogRules, ConfigTextError, newConfigText, type RuleSelection } from "../../src/init/config-text"

const catalog = { url: "https://github.com/syv-ai/rulecast", rev: "v0.2.0" }
const rules: RuleSelection[] = [
  { id: "generated-code", context: null },
  { id: "python/layering", context: ["@AGENTS.md#services"] },
]

const NEW_RULES = [
  "      - id: generated-code",
  "      - id: python/layering",
  "        context:",
  '          - "@AGENTS.md#services"',
]

describe("newConfigText", () => {
  test("writes the catalog repo with the selected rules and an empty local repo", () => {
    expect(newConfigText(catalog, rules)).toBe(
      [
        "# rulecast config: https://github.com/syv-ai/rulecast",
        "# Rules from rule repos are pinned by rev; add your own rules under repo: local.",
        "repos:",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.2.0",
        "    rules:",
        ...NEW_RULES,
        "  - repo: local",
        "    rules: []",
        "",
      ].join("\n"),
    )
  })

  test("without catalog rules only the local repo is written", () => {
    const text = newConfigText(catalog, [])
    expect(parse(text)).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(newConfigText(null, [])).toBe(text)
  })
})

describe("addCatalogRules", () => {
  test("appends a catalog repo entry, keeping everything else byte for byte", () => {
    const text = "# my config\nrepos:\n  - repo: local   # mine\n    rules: []  # none\n"
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "# my config",
        "repos:",
        "  - repo: local   # mine",
        "    rules: []  # none",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.2.0",
        "    rules:",
        ...NEW_RULES,
        "",
      ].join("\n"),
    )
  })

  test("adds to the catalog entry's block list after its last rule", () => {
    const text = [
      "repos:",
      "  - repo: https://github.com/syv-ai/rulecast",
      "    rev: v0.2.0",
      "    rules:",
      "      - id: react/data-fetching # keep",
      "        files: ^web/",
      "      # trailing",
      "  - repo: local",
      "    rules:",
      "      - { id: mine, name: Mine, stages: [touch], context: ['@a.md'] }",
      "",
    ].join("\n")
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "repos:",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.2.0",
        "    rules:",
        "      - id: react/data-fetching # keep",
        "        files: ^web/",
        ...NEW_RULES,
        "      # trailing",
        "  - repo: local",
        "    rules:",
        "      - { id: mine, name: Mine, stages: [touch], context: ['@a.md'] }",
        "",
      ].join("\n"),
    )
  })

  test("replaces an empty flow list, keeping its comment", () => {
    const text =
      "repos:\n  - repo: https://github.com/syv-ai/rulecast\n    rev: v0.1.0  # pinned\n    rules: []  # nothing\n"
    expect(addCatalogRules(text, catalog, rules)).toBe(
      [
        "repos:",
        "  - repo: https://github.com/syv-ai/rulecast",
        "    rev: v0.1.0  # pinned",
        "    rules: # nothing",
        ...NEW_RULES,
        "",
      ].join("\n"),
    )
  })

  test("fills an empty repos list and handles a missing final newline", () => {
    expect(parse(addCatalogRules("repos: []", catalog, rules))).toEqual({
      repos: [
        {
          repo: catalog.url,
          rev: "v0.2.0",
          rules: [{ id: "generated-code" }, { id: "python/layering", context: ["@AGENTS.md#services"] }],
        },
      ],
    })
    const text = "repos:\n  - repo: local\n    rules: [] # c"
    expect(parse(addCatalogRules(text, catalog, rules)).repos).toHaveLength(2)
  })

  test("re-running only adds: listed rules are skipped and nothing new leaves the text unchanged", () => {
    const once = addCatalogRules(newConfigText(catalog, [rules[0]!]), catalog, rules)
    expect(parse(once).repos[0].rules.map((rule: { id: string }) => rule.id)).toEqual([
      "generated-code",
      "python/layering",
    ])
    expect(addCatalogRules(once, catalog, rules)).toBe(once)
    expect(addCatalogRules(once, catalog, [])).toBe(once)
  })

  test("refuses shapes it cannot extend without rewriting the file", () => {
    expect(() => addCatalogRules("repos: [{ repo: local, rules: [] }]\n", catalog, rules)).toThrow(ConfigTextError)
    expect(() => addCatalogRules("files: x\n", catalog, rules)).toThrow("the config has no repos list")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/init/config-text.test.ts`
Expected: FAIL: cannot find module `../../src/init/config-text`.

- [ ] **Step 3: Implement**

`src/init/config-text.ts`:
```ts
import { isMap, isScalar, isSeq, type Node, parseDocument, type YAMLMap, type YAMLSeq } from "yaml"

export interface CatalogRef {
  url: string
  rev: string
}

export interface RuleSelection {
  id: string
  /** null: keep the rule's own context; otherwise a `context` override. */
  context: string[] | null
}

export class ConfigTextError extends Error {}

const HEADER = [
  "# rulecast config: https://github.com/syv-ai/rulecast",
  "# Rules from rule repos are pinned by rev; add your own rules under repo: local.",
]

/** A plain YAML scalar when that is safe, a double-quoted one otherwise (e.g. a local path with spaces). */
const scalar = (value: string) => (/^[A-Za-z0-9_./:@~+-]+$/.test(value) ? value : JSON.stringify(value))

function ruleLines(rule: RuleSelection): string[] {
  const lines = [`- id: ${rule.id}`]
  if (rule.context !== null) lines.push("  context:", ...rule.context.map((ref) => `    - ${JSON.stringify(ref)}`))
  return lines
}

function repoLines(catalog: CatalogRef, rules: RuleSelection[]): string[] {
  return [
    `- repo: ${scalar(catalog.url)}`,
    `  rev: ${scalar(catalog.rev)}`,
    "  rules:",
    ...rules.flatMap(ruleLines).map((line) => `    ${line}`),
  ]
}

const indent = (lines: string[], column: number) => lines.map((line) => `${" ".repeat(column)}${line}\n`).join("")

/** The text of a new config: the catalog repo (when it has rules) and an empty local repo. */
export function newConfigText(catalog: CatalogRef | null, rules: RuleSelection[]): string {
  const lines = [...HEADER, "repos:"]
  if (catalog !== null && rules.length > 0) lines.push(...repoLines(catalog, rules).map((line) => `  ${line}`))
  lines.push("  - repo: local", "    rules: []")
  return `${lines.join("\n")}\n`
}

function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf("\n", offset - 1) + 1)
}

function lineEndAfter(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset)
  return newline === -1 ? text.length : newline + 1
}

interface Edit {
  start: number
  end: number
  insert: string
}

/** Inserts block-style items into a sequence: after its last item, or in place of an empty flow `[]`. */
function appendToSeq(text: string, seq: YAMLSeq, keyNode: Node, items: string[]): Edit {
  const [start, valueEnd] = seq.range!
  if (seq.flow) {
    const at = lineEndAfter(text, valueEnd)
    const rest = text.slice(valueEnd, at).trim()
    if (seq.items.length > 0 || (rest !== "" && !rest.startsWith("#"))) {
      throw new ConfigTextError("write repos and their rules in block style so rulecast init can add to them")
    }
    let from = start
    while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--
    const column = columnOf(text, keyNode.range![0]) + 2
    return { start: from, end: at, insert: `${rest === "" ? "" : ` ${rest}`}\n${indent(items, column)}` }
  }
  const column = columnOf(text, start)
  const prefix = valueEnd === 0 || text[valueEnd - 1] === "\n" ? "" : "\n"
  return { start: valueEnd, end: valueEnd, insert: `${prefix}${indent(items, column)}` }
}

function pairKey(map: YAMLMap, key: string): Node | null {
  const pair = map.items.find((item) => isScalar(item.key) && item.key.value === key)
  return pair && isScalar(pair.key) ? pair.key : null
}

/**
 * Adds catalog rules to an existing config, changing nothing else: new rules are appended to the catalog's
 * repo entry (rules already listed there are skipped), or a new entry for the catalog is appended to `repos`.
 */
export function addCatalogRules(text: string, catalog: CatalogRef, rules: RuleSelection[]): string {
  const doc = parseDocument(text, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new ConfigTextError(doc.errors[0]!.message)
  const root = doc.contents
  if (!isMap(root)) throw new ConfigTextError("the config must be a mapping")
  const reposKey = pairKey(root, "repos")
  const repos = root.get("repos", true)
  if (reposKey === null || !isSeq(repos)) throw new ConfigTextError("the config has no repos list")

  const entry = repos.items.find((item): item is YAMLMap => isMap(item) && item.get("repo") === catalog.url)
  let edit: Edit
  if (entry) {
    const listed = entry.get("rules", true)
    const rulesKey = pairKey(entry, "rules")
    if (!isSeq(listed) || rulesKey === null) throw new ConfigTextError(`${catalog.url} has no rules list`)
    const present = new Set(listed.items.map((item) => (isMap(item) ? item.get("id") : undefined)))
    const added = rules.filter((rule) => !present.has(rule.id))
    if (added.length === 0) return text
    edit = appendToSeq(text, listed, rulesKey, added.flatMap(ruleLines))
  } else {
    if (rules.length === 0) return text
    edit = appendToSeq(text, repos, reposKey, repoLines(catalog, rules))
  }
  const updated = text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
  const check = parseDocument(updated)
  if (check.errors.length > 0) throw new ConfigTextError(`could not update the config: ${check.errors[0]!.message}`)
  return updated
}
```

How the offsets work (checked against `yaml` 2 in a scratch script): a collection's `range` is `[start, valueEnd, nodeEnd]`. For a block list, `start` is its first `-` (which gives the item column) and `valueEnd` is just after its last item's final newline, so trailing comment lines stay after the inserted items. For an empty flow list, `range[0]..range[1]` is `[]`; the rest of that line is spaces and an optional comment, which is kept after the key.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/init/config-text.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/init/config-text.ts packages/rulecast/test/init/config-text.test.ts
git commit -m "feat: add catalog rules to a config without rewriting it

Claude goes brr.. via Dash"
```

---

### Task 5: Clipboard and drafting prompt

**Files:**
- Create: `src/init/clipboard.ts`, `src/init/draft-prompt.ts`
- Test: `test/init/clipboard.test.ts`, `test/init/draft-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/init/clipboard.test.ts`:
```ts
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { clipboardCommand, copyWith, findOnPath } from "../../src/init/clipboard"
import { createProject } from "../helpers/project"

/** A directory of fake commands: each writes its stdin to <name>.out next to itself. */
async function fakeBin(names: string[]): Promise<string> {
  const bin = path.join(await createProject({}), "bin")
  await mkdir(bin)
  for (const name of names) {
    const file = path.join(bin, name)
    await writeFile(file, `#!/bin/sh\ncat > "${file}.out"\n`)
    await chmod(file, 0o755)
  }
  return bin
}

describe("clipboardCommand", () => {
  test("takes the first of pbcopy, wl-copy, xclip and clip.exe found on PATH", async () => {
    const bin = await fakeBin(["xclip", "clip.exe"])
    expect(clipboardCommand({ PATH: [path.join(bin, "missing"), bin].join(path.delimiter) })).toEqual({
      command: path.join(bin, "xclip"),
      args: ["-selection", "clipboard"],
    })
    const all = await fakeBin(["clip.exe", "wl-copy", "pbcopy"])
    expect(clipboardCommand({ PATH: all })?.command).toBe(path.join(all, "pbcopy"))
  })

  test("skips files that are not executable and gives null when nothing is found", async () => {
    const bin = await fakeBin([])
    await writeFile(path.join(bin, "pbcopy"), "not a program")
    expect(findOnPath("pbcopy", { PATH: bin })).toBeNull()
    expect(clipboardCommand({ PATH: bin })).toBeNull()
    expect(clipboardCommand({})).toBeNull()
  })
})

describe("copyWith", () => {
  test("pipes the text into the command", async () => {
    const bin = await fakeBin(["pbcopy"])
    expect(await copyWith({ command: path.join(bin, "pbcopy"), args: [] }, "Read this\n")).toBe(true)
    expect(await readFile(path.join(bin, "pbcopy.out"), "utf8")).toBe("Read this\n")
  })

  test("reports a command that cannot start", async () => {
    expect(await copyWith({ command: "/no/such/clipboard", args: [] }, "x")).toBe(false)
  })
})
```

`test/init/draft-prompt.test.ts`:
```ts
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import { draftPrompt } from "../../src/init/draft-prompt"

test("names the detected doc and the catalog tag", () => {
  expect(draftPrompt("v0.2.0", "AGENTS.md")).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md\n" +
      "and follow it to draft rulecast rules for this project from AGENTS.md.",
  )
  expect(draftPrompt("v0.2.0", "CLAUDE.md")).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md\n" +
      "and follow it to draft rulecast rules for this project from CLAUDE.md.",
  )
  expect(draftPrompt("v0.0.0", null)).toBe(
    "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.0.0/agents/DRAFT-RULES.md\n" +
      "and follow it to draft rulecast rules for this project from the project's docs.",
  )
})

test("the linked procedure exists in this repository", () => {
  const url = /https:\/\/raw\.githubusercontent\.com\/syv-ai\/rulecast\/v1\.2\.3\/(\S+)/.exec(draftPrompt("v1.2.3", null))
  expect(url?.[1]).toBe("agents/DRAFT-RULES.md")
  // test/init → test → packages/rulecast → packages → repository root
  expect(existsSync(fileURLToPath(new URL(`../../../../${url?.[1]}`, import.meta.url)))).toBe(true)
})
```

`test/agents-docs.test.ts` (plan 4a) also finds this URL in `src/init/draft-prompt.ts` and checks the file exists.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run test/init/clipboard.test.ts test/init/draft-prompt.test.ts`
Expected: FAIL: cannot find modules `../../src/init/clipboard` and `../../src/init/draft-prompt`.

- [ ] **Step 3: Implement**

`src/init/clipboard.ts`:
```ts
import { spawn } from "node:child_process"
import { accessSync, constants, statSync } from "node:fs"
import path from "node:path"

import type { Env } from "../core/home"

export interface ClipboardCommand {
  command: string
  args: string[]
}

/** In the spec's order: macOS, Wayland, X11, then Windows and WSL. */
const CANDIDATES: readonly ClipboardCommand[] = [
  { command: "pbcopy", args: [] },
  { command: "wl-copy", args: [] },
  { command: "xclip", args: ["-selection", "clipboard"] },
  { command: "clip.exe", args: [] },
]

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Full path of the first executable called `name` on env.PATH, or null. */
export function findOnPath(name: string, env: Env): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue
    const candidate = path.join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/** The first clipboard command found on PATH, with its full path; null when there is none. */
export function clipboardCommand(env: Env): ClipboardCommand | null {
  for (const candidate of CANDIDATES) {
    const found = findOnPath(candidate.command, env)
    if (found !== null) return { command: found, args: candidate.args }
  }
  return null
}

/** Pipes `text` into the clipboard command; true when it exits 0. */
export function copyWith(clipboard: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(clipboard.command, clipboard.args, { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
    // A command that fails to start closes its stdin; the error event above already answers.
    child.stdin.on("error", () => {})
    child.stdin.end(text)
  })
}
```

`src/init/draft-prompt.ts`:
```ts
/**
 * The prompt init hands the developer for their own coding agent (spec §12, Agent docs). `doc` is the detected
 * primary doc. The URL stays one literal so test/agents-docs.test.ts can check that the file it names exists.
 */
export function draftPrompt(tag: string, doc: string | null): string {
  return [
    `Read https://raw.githubusercontent.com/syv-ai/rulecast/${tag}/agents/DRAFT-RULES.md`,
    `and follow it to draft rulecast rules for this project from ${doc ?? "the project's docs"}.`,
  ].join("\n")
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run test/init/clipboard.test.ts test/init/draft-prompt.test.ts`
Expected: PASS (6 tests). The second draft-prompt test needs `agents/DRAFT-RULES.md` from plan 4a.

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/init/clipboard.ts packages/rulecast/src/init/draft-prompt.ts packages/rulecast/test/init/clipboard.test.ts packages/rulecast/test/init/draft-prompt.test.ts
git commit -m "feat: find a clipboard command and build the drafting prompt

Claude goes brr.. via Dash"
```

---

### Task 6: Prompter, @clack/prompts and the CLI I/O

**Files:**
- Create: `src/init/prompts.ts`, `src/init/clack.ts`, `test/helpers/prompter.ts`
- Modify: `package.json` (package: dependency, engines), `src/commands/main.ts` (`CliIo`), `src/cli.ts`, `test/helpers/cli.ts`; at the repository root `pnpm-lock.yaml`, `docs/specs/2026-09-15-rulecast-design.md` (§16 Node version) and `docs/plans/2026-09-15-rulecast-00-index.md` (Node version in the conventions)
- Test: `test/init/clack.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @syv-ai/rulecast add @clack/prompts@^1.8.1`

`@clack/prompts` 1.8.1 declares `"engines": { "node": ">= 20.12.0" }` (checked with `npm view`), so rulecast's floor rises with it (Decision 9). This is the only place plan 4 changes the Node version.

In `packages/rulecast/package.json`, replace:
```json
  "engines": {
    "node": ">=20"
  },
```
with:
```json
  "engines": {
    "node": ">=20.12"
  },
```

In `docs/specs/2026-09-15-rulecast-design.md` §16, replace:
```markdown
- TypeScript, Node ≥ 20, published to npm as `@syv-ai/rulecast` with a `rulecast` bin.
```
with:
```markdown
- TypeScript, Node ≥ 20.12 (the floor of `@clack/prompts`), published to npm as `@syv-ai/rulecast` with a `rulecast` bin.
```

In `docs/plans/2026-09-15-rulecast-00-index.md` (Conventions for all plans), replace:
```markdown
- Package manager: pnpm (workspace). Node ≥ 20. ESM only.
```
with:
```markdown
- Package manager: pnpm (workspace). Node ≥ 20.12. ESM only.
```

- [ ] **Step 2: Write the failing test**

`test/init/clack.test.ts`:
```ts
import { CANCEL_SYMBOL } from "@clack/prompts"
import { expect, test } from "vitest"

import { clackPrompter, unwrap } from "../../src/init/clack"
import { Cancelled } from "../../src/init/prompts"

test("unwrap passes answers through and turns a cancel into Cancelled", () => {
  expect(unwrap(["python/layering"])).toEqual(["python/layering"])
  expect(unwrap(false)).toBe(false)
  expect(() => unwrap(CANCEL_SYMBOL)).toThrow(Cancelled)
})

test("the clack prompter implements every prompt", () => {
  expect(Object.keys(clackPrompter()).sort()).toEqual([
    "confirm",
    "groupMultiselect",
    "intro",
    "multiselect",
    "note",
    "outro",
    "select",
  ])
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run test/init/clack.test.ts`
Expected: FAIL: cannot find module `../../src/init/clack`.

- [ ] **Step 4: Implement the prompter**

`src/init/prompts.ts`:
```ts
/** One option of a prompt. Values are strings so every prompt implementation can carry them. */
export interface Choice {
  value: string
  label: string
  hint?: string
  /** Shown but not selectable (installed rules, agents without an adapter). */
  disabled?: boolean
}

/**
 * The only terminal layer of init. The real one wraps @clack/prompts (init/clack.ts, loaded on demand so hooks
 * never pay for it); tests script the answers. Every prompt throws Cancelled when the developer cancels.
 */
export interface Prompter {
  intro(title: string): void
  note(message: string, title?: string): void
  groupMultiselect(options: {
    message: string
    groups: Record<string, Choice[]>
    initialValues: string[]
  }): Promise<string[]>
  multiselect(options: { message: string; choices: Choice[]; initialValues: string[] }): Promise<string[]>
  select(options: { message: string; choices: Choice[]; initialValue: string }): Promise<string>
  confirm(options: { message: string; initialValue: boolean }): Promise<boolean>
  outro(message: string): void
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled")
  }
}
```

`src/init/clack.ts`:
```ts
import * as clack from "@clack/prompts"

import { Cancelled, type Prompter } from "./prompts"

/** A prompt's answer, or Cancelled when the developer pressed Ctrl+C or Escape. */
export function unwrap<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new Cancelled()
  return value as Exclude<T, symbol>
}

export function clackPrompter(): Prompter {
  return {
    intro: (title) => clack.intro(title),
    note: (message, title) => clack.note(message, title),
    groupMultiselect: async ({ message, groups, initialValues }) =>
      unwrap(await clack.groupMultiselect<string>({ message, options: groups, initialValues, required: false })),
    multiselect: async ({ message, choices, initialValues }) =>
      unwrap(await clack.multiselect<string>({ message, options: choices, initialValues, required: false })),
    select: async ({ message, choices, initialValue }) =>
      unwrap(await clack.select<string>({ message, options: choices, initialValue })),
    confirm: async ({ message, initialValue }) => unwrap(await clack.confirm({ message, initialValue })),
    outro: (message) => clack.outro(message),
  }
}
```

The `@clack/prompts` 1.8.1 API used here (checked in its `index.d.mts`): `groupMultiselect<Value>({ message, options: Record<string, Option<Value>[]>, initialValues, required })`, `multiselect`, `select({ message, options, initialValue })`, `confirm({ message, initialValue })`, each resolving to the answer or the cancel symbol; `isCancel`, `intro`, `note(message, title)`, `outro`; options take `value`, `label`, `hint`, `disabled`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run test/init/clack.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Give the CLI I/O prompts and a clipboard**

In `src/commands/main.ts`, after the line `import type { Env } from "../core/home"`, add:
```ts
import type { Prompter } from "../init/prompts"
```
(biome's organizeImports may move it on commit.) Then replace:
```ts
export interface CliIo {
  cwd: string
  /** Environment variables; the cache home comes from RULECAST_HOME or XDG_CACHE_HOME (core/home.ts). */
  env: Env
```
with:
```ts
export interface CliIo {
  cwd: string
  /** Environment variables; the cache home comes from RULECAST_HOME or XDG_CACHE_HOME (core/home.ts). */
  env: Env
  /** stdin and stdout are terminals: init may prompt. */
  interactive: boolean
  /** The terminal prompter, loaded on demand; only init calls it, and only when interactive. */
  prompter(): Promise<Prompter>
  /** Copies text to the system clipboard; false when no clipboard command exists or it fails. */
  copyToClipboard(text: string): Promise<boolean>
```

Replace the whole of `src/cli.ts` (plan 3 left it as plan 2's file plus `env: process.env`) with:
```ts
#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers"

import { main } from "./commands/main"
import { spawnDetached } from "./commands/spawn"
import { clipboardCommand, copyWith } from "./init/clipboard"

const script = process.argv[1]!

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  startWarm: (root, kinds) =>
    spawnDetached(process.execPath, [script, "warm", ...kinds.flatMap((kind) => ["--detector", kind])], root),
  // Only init prompts; a dynamic import keeps @clack/prompts out of every hook's startup.
  prompter: async () => (await import("./init/clack")).clackPrompter(),
  copyToClipboard: async (text) => {
    const clipboard = clipboardCommand(process.env)
    return clipboard !== null && (await copyWith(clipboard, text))
  },
})
```

Replace `test/helpers/cli.ts` with:
```ts
import { type CliIo, main } from "../../src/commands/main"
import type { Env } from "../../src/core/home"
import type { Prompter } from "../../src/init/prompts"
import { testEnv } from "./home"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
  /** Texts handed to copyToClipboard. */
  copied: string[]
}

export interface IoOptions {
  /** Behave as if stdin and stdout were terminals. */
  interactive?: boolean
  /** Answers prompts; required when a test runs an interactive command. */
  prompter?: Prompter
  /** What copyToClipboard reports; default true. */
  clipboard?: boolean
}

export function captureIo(
  cwd: string,
  stdin = "",
  env: Env = testEnv,
  options: IoOptions = {},
): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [], copied: [] }
  const io: CliIo = {
    cwd,
    env,
    interactive: options.interactive ?? false,
    stdout: (text) => {
      output.stdout += text
    },
    stderr: (text) => {
      output.stderr += text
    },
    readStdin: async () => stdin,
    startWarm: (root, kinds) => {
      output.warmed.push({ root, kinds })
    },
    prompter: async () => {
      if (!options.prompter) throw new Error("the test gave no prompter")
      return options.prompter
    },
    copyToClipboard: async (text) => {
      output.copied.push(text)
      return options.clipboard ?? true
    },
  }
  return { io, output }
}

export async function runCli(
  cwd: string,
  argv: string[],
  stdin = "",
  env: Env = testEnv,
  options: IoOptions = {},
): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin, env, options)
  const code = await main(argv, io)
  return { code, ...output }
}
```

Create `test/helpers/prompter.ts`:
```ts
import { Cancelled, type Choice, type Prompter } from "../../src/init/prompts"

/** Answer a prompt with its default: the initial values, initial value or initial confirm. */
export const ACCEPT = Symbol("accept the default")
/** Answer a prompt the way Ctrl+C does. */
export const CANCEL = Symbol("cancel")

export type ScriptedAnswer = string | string[] | boolean | typeof ACCEPT | typeof CANCEL

export interface AskedPrompt {
  kind: "groupMultiselect" | "multiselect" | "select" | "confirm"
  message: string
  /** Selectable values, in order. */
  values: string[]
  initial: string | string[] | boolean
}

export interface ScriptedPrompter {
  prompter: Prompter
  asked: AskedPrompt[]
  /** intro, note and outro text, in order ("title\nmessage" for notes with a title). */
  shown: string[]
}

/** A Prompter that answers from a script, in order, and fails the test on an unexpected or invalid answer. */
export function scriptedPrompter(answers: ScriptedAnswer[]): ScriptedPrompter {
  const script = [...answers]
  const asked: AskedPrompt[] = []
  const shown: string[] = []
  const selectable = (choices: Choice[]) => choices.filter((choice) => !choice.disabled).map((choice) => choice.value)

  function next(prompt: AskedPrompt): ScriptedAnswer {
    asked.push(prompt)
    if (script.length === 0) throw new Error(`unexpected prompt: ${prompt.message}`)
    const answer = script.shift()!
    if (answer === CANCEL) throw new Cancelled()
    return answer === ACCEPT ? prompt.initial : answer
  }
  function values(prompt: AskedPrompt): string[] {
    const answer = next(prompt)
    if (!Array.isArray(answer) || answer.some((value) => !prompt.values.includes(value))) {
      throw new Error(
        `invalid answer ${JSON.stringify(answer)} to "${prompt.message}" (options ${prompt.values.join(", ")})`,
      )
    }
    return answer
  }

  const prompter: Prompter = {
    intro: (title) => shown.push(title),
    note: (message, title) => shown.push(title === undefined ? message : `${title}\n${message}`),
    outro: (message) => shown.push(message),
    groupMultiselect: async ({ message, groups, initialValues }) =>
      values({
        kind: "groupMultiselect",
        message,
        values: selectable(Object.values(groups).flat()),
        initial: initialValues,
      }),
    multiselect: async ({ message, choices, initialValues }) =>
      values({ kind: "multiselect", message, values: selectable(choices), initial: initialValues }),
    select: async ({ message, choices, initialValue }) => {
      const prompt: AskedPrompt = { kind: "select", message, values: selectable(choices), initial: initialValue }
      const answer = next(prompt)
      if (typeof answer !== "string" || !prompt.values.includes(answer)) {
        throw new Error(
          `invalid answer ${JSON.stringify(answer)} to "${message}" (options ${prompt.values.join(", ")})`,
        )
      }
      return answer
    },
    confirm: async ({ message, initialValue }) => {
      const answer = next({ kind: "confirm", message, values: [], initial: initialValue })
      if (typeof answer !== "boolean") throw new Error(`invalid answer ${JSON.stringify(answer)} to "${message}"`)
      return answer
    },
  }
  return { prompter, asked, shown }
}
```

- [ ] **Step 7: Run everything**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Existing tests use `runCli`/`captureIo` with the new defaults (not interactive, no prompter).

- [ ] **Step 8: Commit**

```bash
git add packages/rulecast/package.json pnpm-lock.yaml packages/rulecast/src/init/prompts.ts packages/rulecast/src/init/clack.ts packages/rulecast/src/commands/main.ts packages/rulecast/src/cli.ts packages/rulecast/test/helpers/cli.ts packages/rulecast/test/helpers/prompter.ts packages/rulecast/test/init/clack.test.ts docs/specs/2026-09-15-rulecast-design.md docs/plans/2026-09-15-rulecast-00-index.md
git commit -m "feat: add the init prompter on @clack/prompts, loaded on demand

Claude goes brr.. via Dash"
```

---

### Task 7: Plan the file changes

**Files:**
- Create: `src/init/plan.ts`
- Test: `test/init/plan.test.ts`

- [ ] **Step 1: Write the failing test**

`test/init/plan.test.ts`:
```ts
import { describe, expect, test } from "vitest"

import { adapterByName } from "../../src/adapters"
import { CONFIG_FILE } from "../../src/core/config/load"
import { newConfigText, type RuleSelection } from "../../src/init/config-text"
import { type PlanContext, PlanError, planInit, reviewText } from "../../src/init/plan"

const claude = adapterByName("claude-code")!
const install = claude.install!
const catalog = { url: "https://github.com/syv-ai/rulecast", rev: "v0.2.0" }
const rules: RuleSelection[] = [
  { id: "python/layering", context: null },
  { id: "python/no-httpexception-in-services", context: ["@AGENTS.md#errors"] },
]

/** Settings as install.merge would write them. */
const merged = (settings: unknown, local = false) =>
  `${JSON.stringify(install.merge(settings, install.command(local), 60000).settings, null, 2)}\n`

function context(files: Record<string, string>, overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    configText: files[CONFIG_FILE] ?? null,
    verifyMs: 60000,
    local: false,
    readText: async (file) => files[file] ?? null,
    ...overrides,
  }
}

describe("planInit", () => {
  test("a new project gets a config and shared hooks", async () => {
    const changes = await planInit({ catalog, rules, agents: [{ adapter: claude, scope: "shared" }] }, context({}))
    expect(changes).toEqual([
      {
        file: CONFIG_FILE,
        content: newConfigText(catalog, rules),
        created: true,
        summary: "new, 2 rules from syv-ai/rulecast@v0.2.0",
        commit: true,
      },
      {
        file: ".claude/settings.json",
        content: merged({}),
        created: true,
        summary: "+6 hooks (Claude Code)",
        commit: true,
      },
    ])
  })

  test("personal scope merges into existing settings and is not for committing", async () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "dash stop" }] }] }, model: "opus" }
    const files = {
      [CONFIG_FILE]: newConfigText(catalog, rules),
      ".claude/settings.local.json": JSON.stringify(existing),
    }
    const changes = await planInit(
      { catalog, rules: [], agents: [{ adapter: claude, scope: "personal" }] },
      context(files, { local: true }),
    )
    expect(changes).toEqual([
      {
        file: ".claude/settings.local.json",
        content: merged(existing, true),
        created: false,
        summary: "+6 hooks (Claude Code)",
        commit: false,
      },
    ])
    expect(changes[0]!.content).toContain("node_modules/.bin/rulecast hook claude-code")
  })

  test("re-running changes nothing that is already there", async () => {
    const files = {
      [CONFIG_FILE]: newConfigText(catalog, rules),
      ".claude/settings.local.json": merged({}),
    }
    const selections = { catalog, rules: [], agents: [{ adapter: claude, scope: "shared" as const }] }
    expect(await planInit(selections, context(files))).toEqual([])
  })

  test("new catalog rules are added to an existing config", async () => {
    const files = { [CONFIG_FILE]: newConfigText(catalog, [rules[0]!]) }
    const [change] = await planInit({ catalog, rules: [rules[1]!], agents: [] }, context(files))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: false, summary: "+1 rule from syv-ai/rulecast@v0.2.0" })
    expect(change!.content).toBe(newConfigText(catalog, rules))
  })

  test("without a catalog a new config has only the local repo", async () => {
    const [change] = await planInit({ catalog: null, rules: [], agents: [] }, context({}))
    expect(change).toMatchObject({ file: CONFIG_FILE, created: true, summary: "new, no rules yet" })
  })

  test("unreadable settings name their file", async () => {
    const files = { ".claude/settings.json": "{ nope" }
    const selections = { catalog: null, rules: [], agents: [{ adapter: claude, scope: "shared" as const }] }
    await expect(planInit(selections, context(files))).rejects.toThrow(PlanError)
    await expect(planInit(selections, context(files))).rejects.toThrow(/^\.claude\/settings\.json: /)
  })
})

test("reviewText aligns one line per file", () => {
  expect(
    reviewText([
      { file: CONFIG_FILE, content: "", created: true, summary: "new, 2 rules", commit: true },
      { file: ".claude/settings.json", content: "", created: true, summary: "+6 hooks (Claude Code)", commit: true },
    ]),
  ).toBe(".rulecast-config.yaml  new, 2 rules\n.claude/settings.json  +6 hooks (Claude Code)")
})
```

The Claude Code adapter adds six hook groups (`PostToolUse` Read, `PostToolUse` Edit|Write, `Stop`, `SubagentStop`, `UserPromptSubmit`, `SessionStart`), hence `+6 hooks`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/init/plan.test.ts`
Expected: FAIL: cannot find module `../../src/init/plan`.

- [ ] **Step 3: Implement**

`src/init/plan.ts`:
```ts
import { CONFIG_FILE } from "../core/config/load"
import { repoLabel } from "../core/repos/layout"
import type { Adapter, InstallScope } from "../core/types"
import { addCatalogRules, type CatalogRef, newConfigText, type RuleSelection } from "./config-text"

export interface AgentChoice {
  adapter: Adapter
  scope: InstallScope
}

export interface InitSelections {
  /** null: the catalog could not be loaded. */
  catalog: CatalogRef | null
  /** Catalog rules to add; none of them is configured yet. */
  rules: RuleSelection[]
  /** Adapters with an install, and where their hooks go. */
  agents: AgentChoice[]
}

export interface PlannedChange {
  /** Repo-relative. */
  file: string
  content: string
  created: boolean
  /** "new, 3 rules from syv-ai/rulecast@v0.2.0", "+2 rules from …", "+6 hooks (Claude Code)". */
  summary: string
  /** Shared files the developer should commit; personal settings are not. */
  commit: boolean
}

export interface PlanContext {
  /** The current .rulecast-config.yaml; null when the project has none. */
  configText: string | null
  verifyMs: number
  /** rulecast is installed in the project's node_modules. */
  local: boolean
  /** Reads a repo-relative file; null when missing. */
  readText(file: string): Promise<string | null>
}

export class PlanError extends Error {}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function parseSettings(text: string, file: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new PlanError(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function planConfig(selections: InitSelections, configText: string | null): PlannedChange | null {
  const { catalog, rules } = selections
  const from = catalog === null ? "" : ` from ${repoLabel(catalog.url, catalog.rev)}`
  if (configText === null) {
    const summary = rules.length === 0 ? "new, no rules yet" : `new, ${plural(rules.length, "rule")}${from}`
    return { file: CONFIG_FILE, content: newConfigText(catalog, rules), created: true, summary, commit: true }
  }
  if (catalog === null || rules.length === 0) return null
  const content = addCatalogRules(configText, catalog, rules)
  if (content === configText) return null
  return {
    file: CONFIG_FILE,
    content,
    created: false,
    summary: `+${plural(rules.length, "rule")}${from}`,
    commit: true,
  }
}

async function planAgent(choice: AgentChoice, context: PlanContext): Promise<PlannedChange | null> {
  const install = choice.adapter.install
  if (install === null) return null
  const command = install.command(context.local)
  const merge = (settings: unknown, file: string) => {
    try {
      return install.merge(settings, command, context.verifyMs)
    } catch (error) {
      throw new PlanError(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Hooks already in any of the agent's settings files count as installed, as for rulecast install.
  for (const { file } of install.scopes) {
    const text = await context.readText(file)
    if (text !== null && merge(parseSettings(text, file), file).added.length === 0) return null
  }
  const target = install.scopes.find((entry) => entry.scope === choice.scope)
  if (target === undefined) throw new PlanError(`${choice.adapter.label} has no ${choice.scope} settings`)
  const text = await context.readText(target.file)
  const merged = merge(text === null ? {} : parseSettings(text, target.file), target.file)
  return {
    file: target.file,
    content: `${JSON.stringify(merged.settings, null, 2)}\n`,
    created: text === null,
    summary: `+${plural(merged.added.length, "hook")} (${choice.adapter.label})`,
    commit: choice.scope === "shared",
  }
}

/** Every file init would create or change, with its full new content. Nothing is written here. */
export async function planInit(selections: InitSelections, context: PlanContext): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = []
  const config = planConfig(selections, context.configText)
  if (config !== null) changes.push(config)
  for (const choice of selections.agents) {
    const change = await planAgent(choice, context)
    if (change !== null) changes.push(change)
  }
  return changes
}

/** The Review step: one line per file. */
export function reviewText(changes: readonly PlannedChange[]): string {
  const width = Math.max(...changes.map((change) => change.file.length))
  return changes.map((change) => `${change.file.padEnd(width)}  ${change.summary}`).join("\n")
}
```

`InstallScope` is the type plan 3 Task 13 added to `src/core/types.ts` next to `AdapterInstall`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run test/init/plan.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rulecast/src/init/plan.ts packages/rulecast/test/init/plan.test.ts
git commit -m "feat: plan init's file changes before writing anything

Claude goes brr.. via Dash"
```

---

### Task 8: `rulecast init`

**Files:**
- Modify: `src/commands/init.ts` (replace the interim command), `src/commands/main.ts` (dispatch, usage)
- Create: `test/helpers/catalog.ts`
- Test: `test/commands/init.test.ts` (replace), `test/commands/help.test.ts` (usage line), `test/build.test.ts`

- [ ] **Step 1: Write the catalog helper**

`test/helpers/catalog.ts`:
```ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createRuleRepo } from "./rule-repo"

/** The repository root: packages/rulecast/test/helpers is four levels down. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

/** The rulecast repository as a catalog: its generated manifest and every rule package's files. */
export function catalogFiles(): Record<string, string> {
  const files: Record<string, string> = {
    ".rulecast-rules.yaml": readFileSync(path.join(REPO_ROOT, ".rulecast-rules.yaml"), "utf8"),
  }
  const packages = path.join(REPO_ROOT, "packages")
  for (const name of readdirSync(packages)) {
    if (!name.startsWith("rules-")) continue
    for (const entry of readdirSync(path.join(packages, name), { recursive: true, encoding: "utf8" })) {
      const file = path.join(packages, name, entry)
      if (!statSync(file).isFile()) continue
      files[["packages", name, ...entry.split(path.sep)].join("/")] = readFileSync(file, "utf8")
    }
  }
  return files
}

/** A bare "rulecast repository" holding this repository's catalog, tagged v0.2.0. */
export function createCatalogRepo(): Promise<string> {
  return createRuleRepo([{ tag: "v0.2.0", files: catalogFiles() }])
}
```

- [ ] **Step 2: Write the failing test**

Replace `test/commands/init.test.ts` (the interim command's tests) with:
```ts
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"
import { parse } from "yaml"

import { CONFIG_FILE } from "../../src/core/config/load"
import type { Env } from "../../src/core/home"
import { VERSION } from "../../src/core/version"
import { createCatalogRepo } from "../helpers/catalog"
import { runCli } from "../helpers/cli"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { ACCEPT, CANCEL, scriptedPrompter } from "../helpers/prompter"

let catalog: string
let env: Env

beforeAll(async () => {
  catalog = await createCatalogRepo()
  env = { ...testEnv, RULECAST_CATALOG: catalog }
}, 30_000)

/** A Python project whose CLAUDE.md imports AGENTS.md (so Claude Code is detected). */
const PROJECT: Record<string, string> = {
  "app/services/users.py": "def get():\n    return None\n",
  "AGENTS.md": "# Agents\n\n## Errors\n\nServices raise domain exceptions.\n",
  "CLAUDE.md": "@AGENTS.md\n",
}
const PYTHON = ["python/layering", "python/no-httpexception-in-services", "python/no-queries-in-services"]
const PROMPT =
  "Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md\n" +
  "and follow it to draft rulecast rules for this project from AGENTS.md."

const read = (root: string, file: string) => readFile(path.join(root, file), "utf8")
const catalogEntry = (text: string) =>
  (parse(text) as { repos: { repo: string; rev?: string; rules: { id: string; context?: string[] }[] }[] }).repos[0]!
const ids = (text: string) =>
  catalogEntry(text)
    .rules.map((rule) => rule.id)
    .sort()

describe("rulecast init --yes", () => {
  test("configures the catalog rules that apply to the project and shared hooks", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    const config = await read(root, CONFIG_FILE)
    expect(catalogEntry(config)).toMatchObject({ repo: catalog, rev: "v0.2.0" })
    expect(ids(config)).toEqual(PYTHON)
    const settings = JSON.parse(await read(root, ".claude/settings.json"))
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("rulecast hook claude-code")
    expect(result.stdout).toContain("python · AGENTS.md (imported by CLAUDE.md) · Claude Code (CLAUDE.md)")
    expect(result.stdout).toContain("rulecast validate: 3 rules valid")
    expect(result.stdout).toContain(PROMPT)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml and .claude/settings.json.")
    expect(result.copied).toEqual([])
  })

  test("re-running only adds rules, keeping the existing text and hooks", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["init", "--yes"], "", env)
    const before = `# our team's rulecast config\n${await read(root, CONFIG_FILE)}`
    await writeFile(path.join(root, CONFIG_FILE), before)
    await mkdir(path.join(root, "src/components"), { recursive: true })
    await writeFile(path.join(root, "src/components/Card.tsx"), "export const Card = () => fetch('/api')\n")

    const result = await runCli(root, ["init", "--yes"], "", env)
    expect(result.code).toBe(0)
    const after = await read(root, CONFIG_FILE)
    expect(ids(after)).toEqual([...PYTHON, "react/data-fetching", "react/no-fetch-in-components"].sort())
    const local = before.indexOf("  - repo: local")
    expect(after.startsWith(before.slice(0, local))).toBe(true)
    expect(after.endsWith(before.slice(local))).toBe(true)
    expect(result.stdout).not.toContain("hooks (Claude Code)")
  })

  test("flags choose the rules, the agent and the scope", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(
      root,
      ["init", "--rules", "generated-code", "--agent", "claude-code", "--scope", "personal", "--yes"],
      "",
      env,
    )
    expect(result.code).toBe(0)
    expect(ids(await read(root, CONFIG_FILE))).toEqual(["generated-code"])
    expect(existsSync(path.join(root, ".claude/settings.local.json"))).toBe(true)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
    expect(result.stdout).toContain("Commit .rulecast-config.yaml.")
    expect(result.stdout).toContain("from the project's docs.")
  })

  test("--no-rules writes only the local repo; no detected agent installs no hooks", async () => {
    const root = await createRepo({ "app/services/users.py": "x = 1\n" })
    const result = await runCli(root, ["init", "--no-rules", "--yes"], "", env)
    expect(result.code).toBe(0)
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(existsSync(path.join(root, ".claude"))).toBe(false)
    expect(result.stdout).toContain("No agent hooks will be installed.")
  })

  test("an unreachable catalog is skipped with a warning", async () => {
    const root = await createRepo(PROJECT)
    const missing = { ...testEnv, RULECAST_CATALOG: path.join(root, "missing.git") }
    const result = await runCli(root, ["init", "--yes"], "", missing)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Catalog unavailable")
    expect(parse(await read(root, CONFIG_FILE))).toEqual({ repos: [{ repo: "local", rules: [] }] })
    expect(result.stdout).toContain(`rulecast/v${VERSION}/agents/DRAFT-RULES.md`)
  })

  test("unknown rules, agents and scopes are usage errors that write nothing", async () => {
    const root = await createRepo(PROJECT)
    for (const args of [
      ["--rules", "nope/x"],
      ["--agent", "vim"],
      ["--scope", "team"],
      ["--rules", "a", "--no-rules"],
    ]) {
      const result = await runCli(root, ["init", ...args, "--yes"], "", env)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("usage:")
    }
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})

describe("rulecast init without a terminal", () => {
  test("prints the planned changes and exits 2 without --yes", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["init"], "", env)
    expect(result.code).toBe(2)
    expect(result.stdout).toMatch(/\.rulecast-config\.yaml {2}new, 3 rules from .+@v0\.2\.0\n/)
    expect(result.stdout).toContain(".claude/settings.json  +6 hooks (Claude Code)")
    expect(result.stdout).toContain("Rerun with --yes")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
    expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(false)
  })
})

describe("rulecast init in a terminal", () => {
  test("scripted answers: one rule pointed at the project's doc, personal hooks, prompt copied", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([
      ["python/no-httpexception-in-services"],
      "@AGENTS.md#errors",
      ACCEPT,
      "personal",
      true,
      true,
    ])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    expect(script.asked.map((prompt) => prompt.kind)).toEqual([
      "groupMultiselect",
      "select",
      "multiselect",
      "select",
      "confirm",
      "confirm",
    ])
    const [rules, conventions] = script.asked
    expect([...(rules!.initial as string[])].sort()).toEqual(PYTHON)
    expect(rules!.values).toHaveLength(6)
    expect(conventions!.values).toEqual(["", "@AGENTS.md", "@AGENTS.md#agents", "@AGENTS.md#errors"])
    expect(catalogEntry(await read(root, CONFIG_FILE)).rules).toEqual([
      { id: "python/no-httpexception-in-services", context: ["@AGENTS.md#errors"] },
    ])
    expect(existsSync(path.join(root, ".claude/settings.local.json"))).toBe(true)
    expect(result.copied).toEqual([PROMPT])
    expect(script.shown.at(-1)).toBe("Commit .rulecast-config.yaml.")
  })

  test("Ctrl+C exits 130 and writes nothing", async () => {
    const root = await createRepo(PROJECT)
    const script = scriptedPrompter([CANCEL])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(130)
    expect(result.stderr).toBe("rulecast: init cancelled\n")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })

  test("declining the review writes nothing", async () => {
    const root = await createRepo(PROJECT)
    // Rules, three conventions (one per preselected rule), agents, scope, then "Write?".
    const script = scriptedPrompter([ACCEPT, ACCEPT, ACCEPT, ACCEPT, ACCEPT, ACCEPT, false])
    const result = await runCli(root, ["init"], "", env, { interactive: true, prompter: script.prompter })
    expect(result.code).toBe(0)
    expect(script.shown.at(-1)).toBe("Nothing written.")
    expect(existsSync(path.join(root, CONFIG_FILE))).toBe(false)
  })
})
```

These tests use the real catalog from plan 4a. They depend on its rule ids and `files` regexes (contract: the three `python/` rules match `app/services/*.py`, the two `react/` rules match `src/components/*.tsx`, `generated-code` matches neither) and on every catalog rule having `context`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run test/commands/init.test.ts`
Expected: FAIL. The interim `init` accepts no options (`parseArgs({ args, options: {} })`), so every run with a flag exits 2 with `Unknown option '--yes'` on stderr, and a plain `init` installs hooks and writes a config without the catalog. The first assertion to fail in most tests is `expect(result.stderr).toBe("")` or `expect(result.code).toBe(0)`.

- [ ] **Step 4: Implement**

Replace `src/commands/init.ts` with:
```ts
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { parse } from "yaml"

import { ADAPTERS, adapterByName } from "../adapters"
import { compile, compileManifest } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE, parseConfig } from "../core/config/load"
import { type Config, defaultConfig } from "../core/config/schema"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import { allFiles } from "../core/git"
import { cacheHome } from "../core/home"
import { ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fetchingRepos } from "../core/repos/provider"
import { latestTag, remoteTags } from "../core/repos/tags"
import type { Adapter, InstallScope } from "../core/types"
import { VERSION } from "../core/version"
import type { CatalogRef, RuleSelection } from "../init/config-text"
import { type Detection, detectionSummary, detectProject, docChoices, markerExists } from "../init/detect"
import { draftPrompt } from "../init/draft-prompt"
import { type AgentChoice, type PlannedChange, planInit, reviewText } from "../init/plan"
import { Cancelled, type Choice, type Prompter } from "../init/prompts"
import type { CliIo } from "./main"
import { findRoot, hasProject } from "./project"
import { UsageError } from "./usage"

/** The rule catalog: the rulecast repository itself (spec §4, Rule repos). RULECAST_CATALOG overrides it. */
export const DEFAULT_CATALOG = "https://github.com/syv-ai/rulecast"

const SCOPES: readonly InstallScope[] = ["shared", "personal"]

interface Flags {
  /** --rules; null when not given. */
  rules: string[] | null
  noRules: boolean
  agents: Adapter[]
  scope: InstallScope | null
  yes: boolean
}

interface Catalog extends CatalogRef {
  label: string
  rules: CompiledRule[]
}

/** Where init writes to: the output channel differs between prompting and plain runs. */
interface Ui {
  /** null: no prompts; every choice takes its flag or its detected default. */
  prompter: Prompter | null
  say(message: string, title?: string): void
}

const installable = () => ADAPTERS.filter((adapter) => adapter.install !== null)

function parseFlags(args: string[]): Flags {
  const { values } = parseArgs({
    args,
    options: {
      rules: { type: "string" },
      "no-rules": { type: "boolean", default: false },
      agent: { type: "string", multiple: true },
      scope: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  })
  if (values.rules !== undefined && values["no-rules"]) throw new UsageError("use --rules or --no-rules, not both")
  const scope = values.scope ?? null
  if (scope !== null && !SCOPES.includes(scope as InstallScope)) {
    throw new UsageError(`unknown scope "${scope}" (use shared or personal)`)
  }
  const agents = (values.agent ?? []).map((name) => {
    const adapter = adapterByName(name)
    if (!adapter?.install) {
      const names = installable().map((each) => each.name)
      throw new UsageError(`unknown agent "${name}" (use ${names.join(", ")})`)
    }
    return adapter
  })
  const rules =
    values.rules === undefined
      ? null
      : values.rules
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
  return { rules, noRules: values["no-rules"], agents, scope: scope as InstallScope | null, yes: values.yes }
}

/** The configured project, else the enclosing git repository, else the current directory. */
function projectRoot(cwd: string): string {
  const found = findRoot(cwd)
  if (hasProject(found)) return found
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return cwd
  }
}

async function readConfig(root: string): Promise<{ text: string | null; config: Config | null }> {
  const text = await readSourceFile(root, CONFIG_FILE)
  if (text === null) return { text: null, config: null }
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: ${errorMessage(error)} (fix it, then run rulecast init again)`)
  }
  const parsed = parseConfig(data ?? {})
  if (!parsed.ok) throw new Error(`${parsed.message} (fix it, then run rulecast init again)`)
  return { text, config: parsed.value }
}

/** The catalog at the configured rev, else at its latest tag; a message when it cannot be loaded. */
async function loadCatalog(
  url: string,
  rev: string | undefined,
  home: string,
  registry: DetectorRegistry,
): Promise<Catalog | string> {
  try {
    let pinned = rev
    if (pinned === undefined) {
      const tag = latestTag(await remoteTags(url))
      if (tag === null) return `${url} has no version tags`
      pinned = tag.name
    }
    const dir = await ensureRepo(home, url, pinned)
    const { rules } = await compileManifest(dir, registry)
    return { url, rev: pinned, label: repoLabel(url, pinned), rules }
  } catch (error) {
    return errorMessage(error)
  }
}

const idOf = (entry: unknown): string | null => {
  const id = (entry as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

const groupOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : "general")

async function chooseRules(
  catalog: Catalog,
  installed: ReadonlySet<string>,
  files: readonly string[],
  flags: Flags,
  ui: Ui,
): Promise<CompiledRule[]> {
  const available = catalog.rules.filter((rule) => !installed.has(rule.id))
  if (flags.noRules) return []
  if (flags.rules !== null) {
    const known = new Set(catalog.rules.map((rule) => rule.id))
    const unknown = flags.rules.find((id) => !known.has(id))
    if (unknown !== undefined) throw new UsageError(`"${unknown}" is not a rule in ${catalog.label}`)
    return available.filter((rule) => flags.rules!.includes(rule.id))
  }
  // Preselected: rules that apply to at least one project file.
  const preselected = available.filter((rule) => files.some((file) => rule.matches(file))).map((rule) => rule.id)
  if (ui.prompter === null) return available.filter((rule) => preselected.includes(rule.id))
  if (available.length === 0) {
    ui.say(`Every rule from ${catalog.label} is already configured.`, "Rules")
    return []
  }
  const groups: Record<string, Choice[]> = {}
  for (const rule of catalog.rules) {
    const group = groupOf(rule.id)
    const done = installed.has(rule.id)
    const choices = groups[group] ?? []
    choices.push({
      value: rule.id,
      label: group === "general" ? rule.id : rule.id.slice(group.length + 1),
      hint: done ? "installed" : (rule.description ?? rule.name),
      disabled: done,
    })
    groups[group] = choices
  }
  const chosen = await ui.prompter.groupMultiselect({
    message: `Rules from ${catalog.label}`,
    groups,
    initialValues: preselected,
  })
  return available.filter((rule) => chosen.includes(rule.id))
}

async function chooseConventions(rules: CompiledRule[], detection: Detection, ui: Ui): Promise<RuleSelection[]> {
  const choices = detection.docs.flatMap(docChoices)
  const selections: RuleSelection[] = []
  for (const rule of rules) {
    if (ui.prompter === null || rule.context.length === 0 || choices.length === 0) {
      selections.push({ id: rule.id, context: null })
      continue
    }
    const keep: Choice = {
      value: "",
      label: "keep the package's doc",
      hint: rule.context.map((spec) => spec.ref).join(", "),
    }
    const answer = await ui.prompter.select({
      message: `Conventions for ${rule.id}`,
      choices: [keep, ...choices],
      initialValue: "",
    })
    selections.push({ id: rule.id, context: answer === "" ? null : [answer] })
  }
  return selections
}

async function chooseAgents(detection: Detection, flags: Flags, ui: Ui): Promise<AgentChoice[]> {
  const detected = detection.agents.filter((agent) => agent.adapter !== null).map((agent) => agent.name)
  let chosen: Adapter[]
  if (flags.agents.length > 0) chosen = flags.agents
  else if (ui.prompter === null) chosen = installable().filter((adapter) => detected.includes(adapter.name))
  else {
    const choices: Choice[] = installable().map((adapter) => ({
      value: adapter.name,
      label: adapter.label,
      hint: detected.includes(adapter.name) ? "detected" : undefined,
    }))
    for (const agent of detection.agents) {
      if (agent.adapter === null) {
        choices.push({
          value: `unsupported:${agent.name}`,
          label: agent.label,
          hint: "not supported yet",
          disabled: true,
        })
      }
    }
    const names = await ui.prompter.multiselect({ message: "Install hooks for", choices, initialValues: detected })
    chosen = installable().filter((adapter) => names.includes(adapter.name))
  }
  if (chosen.length === 0) {
    ui.say("No agent hooks will be installed. Add them later with rulecast install --agent <name>.", "Agents")
  }

  const agents: AgentChoice[] = []
  for (const adapter of chosen) {
    let scope: InstallScope = flags.scope ?? "shared"
    if (flags.scope === null && ui.prompter !== null) {
      scope = (await ui.prompter.select({
        message: `${adapter.label} hooks in`,
        choices: adapter.install!.scopes.map((entry) => ({
          value: entry.scope,
          label: `${entry.scope} (${entry.file})`,
        })),
        initialValue: "shared",
      })) as InstallScope
    }
    agents.push({ adapter, scope })
  }
  return agents
}

async function write(root: string, changes: readonly PlannedChange[]): Promise<void> {
  for (const change of changes) {
    const file = path.join(root, change.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, change.content)
  }
}

/** rulecast validate on what init wrote; fetches rule repos missing from the cache. Returns the error count. */
async function validate(root: string, home: string, registry: DetectorRegistry, ui: Ui): Promise<number> {
  const project = await compile({ root, registry, repos: fetchingRepos(home) })
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const lines = project.diagnostics.map(
    (diagnostic) =>
      `${diagnostic.level === "warning" ? "warning: " : ""}${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}`,
  )
  if (errors.length === 0) {
    const count = project.rules.length
    lines.push(`rulecast validate: ${count} ${count === 1 ? "rule" : "rules"} valid`)
  }
  ui.say(lines.join("\n"), "Validate")
  return errors.length
}

async function run(root: string, flags: Flags, registry: DetectorRegistry, io: CliIo, ui: Ui): Promise<number> {
  const home = cacheHome(io.env)
  if (ui.prompter !== null) ui.prompter.intro(`rulecast init · ${root}`)
  else io.stdout(`rulecast init · ${root}\n\n`)

  const { text: configText, config } = await readConfig(root)
  const files = await allFiles(root)
  const detection = await detectProject({
    files,
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })
  ui.say(detectionSummary(detection), "Detected")

  const url = io.env.RULECAST_CATALOG || DEFAULT_CATALOG
  const configured = config?.repos.find((repo) => repo.repo === url)
  const loaded = await loadCatalog(url, configured?.rev, home, registry)
  const catalog = typeof loaded === "string" ? null : loaded
  if (typeof loaded === "string") ui.say(`${loaded}. Continuing without catalog rules.`, "Catalog unavailable")
  const installed = new Set((configured?.rules ?? []).map(idOf).filter((id): id is string => id !== null))
  const rules = catalog === null ? [] : await chooseRules(catalog, installed, files, flags, ui)
  const selections = await chooseConventions(rules, detection, ui)
  const agents = await chooseAgents(detection, flags, ui)

  const changes = await planInit(
    { catalog: catalog === null ? null : { url: catalog.url, rev: catalog.rev }, rules: selections, agents },
    {
      configText,
      verifyMs: (config ?? defaultConfig()).timeouts.verifyMs,
      local: existsSync(path.join(root, "node_modules", ".bin", "rulecast")),
      readText: (file) => readSourceFile(root, file),
    },
  )

  if (changes.length === 0) ui.say("Nothing to change.", "Review")
  else {
    ui.say(reviewText(changes), "Review")
    if (ui.prompter !== null) {
      if (!(await ui.prompter.confirm({ message: "Write?", initialValue: true }))) {
        ui.prompter.outro("Nothing written.")
        return 0
      }
    } else if (!flags.yes) {
      io.stdout("Nothing written. Rerun with --yes to write these changes, or run rulecast init in a terminal.\n")
      return 2
    }
    await write(root, changes)
  }

  const errors = await validate(root, home, registry, ui)

  const prompt = draftPrompt(catalog?.rev ?? `v${VERSION}`, detection.primaryDoc)
  const toCommit = changes.filter((change) => change.commit).map((change) => change.file)
  const closing = toCommit.length === 0 ? "Done." : `Commit ${toCommit.join(" and ")}.`
  if (ui.prompter !== null) {
    ui.say(prompt, "Draft rules for your own conventions. Paste this into your coding agent:")
    if (await ui.prompter.confirm({ message: "Copy to clipboard?", initialValue: true })) {
      ui.say((await io.copyToClipboard(prompt)) ? "Copied." : "No clipboard command found: copy it from above.")
    }
    ui.prompter.outro(closing)
  } else {
    ui.say(prompt, "Draft rules for your own conventions. Paste this into your coding agent:")
    io.stdout(`${closing}\n`)
  }
  return errors > 0 ? 2 : 0
}

/** rulecast init (spec §12): detect, choose, review, write, validate, hand over the drafting prompt. */
export async function initCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const flags = parseFlags(args)
  const root = projectRoot(io.cwd)
  const prompter = io.interactive && !flags.yes ? await io.prompter() : null
  const ui: Ui = {
    prompter,
    say: (message, title) => {
      if (prompter !== null) prompter.note(message, title)
      else io.stdout(`${title === undefined ? "" : `${title}\n`}${message}\n\n`)
    },
  }
  try {
    return await run(root, flags, registry, io, ui)
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error
    io.stderr("rulecast: init cancelled\n")
    return 130
  }
}
```

In `src/commands/main.ts`, replace the dispatch branch plan 3 Task 13 left:
```ts
      case "init":
        return await initCommand(root, args, io)
```
with:
```ts
      case "init":
        return await initCommand(args, registry, io)
```
and, in `USAGE`, replace the line:
```
  rulecast init
```
with:
```
  rulecast init [--rules id,id | --no-rules] [--agent <name>]... [--scope shared|personal] [--yes]
```

`init` finds its own root (Decision 5), so it no longer takes `root` from `main`; it takes `registry` to compile the catalog and validate what it wrote.

`test/commands/help.test.ts` (plan 3 Task 19) pins `USAGE`: in its `USAGE` constant, make the same replacement of the line `  rulecast init` with `  rulecast init [--rules id,id | --no-rules] [--agent <name>]... [--scope shared|personal] [--yes]`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run test/commands/init.test.ts test/commands/help.test.ts`
Expected: PASS (10 init tests, 3 help tests).

- [ ] **Step 6: Check that nothing else runs the interim init**

Run: `grep -rn '"init"' packages/rulecast/test`
Expected: only `test/commands/init.test.ts` (plan 3 left no other test calling `init`; Step 7 adds `test/build.test.ts`). If another file shows up, it ran the interim `init` to set up a project: make it write `.rulecast-config.yaml` itself (`localConfig([])` from `test/helpers/config.ts`) and run `install` instead, and add it to this task's `git add`.

- [ ] **Step 7: Check the built CLI**

In `test/build.test.ts` (plan 3's version), replace:
```ts
import { writeFile } from "node:fs/promises"
```
with:
```ts
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
```
and replace:
```ts
import { createFixture } from "./helpers/fixture"
```
with:
```ts
import { createCatalogRepo } from "./helpers/catalog"
import { createFixture } from "./helpers/fixture"
import { createRepo } from "./helpers/git"
```
then append:
```ts
test("built CLI runs init --yes and keeps @clack/prompts out of its entry", async () => {
  const root = await createRepo({ "app/services/users.py": "x = 1\n", "CLAUDE.md": "# Project\n" })
  const catalog = await createCatalogRepo()
  const result = spawnSync(process.execPath, [cli, "init", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, RULECAST_CATALOG: catalog },
  })
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(existsSync(path.join(root, ".rulecast-config.yaml"))).toBe(true)
  expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(true)
  expect(result.stdout).toContain("from CLAUDE.md.")
  // The prompter is a separate chunk (Decision 2): hooks never load it.
  expect(readFileSync(cli, "utf8")).not.toContain("@clack/prompts")
}, 60_000)
```

Run: `pnpm vitest run test/build.test.ts`
Expected: PASS.

- [ ] **Step 8: Run everything**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/rulecast/src/commands/init.ts packages/rulecast/src/commands/main.ts packages/rulecast/test/helpers/catalog.ts packages/rulecast/test/commands/init.test.ts packages/rulecast/test/commands/help.test.ts packages/rulecast/test/build.test.ts
git commit -m "feat: interactive rulecast init with catalog, conventions, agents and review

Claude goes brr.. via Dash"
```

---

### Task 9: Manual smoke test and plan 4 done

**Files:**
- Modify: `docs/plans/2026-09-15-rulecast-00-index.md`

The prompts need a real terminal. If you cannot drive one, ask the developer to run Steps 3–5 and report what they see. `expect` is also available.

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: `packages/rulecast/dist/cli.js` and a `clack-*.js` chunk next to it.

- [ ] **Step 2: A local catalog and a scratch project**

The GitHub repository is private and has no tags yet, so use a bare clone of this repository as the catalog. Run from the repository root, with `$SCRATCH` a fresh directory in your scratchpad:
```bash
git clone -q --bare . "$SCRATCH/catalog.git"
git -C "$SCRATCH/catalog.git" tag v0.2.0 main
mkdir -p "$SCRATCH/project/app/services" "$SCRATCH/project/.claude" "$SCRATCH/project/.cursor" && cd "$SCRATCH/project" && git init -q
printf '# Backend\n\n## Services\n\nBusiness logic lives in services.\n\n## Errors\n\nServices raise domain exceptions.\n' > AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
printf 'from fastapi import HTTPException\n\ndef get():\n    raise HTTPException(404)\n' > app/services/users.py
```
The clone contains only committed files, so commit plans 4a and 4b first.

- [ ] **Step 3: Run init interactively**

In `$SCRATCH/project`, in a terminal:
```bash
RULECAST_HOME="$SCRATCH/home" RULECAST_CATALOG="$SCRATCH/catalog.git" node <repository root>/packages/rulecast/dist/cli.js init
```
Confirm:
- the Detected line names python, `AGENTS.md (imported by CLAUDE.md)`, `Claude Code (.claude/)` and `Cursor (.cursor/, not supported yet)`;
- rules are grouped as general, python and react, with the three python rules preselected;
- each selected rule offers "keep the package's doc" and `AGENTS.md › Backend › Errors`-style choices;
- Claude Code is preselected, Cursor is shown but cannot be selected, and the scope question offers shared and personal;
- Review lists `.rulecast-config.yaml` and the settings file; after "Write?", `rulecast validate: 3 rules valid` appears (or as many as you kept);
- the drafting prompt appears, and "Copy to clipboard?" puts it on the clipboard (`pbpaste` on macOS).

- [ ] **Step 4: Re-run and cancel**

Run the same command again: the installed rules show as `installed` and cannot be deselected, and Review lists only what is new. Then run it once more and press Ctrl+C at the first prompt: `echo $?` prints `130` and `git status` shows no new changes.

- [ ] **Step 5: Paste the drafting prompt into an agent**

Start your coding agent in `$SCRATCH/project`. The raw GitHub link needs the public repository, so until the repository is public tell the agent to read `<repository root>/agents/DRAFT-RULES.md` instead of the URL, with the rest of the prompt unchanged. Confirm it drafts at least one rule under `repo: local`, runs `rulecast validate` and `rulecast run <id> --all-files --format json`, reports the matches and asks you to keep, edit or drop the rule.

- [ ] **Step 6: Mark plan 4 done**

In `docs/plans/2026-09-15-rulecast-00-index.md`, in row 4 (Interactive init), replace the status cell:
```markdown
| Written, in two parts executed in order: `2026-09-19-rulecast-04a-catalog-docs.md` (tasks 1–2), `04b-init.md` (3–9) |
```
with (today's date as YYYY-MM-DD):
```markdown
| Done (<YYYY-MM-DD>), in two parts executed in order: `2026-09-19-rulecast-04a-catalog-docs.md` (tasks 1–2), `04b-init.md` (3–9) |
```

- [ ] **Step 7: Commit and push**

```bash
git add docs/plans/2026-09-15-rulecast-00-index.md
git commit -m "docs: mark plan 4 (interactive init) done

Claude goes brr.. via Dash"
git fetch
git push origin main
```

Plan 4 is done. Plan 5 (structural and external detectors) comes next.
