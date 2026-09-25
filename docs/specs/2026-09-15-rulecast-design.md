# rulecast — design

**Status:** draft for review (revised after architecture review A–F; 2026-09-16: pre-commit-style config, rule repos and interactive init folded in from `2026-09-16-rulecast-pre-commit-format-design.md` and `2026-09-16-rulecast-interactive-init-design.md`; 2026-09-19: re-delivery after compaction, `run` and `install` details from planning)
**Date:** 2026-09-15
**Package:** `@syv-ai/rulecast` (npm), public OSS under the syv-ai GitHub org

## 1. Summary

rulecast delivers project conventions to coding agents at the moment they matter: when the agent first touches a file a convention applies to, and when it writes code that violates one. Rules pair a detector with a short message and optional references to convention documents or sections of them (`@AGENTS.md#frontend-data-flow`). They are configured the way pre-commit hooks are: one `.rulecast-config.yaml` listing rules from pinned rule repos and from the project itself. Agent hooks run the rules, deliver the context, dedupe it against what the agent has already seen, and gate the agent's Stop on new violations. The same rules run from a CLI for humans, CI and agents without hooks.

### Why

`@shadcn/lint` showed the pattern for Tailwind design systems: diagnostics that explain what is wrong *and* what the project wants instead. Its evals found that diagnostics at the moment of violation beat giving the agent the rules text up front: almost every task converged in one correction round, at 10–48% lower correction cost, with the largest gain for weaker models.

`@shadcn/lint` covers styling only, delivers through `npm run lint`, and has no hooks. rulecast generalises the pattern:

- **Any convention**, not just styling: API layering, state management, backend service boundaries, generated code.
- **Any detector**: structural patterns, regexes, paths, existing linters, custom commands, LLM judgement.
- **Just-in-time delivery through agent hooks**, instead of front-loading every rule into `CLAUDE.md` for every session.
- **Author-controlled context**: rules point at the team's own convention documents — whole files or single sections, injected or referenced — and rulecast dedupes them.

rulecast composes with a project's existing general-purpose linters (ruff, ESLint, Oxlint) through the `linter` detector. Design-system rules are not delegated to `@shadcn/lint`: rulecast will own them as a first-party `design-system` detector, specified separately (§18).

### Goals

- One rule format for TypeScript and Python projects, shaped like pre-commit's config so developers recognise it.
- Shared rules published in rule repos and pinned by `rev`, with project overrides.
- Interactive `rulecast init` that sets a project up and hands the developer a prompt for drafting project rules with their own agent.
- Claude Code integration covering first touch, violations, a Stop gate, and context-reset handling.
- An adapter seam that makes Codex, Cursor, OpenCode and others a single-file addition.
- A CLI usable by humans, CI and any agent.
- Legacy-friendly: never block an agent on violations that existed before it touched the file.
- Edit hook p95 under 500 ms, LLM rules excluded (§13).

### Non-goals

- Replacing ESLint, Oxlint, ruff or Biome.
- Autofixing code. rulecast informs; the agent fixes.
- Editor/LSP integration.
- A long-running daemon (0.1).
- Managing tool installations. Tools such as mypy, ruff or eslint come from the project's own toolchain.
- Starting or configuring the developer's coding agent from `init`.

## 2. Concepts

| Concept | Responsibility | Location |
|---|---|---|
| **Rule** | Scope (`files`, `exclude`, `types`), one detector, message template, context references, stages, severity | `.rulecast-config.yaml` (`repo: local`) or a rule repo's manifest |
| **Rule repo** | A git repository publishing rules in `.rulecast-rules.yaml`, pinned by projects with `rev` | e.g. `github.com/syv-ai/rulecast`; fetched into the user cache |
| **Convention** | Plain text (usually markdown) for humans and agents. Knows nothing about rules | Any file in the project or a rule repo (`AGENTS.md`, `docs/`, …); no folder name is implied |
| **Detector** | Plugin: all selected rules of its kind + files in, findings per rule out | `src/detectors/*` |
| **Adapter** | Plugin: agent input → `Event`; `Delivery` → agent's native output; hook install for its agent | `src/adapters/*` |
| **Baseline** | Snapshots of files before the agent touched them; decides whether a finding is new | `src/core/baseline` |
| **Session** | What the agent has in context and what it has worked on; decides what to deliver and whether to block | `src/core/session` |
| **Delivery** | Structured result of one event: findings, references, stop decision, warnings | `src/core/delivery` |

## 3. Architecture

Every hook invocation is a fresh process. No module-level mutable state: everything a module needs is passed in, and everything that must outlive the process is on disk in the user cache (§12, Cache and state). The one exception is loading a native module: `@ast-grep/napi` and its dynamic languages register themselves process-globally, so the detector memoises that load (§6). rulecast writes nothing inside the project except the files the developer asks `init` or `install` to write.

```
input ──▶ adapter.parse ──▶ Event
                              │
                  compile (config + manifests → ready rules + diagnostics)    §5
                              │
                  session.open   (read state, no lock)                         §9
                              │
                  select rules × files for the event                           §10
                              │
                  baseline.changes (snapshots → change sets, ms)               §8
                              │
                  detection: one run per detector kind, kinds in parallel,     §6
                  under the edit deadline or verify timeout
                              │
                  baseline.classify (new | preexisting)                        §8
                              │
                  session.commit  (lock: dedupe, budget, stop decision, append) §9
                              │
                           Delivery                                            §11
                              │
                  adapter.format ──▶ stdout + exit code
```

### Core types

```ts
type EventKind = "touch" | "edit" | "verify" | "prompt" | "reset"

interface Event {
  kind: EventKind
  files: string[]                    // repo-relative; empty for prompt/reset
  completeRead?: boolean             // touch from a read: the whole file was read
  baseCommit?: string                // verify from the CLI: the commit the baseline is read from (run --from-ref: the merge base)
  session?: { id: string; agentId?: string }
  cwd: string
}

type DetectorEvent = "edit" | "verify"

interface Match {
  file: string
  line: number                       // 1-based
  endLine: number
  column: number
  text: string                       // matched snippet
  captures: Record<string, string>   // exactly the names the detector declared for this rule
}

interface ChangeSet {
  changedLines: [start: number, end: number][]   // 1-based inclusive ranges in the current file
}

interface Cache {                    // disk-backed, content-addressed, namespaced per detector kind
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

interface ResolvedReference {
  ref: string                        // "docs/api-access.md#frontend-data-flow"
  content: string
}

interface DetectorRun<Config> {
  event: DetectorEvent
  rules: { id: string; config: Config; files: string[]; context: ResolvedReference[] }[]
  changes: ReadonlyMap<string, ChangeSet>   // file absent = no baseline, whole file is new
  cache: Cache
  cwd: string
  signal: AbortSignal                        // edit deadline or verify timeout
}

interface DetectorResult {
  findings: { rule: string; match: Match }[]
  errors: { rule: string | null; message: string }[]   // rule null = the whole run failed
}

interface DetectorWarm<Config> {
  rules: { id: string; config: Config }[]   // every rule of this kind in the project
  cache: Cache
  cwd: string
  signal: AbortSignal
}

interface Detector<Config> {
  kind: string                                    // key under `detect:` in a rule
  schema: ZodType<Config>                         // includes synchronous deep checks
  captures(config: Config): string[]              // template variables every match carries
  events(config: Config): DetectorEvent[]         // default detection stages; a rule's `stages` overrides
  run(input: DetectorRun<Config>): Promise<DetectorResult>
  warm?(input: DetectorWarm<Config>): Promise<void>   // optional: build caches ahead of events (§13)
}

interface Finding {
  rule: string
  severity: "error" | "warning"
  status: "new" | "preexisting"
  file: string
  line: number
  column: number
  message: string                    // template rendered by the core
  count: number                      // identical rendered findings merged
}

interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string                   // state "full" only
  reason?: "mode" | "budget" | "tooLarge"   // state "read" only
}

interface Delivery {
  findings: Finding[]
  preexistingSummary: { rule: string; file: string; count: number }[]
  references: DeliveredReference[]
  touches: string[]                  // rule ids whose context was delivered through touch
  stop: "block" | "allow" | "capReached" | null   // verify from a stop only
  warnings: string[]                 // rulecast's own problems
}

interface AdapterInput {
  cwd: string                        // the agent's directory; the project root is found from it
  event: Event | null                // files may be absolute; the hook command makes them repo-relative
  warmup: boolean                    // start detector warm-up (§13)
}

interface AdapterInstall {
  markers: string[]                  // paths whose presence means the project uses this agent (init); trailing "/" = directory
  scopes: { scope: "shared" | "personal"; file: string }[]   // settings files hooks can be written to
  command(local: boolean): string    // the hook command; local = rulecast is installed in the project
  merge(settings: unknown, command: string, verifyMs: number): { settings: unknown; added: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
}

interface Adapter {
  name: string
  label: string                      // human name, e.g. "Claude Code"
  maxContextChars: number | null     // budget for commit (§9); null = unlimited
  restoredFiles: number              // recently accessed files the agent re-attaches after compaction (§9, reset)
  parse(input: unknown): AdapterInput | null   // null = not an input this adapter handles
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
  install: AdapterInstall | null     // null = the agent has no hooks to install (e.g. the CLI)
}
```

`perRule(detect)` is an exported helper that turns a per-rule function `(rule, input) => Promise<Match[]>` into a `run`, catching errors per rule. Simple and third-party detectors use it; detectors that share work across rules implement `run` directly.

## 4. Rule format

Rules and project settings live in one file at the project root, shaped like pre-commit's `.pre-commit-config.yaml`. The project root is the nearest ancestor directory containing `.rulecast-config.yaml`. Keys are snake_case. One detector per rule; two detection methods for the same convention are two rules sharing a context reference.

```yaml
# .rulecast-config.yaml
minimum_rulecast_version: 0.2.0
files: ""                               # global include regex (default: everything)
exclude: ^vendor/                       # global exclude regex (default: ^$)
default_stages: [edit, verify]

context: { mode: inject, max_bytes: 32768 }
max_matches_per_rule: 10
max_file_bytes: 1048576                 # in-process detectors skip larger files on edit and guard
timeouts: { edit_deadline_ms: 350, verify_ms: 60000 }
stop_gate: { max_blocks: 1 }
llm: { provider: claude-code, base_url: null, api_key_env: ANTHROPIC_API_KEY, max_files_per_verify: 10 }

repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.2.0
    rules:
      - id: python/no-httpexception-in-services
        files: ^app/services/                         # override
        context: ["@AGENTS.md#errors"]                # our doc instead of the package's
      - id: generated-code
        alias: generated-client                        # same rule twice, different scope
        files: ^frontend/src/client/
  - repo: local
    rules:
      - id: api/no-client-in-components
        name: Components never call the API client
        files: ^frontend/src/components/
        types: [tsx]
        exclude: \.test\.tsx$
        severity: error
        detect:
          ast-grep:
            language: tsx
            rule: { pattern: 'import { $$$NAMES } from "@/client"' }
        message: >
          {{file}}:{{line}} imports {{NAMES}} from the generated client.
          Components never talk to the API. Use the feature's query hook.
        context:
          - "@docs/api-access.md#frontend-data-flow"
          - path: "@docs/state.md"
            mode: read
      - id: services-conventions
        name: Service layer conventions
        files: ^app/services/
        stages: [touch]
        context: ["@AGENTS.md#services"]
```

### Top-level keys

| Key | Default | Meaning |
|---|---|---|
| `repos` | required | Repo entries (below) |
| `minimum_rulecast_version` | none | Compile diagnostic when the running rulecast is older |
| `files`, `exclude` | `""`, `^$` | Global regexes applied before every rule's own |
| `default_stages` | none | Stages for rules without `stages` |
| `context.mode` | `inject` | Default mode for references: `inject` or `read` |
| `context.max_bytes` | `32768` | Per resolved reference; larger → delivered as `read` |
| `max_matches_per_rule` | `10` | Agent and terminal rendering only |
| `max_file_bytes` | `1048576` | Larger files are skipped by the in-process detectors (`regex`, `path`, `ast-grep`) on `edit` and `guard`; `verify` always runs (§13) |
| `timeouts.edit_deadline_ms` | `350` | Detection deadline for edit events |
| `timeouts.verify_ms` | `60000` | Detection timeout for verify events |
| `stop_gate.max_blocks` | `1` | Stop blocks per agent per user prompt |
| `llm.provider`, `base_url`, `api_key_env`, `max_files_per_verify` | `claude-code`, `null`, `ANTHROPIC_API_KEY`, `10` | §6 `llm`. `provider` is one of `claude-code`, `opencode`, `anthropic`, `openai-compatible`; `base_url` applies to the last two. No `model`: every llm rule names its own |

### Repo entries

- **`repo`** — a git URL, or `local` for rules defined inline.
- **`rev`** — required for URLs, forbidden for `local`. A tag or full commit SHA; a branch name is a `validate` warning, as in pre-commit.
- **`rules`** — for a URL repo, each entry selects a rule from the repo's manifest (Rule repos, below) by `id` and may override any other key; for `local`, each entry is a complete rule.

The only key renamed from pre-commit is `hooks:` → `rules:`.

### Rule keys

- **`id`** — required. `[a-z0-9-]+(/[a-z0-9-]+)*`, unique within a repo.
- **`alias`** — optional second name, unique across the config, so the same rule can be selected twice with different overrides. Findings and dedupe use `alias` when set.
- **`name`** — required for `local` rules and in manifests. **`description`** — optional, shown by `init`.
- **`files`**, **`exclude`** — regexes searched (not anchored) in the repo-relative path with forward slashes. Defaults `""` and `^$`.
- **`types`**, **`types_or`**, **`exclude_types`** — file-type tags from a built-in extension table (`python`, `ts`, `tsx`, `javascript`, `jsx`, `markdown`, `yaml`, `json`, …). All of `types`, at least one of `types_or`, none of `exclude_types`. Default `types: [file]`.
- **`stages`** — subset of `touch`, `edit`, `verify`:
  - `touch`: the first time in an agent context that the agent reads or edits a matching file, the rule's context is delivered with no message.
  - `edit`, `verify`: the detector runs on that event.
  - Defaults, in order: the rule's `stages`, the config's `default_stages`, then `[touch]` for rules without `detect` or the detector's `events(config)` for rules with one.
- **`minimum_rulecast_version`** — per rule, for manifests.
- **`severity`** — `error` (blocks Stop; CLI exit 1) or `warning` (delivered, never blocks). Default `error`.
- **`detect`** — a single key naming the detector, whose value is that detector's config. Required unless `stages` is `[touch]`; present with `stages: [touch]` is a compile diagnostic.
- **`message`** — required with `detect`. Logic-free template; `{{name}}` placeholders only.
- **`context`** — optional ordered list of references.

A rule applies to a file when the global and rule `files`/`exclude` and the type keys all match.

Not carried over from pre-commit, because rulecast does not run arbitrary executables in managed environments: `entry`, `language`, `language_version`, `additional_dependencies`, `args`, `pass_filenames`, `require_serial`, `always_run`, `fail_fast`, `verbose`, `log_file`. Tools run through the `linter` and `command` detectors.

### Overrides

A config entry for a repo rule is merged over the manifest rule key by key. The merge is shallow: an overridden `detect` or `context` replaces the manifest's value.

### Context references

A reference is a string or an object:

```yaml
context:
  - "@AGENTS.md"                                   # whole file, project default mode
  - "@AGENTS.md#frontend-data-flow"                # one section
  - path: "@docs/design-system.md#spacing"
    mode: read                                     # override: inject | read
```

- **Path** — `@` plus a path relative to a root. Any text file; no folder name is implied. The root is the project root for references written in the project config (`local` rules and overrides of repo rules), and the rule repo's root in the cache for references written in a manifest.
- **Anchor** — `.md`/`.mdx` only. A GitHub-style heading slug (`## Frontend data flow` → `#frontend-data-flow`; repeated headings get `-1`, `-2`, …). The section is the heading line and everything after it up to the next heading of the same or a higher level; subsections are included. Headings are recognised by a line scanner (ATX and setext) that skips fenced code blocks.
- **Mode** — `inject` delivers the content into the agent's context. `read` delivers an instruction to read the reference. Default from `context.mode`.
- **Identity** — rendering and dedupe identify a reference by its source as well as its path. References from a rule repo are labelled `<owner>/<repo>@<rev>:<path>[#anchor]`; a `read` reference from a rule repo gives the agent the absolute path of the fetched file.

### Template variables

Always available: `file`, `line`, `column`, `text`, `rule`. Each detector declares the rest through `captures(config)` (§6). An unknown variable is a compile diagnostic.

### Rule repos

A rule repo has `.rulecast-rules.yaml` at its root: a list of complete rules. A manifest rule is the default for every project that selects it; references in it resolve against the rule repo.

The rulecast repository is itself a rule repo (§16): its root manifest is generated from `packages/rules-*/rules.yaml`, with package-prefixed ids and aliases (`rules-python` → `python/`; `rules-general` publishes its ids unprefixed) and `@` paths rewritten relative to the repo root. `pnpm manifest` (`packages/rulecast/scripts/generate-manifest.ts`) writes it, and `pnpm test` fails when the committed manifest is stale or does not compile. One tag versions the CLI and every rule package.

Fetching:

- A repo is fetched once per `rev` into the cache: a shallow git fetch of that rev into a temporary directory, renamed into place, under a per-repo lock. A partially fetched repo is never read.
- `install`, `run`, `try-repo` and `validate` fetch repos missing from the cache.
- Agent hooks never fetch. A missing repo disables its rules for the session with one warning: `run rulecast install`.

## 5. Compilation

One compilation step turns the project config and the manifests of its pinned repos into ready rules plus diagnostics. `hook`, `run`, `try-repo`, `validate`, `init` and `doctor` all use it, so a hook skips exactly the rules `validate` rejects.

Checks, each diagnostic naming the rule and, for repo rules, the repo and rev:

- the config and every manifest parse and match their zod schemas, including each detector's `schema`, which carries deep checks — e.g. that an ast-grep rule object compiles. Schemas are parsed asynchronously, so a detector may load what it needs to check a config (ast-grep loads its parser) instead of importing it in every process;
- `rev` is present for URL repos and absent for `local`; a branch-like `rev` is a warning;
- each pinned repo is in the cache (hooks) or can be fetched (CLI); its manifest exists;
- every config `id` exists in its repo's manifest; rule identities (`id`, or `alias` when one is given) are unique across the whole config, not only within a repo;
- `minimum_rulecast_version` (config and rules) is not newer than the running rulecast;
- `local` and manifest rules have `name`; rules with `detect` have `message`; `stages: [touch]` rules have `context` and no `detect`;
- `files` and `exclude` regexes compile; type tags are known;
- referenced files exist in their root; markdown files with anchors are read and every anchor resolves to a section;
- every template variable is a core variable or in the detector's `captures(config)`.

Referenced content is not read beyond anchor resolution; delivery reads it. Compilation runs in every hook process and must stay within ~20 ms for 30 rules; no compilation cache in 0.1.

Consumers:

- **hook** — rules with diagnostics are skipped; a warning naming them is delivered once per agent context (§9).
- **validate** — prints diagnostics; exit 2 if any is an error, 0 when the run produced only warnings.
- **init** — validates what it wrote.
- **doctor** — compilation, then environment checks (linter binaries, `@ast-grep/napi`, LLM credentials, hook installation, cache paths), then a dry run of every rule on one matching file, each rule alone so a failure names it. The environment checks belong to the detectors, behind `check` (§6). `llm` rules are not dry-run — a model call costs money — so their `check` is what doctor reports for them instead: is the provider reachable, and does every rule's `model` resolve for it. Errors exit 2; warnings (an uninstalled adapter, a rule no file matches) do not.

## 6. Detectors

### Contract

- **Batching.** For each event, the core calls `run` once per detector kind with every selected rule of that kind. Detectors of different kinds run in parallel.
- **Attribution.** Every finding names the rule it belongs to. A finding may be reported for several rules when several rules select it.
- **Errors.** An error with a rule id disables that rule for the session. An error with `rule: null` disables every rule in that run for the session. Either delivers one warning naming the rules.
- **Captures.** Every match carries exactly the names in `captures(config)` for its rule, as strings (possibly empty).
- **Default stages.** `events(config)` gives the rule's default detection stages, so one detector kind can place slow tools on `verify` only.
- **Cancellation.** Detectors observe `signal`. Work still running when it fires is discarded (§13).
- **Cache.** Detectors that persist work use `cache`, keyed by content hashes. No module-level state, except memoising a native module whose own registration is process-global — `ast-grep` does this, and nothing derived from a rule, project or event may live there.
- **Checks.** A detector may implement `check` to report what its rules need from the environment: binaries, native modules, credentials, a model name a provider can express. `rulecast doctor` runs it for every kind a project uses (§5); nothing else does. It never runs the tool it is asking about.

The contract is exported as a test suite (§15) that third-party detectors run.

### `regex`

```yaml
detect:
  regex: { pattern: 'raise HTTPException\((?<args>.*)\)', flags: "m" }
```

A JavaScript regex over file contents, via `perRule`. Captures: named groups in the pattern. Events: `edit`, `verify`.

### `path`

```yaml
detect:
  path: {}
```

Every selected file is a match at line 1. Used for "do not edit generated code". Captures: none. Events: `edit`, `verify`.

### `ast-grep`

```yaml
detect:
  ast-grep:
    language: python
    rule: { pattern: "raise HTTPException($$$ARGS)", inside: { kind: function_definition } }
```

Uses `@ast-grep/napi`. Parses each file once per language and runs every rule for that language against the parsed tree. Languages: `css`, `html`, `javascript`, `python`, `tsx`, `typescript` — `python` through `@ast-grep/lang-python`, registered at load. Keys: `language` and `rule`, plus optional `constraints` and `utils` (ast-grep's own). Captures: metavariable names found anywhere in the config (`$NAME` → `NAME`, `$$$NAMES` → `NAMES`, multi-node captures comma-joined, `$_NAME` non-capturing). Events: `edit`, `verify`.

### `command`

```yaml
detect:
  command:
    run: ["uv", "run", "python", "scripts/check_layers.py", "{{files}}"]
    output: json            # json | sarif
    captures: [layer, target]
```

Runs the command once per rule via `perRule`, with the rule's files replacing the argv element that is exactly `{{files}}`, or appended when there is none. A rule that selects no files does not run. `sarif` captures are read from a result's `properties`, falling back to the result itself. `json` output is an array of `{ file, line, endLine?, column?, text?, ...captures }`; `sarif` output is read as SARIF 2.1.0 results. Every declared capture must be a string field of every result; a missing one is a rule error. Exit code is ignored; unparseable stdout is a rule error. Captures: as declared. Events: `edit`, `verify`.

### `linter`

```yaml
detect:
  linter: { tool: ruff, rules: [T201] }
```

Runs each tool once per event in JSON mode over the union of files selected by its rules, then attributes findings to rules by linter rule id (all findings when a rule omits `rules`). Tools in 0.1: `ruff`, `oxlint`, `eslint`, resolved from the project: `node_modules/.bin`, then `uv run` for a Python tool in a project with a `pyproject.toml`, then `PATH`. `{{text}}` is the source the finding points at, and a path the tool resolved through a symlink is still matched to the project. A tool that cannot run disables its own rules only, never the other tools in the same run. Captures: `message`, `ruleId`. Events: `edit`, `verify` for `ruff` and `oxlint`; `verify` only for `eslint`.

### `llm`

```yaml
detect:
  llm:
    model: haiku            # required: an alias, or the provider's own model name
    question: >
      Does this route do more than parse input, call a service,
      and return the result? Report each offending line.
    grounding: true         # default: send the rule's context references
```

- **Model.** Required on every rule; there is no project-wide default, so the cost of a rule is always chosen by whoever wrote it. It is either a rulecast alias — `haiku`, `sonnet`, `opus`, `fable`, which each provider maps to its own name so a rule in a shared repo works whatever the reader configured — or the exact name the configured provider uses, passed through untouched. An alias a provider cannot express (every alias under `openai-compatible`) is a per-rule error naming both.
- **Call shape.** One call per file **and model**, covering every llm rule selected for that file with that model. The prompt contains each rule's id and question, the current file with changed lines marked (from `changes`; no marks and a whole-file judgement when the file has no change set), and, for rules with `grounding: true`, the rule's resolved references regardless of their delivery mode. The model is told to report only on changed lines when marks are present, and answers with structured output `{ findings: [{ rule, line, text, reason }] }`.
- **Skip.** Files whose change set is empty are not sent.
- **Stages.** `verify` only by default; `stages: [edit, verify]` opts in.
- **Providers,** behind a provider interface, chosen once per project with `llm.provider`:
  - `claude-code` (the default) — shells out to `claude -p` with `--json-schema`, and needs no API key on a machine signed in to Claude Code. Run lean (`--system-prompt`, `--tools ""`, `--restricted`, `--strict-mcp-config`, `--no-session-persistence`): without those flags it drags Claude Code's system prompt, the project's `CLAUDE.md` and its plugins into every call, measured at 23,046 input tokens against 1,254.
  - `opencode` — shells out to `opencode run`. No schema flag, so the answer is scraped out of its output; the prompt goes in argv, which bounds it at 128 KiB.
  - `anthropic` and `openai-compatible` (OpenAI, Ollama, a gateway) — read `api_key_env`, and both honour `base_url`, each following its own ecosystem's SDK convention: for `anthropic` it is the origin and rulecast appends `/v1/messages`; for `openai-compatible` it carries the version prefix (`http://localhost:11434/v1`) and rulecast appends `/chat/completions`. **Azure OpenAI is out of scope for 0.1** — it needs a per-deployment path with an `api-version` query string and an `api-key` header, which no `base_url` expresses.
- **Cache.** Key: hash of file content, change set, provider, model, and the ids, configs and grounding content of the rules in the call. Unchanged files make no calls on repeated verifies.
- **Budget.** At most `llm.max_files_per_verify` files per verify, most recently edited first; skipped files are named in a warning.
- **Captures.** `reason`.
- **Consent.** `rulecast init` never preselects llm rules. Documentation states that file contents are sent to the configured provider.
- **No prefilter.** A cheap local model deciding *which* files are worth a call — narrowing **Budget** by prediction rather than by recency — is deliberately not part of this design. A System One decision model (Laya, 421M, local, ~65 ms per question) was measured as a candidate and reached recall 1.000 at precision 0.641 on one rule. Recall is the only figure that matters for a router, since a dropped file costs a finding, and that direction is the promising one. It is still declined: one rule on one codebase does not establish recall, and a prefilter trades a **visible** cost for an **invisible** miss. §14 is built on the opposite principle — every cost the budget cuts today is named in a warning, whereas a file rulecast predicted was not worth judging would be a finding nobody is told about. Revisit only with a design that keeps the skip visible. Measurements: `docs/dogfooding/2026-09-25-system-one-models.md`.

## 7. Events

| Event | Claude Code source | Rules selected | Files |
|---|---|---|---|
| `touch` | `PostToolUse` on `Read`; implicit on every `edit` | rules with stage `touch` matching the file, not yet touched in this agent context | the file (no detection) |
| `edit` | `PostToolUse` on `Edit`, `Write` | rules with stage `edit` matching the file | the edited file |
| `verify` | `Stop`, `SubagentStop`; `rulecast run` | rules with stage `verify` | Stop: work memory's edited files whose content differs from their snapshot; CLI: §12 |
| `prompt` | `UserPromptSubmit` from the user | none | none; resets the agent's stop-block counter |
| `reset` | `SessionStart` with source `compact` | touch rules matching the restored files | clears the agent's context memory, then the agent's `restoredFiles` most recently read or edited files (no detection) |

## 8. Baseline

A finding is **new** when it touches a line the agent changed. Findings on unchanged lines are **pre-existing** and never block.

### Snapshots

- On the first read `touch` of a file in a session, the baseline stores a snapshot: `{ fileHash: u32, lines: Uint32Array }`. The implicit touch of an edit never takes a snapshot, because the file already contains the agent's change.
- Each line is normalised by stripping leading and trailing whitespace, then hashed with 32-bit FNV-1a. `fileHash` is FNV-1a over the line-hash array. No file content is stored.
- Snapshots are first-writer-wins: a later touch never replaces one.
- Claude Code's `Edit` requires a prior `Read`, so the snapshot of an edited existing file is taken before the edit. A `Write` or `Edit` arriving with no snapshot (the file was changed through another tool, or the adapter has no read event) falls back to the session-start commit: the file's content at that commit, hashed the same way.
- The session-start commit is `HEAD` recorded at the session's first event. A file absent there, or a session outside git, has no baseline: every finding in it is new.

### Change sets

- For each file, Myers diff between the snapshot's line hashes and the current file's line hashes gives changed line ranges. Equal `fileHash` means no changes; the diff is skipped.
- A pure deletion marks the line after it as changed.
- Whitespace-only edits (reindentation, formatting) produce no changes.
- Change sets are computed once per event and passed to detectors as `changes`.

### Classification

A finding is new if its `line`–`endLine` range intersects a changed range of its file, or its file has no baseline. The CLI's `--from-ref <ref>` uses the merge base of `<ref>` and `HEAD` as the baseline commit (§12).

**Known miss:** a change that causes a finding on an untouched line (e.g. an unused import after deleting its last use) is classified pre-existing. Accepted for 0.1; a detector-declared `nonLocal` opt-in with cached fingerprints can be added later without breaking detectors.

### Storage

`sessions/<session-id>/baseline.jsonl` in the project's cache directory (§12): one `start` record with the session-start commit, one record per snapshot (line hashes base64-encoded). Never cleared by `reset`.

## 9. Session

Session owns everything rulecast remembers about a session and every decision about what to deliver.

### Stores

| Store | Contents | Scope | Cleared by |
|---|---|---|---|
| **Context memory** | references delivered (ref → covered range + content hash), touch rules fired, pre-existing summaries shown, rule warnings shown | session + agent | `reset` |
| **Work memory** | edited files; files each agent read or edited, most recent last; stop-block counter per agent | session | `prompt` resets that agent's counter; nothing clears the file lists |

Files: `sessions/<session-id>/work.jsonl` and `context.<agent-id|main>.jsonl` in the project's cache directory (§12). Agent id comes from the adapter (Claude Code: `agent_id`, present only inside subagents).

Consequences:

- A subagent has its own context memory, because it has not seen the main agent's context.
- Edited files are shared, so the main agent's Stop re-verifies files its subagents edited.
- Compaction clears context memory but not stop-block counters, so a reset cannot restart a Stop loop.
- After compaction an agent's harness may re-attach recently used files to the new context without the tool calls that trigger `touch` (Claude Code re-attaches the 5 most recently read, edited or written files). So a `reset` clears context memory, then delivers the touch context of the agent's `restoredFiles` most recently accessed files, as a `touch` would. The adapter declares `restoredFiles`; 0 means no re-delivery.

### Flow

1. **open** — read and fold both stores without a lock.
2. Detection and change sets run outside any lock.
3. **commit** — take the lock, re-read, decide, append, release, return the `Delivery`.

The lock is a lock file per session directory, considered stale after 5 s; it is held only for step 3. Stores are append-only JSONL. A `reset` appends a reset record; folding ignores context records before the last one. An unparseable final line (crash mid-append) is ignored; any other unparseable line is a store error (§14).

### Decisions in commit

**Findings**

- New findings are delivered in full.
- Pre-existing findings are delivered as one summary line per rule per file (`preexistingSummary`), once per agent context; details are available through `rulecast run`.
- Messages of new findings are never deduped across events: a violation that still exists is reported again.
- Within one delivery, identical rendered findings merge with a count.

**References**

1. Collect references from every rule with findings or touches, in order of first appearance; each ref once.
2. Resolve each to a covered range (whole file or section line range) and a content hash.
3. A ref is **covered** when context memory holds a delivery of the same path whose range contains it with the same content hash. Covered refs get state `pointer`. A whole file covers its sections; a section covers its subsections; a section never covers the whole file.
4. Refs with mode `read` get state `read` with reason `mode` and are not recorded as delivered.
5. Refs with mode `inject` larger than `context.max_bytes` get state `read` with reason `tooLarge`.
6. Missing files get state `missing` (compilation normally prevents this).
7. Remaining `inject` refs are recorded as delivered with state `full`, subject to the budget below.

**Budget**

When the adapter declares `maxContextChars`, commit fills the delivery to a floor first, then to what is left over.

The **floor** is the header and — for every rule that fired, errors before warnings — its first finding together with the doc sections it cites. Each rule is charged as one item, its block measured by the renderer itself (`measureRuleBlock`), so the budget spends the characters the output will actually use. A rule whose item does not fit is **dropped whole**, counted in `omitted.rules`, and any section cited only by dropped rules is dropped with it: a section explaining a finding the agent cannot see explains nothing. A touch rule is never dropped — its reference is the whole delivery, and the session has already recorded the rule as touched.

What is left over is filled in this order, which is the reverse of what is worth losing:

1. **Warnings**, under a ceiling of 15% of the budget, with a trailing "…and N more (run `rulecast validate`)" for the rest. They are charged **after** the floor, so no number of them can cost the agent a finding it could act on: 80 rules that failed to compile measured 13,500 characters against a 9,000 character budget and dropped the one rule that fired. A warning the budget cut is not recorded as warned, so it is offered again. They are also summarised at the source (§14), which is what keeps the count small in the first place.
2. **Reference contents.** A reference whose content does not fit keeps its line and gets state `read` with reason `budget`, and is not recorded as delivered.
3. **Pre-existing summaries.** One that does not fit is counted in `omitted.preexisting` and, like a reference, is not recorded — so it is offered again.
4. **The rules' remaining matches**, one per rule per pass, so a rule that fired forty times cannot crowd out the others, and never past `max_matches_per_rule`. What is left out is counted per rule in `omitted.findings`, which the renderer reports as "…and N more in M files".

Without a limit (`rulecast run`) nothing is trimmed: `json` and `sarif` carry every finding.

**Overflow**

When the floor itself does not fit, the delivery as it stood before the budget touched it is written to `<state dir>/deliveries/<session>-<timestamp>.md`, the three most recent per session are kept, and `overflowPath` names the file. The renderer ends the message with it, so the agent can act on what it was given and read the rest without running a command. A file that cannot be written is not an error: the message is the delivery, and the file is the remainder.

**Guard**

A `guard` event asks whether a write should happen at all. The adapter reports the tool call's intent — a whole file (`content`), or a replacement inside the current one (`find`/`replace`/`all`) — and `propose()` turns it into the file's proposed content plus the character ranges being inserted. A rule with `refuse_write` whose detector fires **inside one of those ranges** refuses the write; the delivery is rendered as usual, so the agent is shown the message and the section it cites in place of the tool's result.

Every uncertainty allows the write, because a refusal the agent cannot act on is worse than a finding delivered a moment late:

- `propose()` returns null — `find` missing, or present twice without `all` — and nothing is refused.
- A match outside the inserted ranges is not the agent's own text. A `path` match is the exception: it is the file, and writing the file is what the rule forbids.
- A detector that errors or passes `timeouts.edit_deadline_ms` produces no findings, so it refuses nothing.
- `refuse_gate.max_refusals` (default 1) caps refusals per rule per file per session, recorded as a `refused` work record. Past the cap the write goes through.
- `refuse_write` requires a detector with `guards: true` (`regex`, `path`, `ast-grep`): one that reads only through the run's `read`. `linter`, `command` and `llm` pass a path to another program, which would judge the file as it still is, so compile rejects them.

A guard takes no snapshots, starts no session, and records nothing as delivered: the write it describes may never happen.

**Grouping**

A rule that fired three or more times, whose `message` is at least 40 characters of literal text, is rendered as the message once — its variables shown as `{name}` — followed by one line per site: the location, then that site's captures, or a packed list of locations when the message has nothing that varies. Below either threshold, or for a message that is nearly all variables (`{{file}}:{{line}} {{text}}`, how a `linter` or `command` rule passes its detector's own wording through), each finding is rendered whole as before. Grouping is lossless — nothing is dropped, it is only not repeated — so it applies at every size, not only near the budget.

**Agent reads**

A `touch` from a complete read (`completeRead: true`) of a file records that file as delivered in context memory (whole-file range, current content hash). A later reference to that file or any of its sections is a `pointer`. Partial reads record nothing.

**Stop decision** (verify from a stop)

- No new error findings: `allow`.
- New error findings and the agent's stop-block counter is below `stop_gate.max_blocks`: `block`, counter incremented.
- Otherwise: `capReached` (the agent may stop; the delivery lists what remains).
- Only `block` reaches the agent. A stop that does not block records nothing in context memory, so what it would have delivered is delivered again at the next event.

## 10. Rule and file selection

For each event, the core selects `(rule, files)` pairs before detection:

- a rule applies to a file when the global and rule `files`/`exclude` regexes and the rule's type keys match (§4);
- `touch` pairs come from rules with stage `touch` not yet fired in context memory;
- `edit` and `verify` pairs come from rules whose effective stages include the event;
- rules disabled for the session (compile diagnostics, detector errors, missing rule repos) are excluded.

## 11. Delivery rendering

Renderers arrange a `Delivery`; they never filter or truncate references.

- **`renderAgentText`** (shared by agent adapters and `run --format agent`) groups findings by rule, caps each group at `max_matches_per_rule` lines plus `…and N more in M files`, then lists references. References from rule repos use their `<owner>/<repo>@<rev>:` label (§4).
- **CLI terminal** — human layout with the same cap.
- **JSON** — the `Delivery` as is.
- **SARIF 2.1.0** — findings as results; references omitted.

Agent text example:

```text
rulecast: 1 rule violated in frontend/src/components/DocumentCard.tsx

error api/no-client-in-components
  frontend/src/components/DocumentCard.tsx:3 imports DocumentsService from the generated client.
  Components never talk to the API. Use the feature's query hook.

pre-existing (not blocking): backend/no-logic-in-routes ×4 in frontend/src/components/DocumentCard.tsx

--- docs/api-access.md#frontend-data-flow ---
<section content>

--- docs/state.md: read this before continuing ---
--- syv-ai/rulecast@v0.2.0:packages/rules-python/errors.md (provided earlier in this session) ---
```

## 12. Adapters and CLI

### Claude Code adapter

Installed by `rulecast install` (and `init`) into `.claude/settings.json` (shared scope) or `.claude/settings.local.json` (personal scope), merged with existing hooks: existing entries are never modified or removed, and a hook whose command runs `rulecast hook claude-code` counts as installed. Every hook runs `rulecast hook claude-code`, or `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code` when rulecast is installed in the project.

| Hook | Matcher | Event | Output | Hook timeout |
|---|---|---|---|---|
| `PreToolUse` | `Edit\|Write` | `guard`, carrying `tool_input` as a write intent (`content`, or `old_string`/`new_string`/`replace_all`) | findings: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <agent text> } }`; nothing to say: nothing | 5 s |
| `PostToolUse` | `Read` | `touch` (`completeRead` when `tool_response.file` has `startLine` 1 and `numLines` equal to `totalLines`) | `hookSpecificOutput.additionalContext` | 5 s |
| `PostToolUse` | `Edit\|Write` | `edit` | `hookSpecificOutput.additionalContext` | 5 s |
| `Stop`, `SubagentStop` | — | `verify` | `block`: `{ "decision": "block", "reason": <agent text> }`; `capReached`: `{ "systemMessage": <agent text> }`; `allow`: nothing | `timeouts.verify_ms` + 10 s |
| `UserPromptSubmit` | — | `prompt` | none | 5 s |
| `SessionStart` | `startup\|resume\|compact` | `startup`, `resume`: none, starts warm-up (§13); `compact`: `reset` | `compact`: `hookSpecificOutput.additionalContext` | 5 s |

- **Output limit.** Claude Code injects `additionalContext` of up to 10,000 chars whole and replaces anything longer with a pointer to a saved file plus a 2 KB preview — a preview that is the first 2 KB, not the part worth reading. The adapter declares `maxContextChars` 9,000 so the budget (§9) keeps output under the limit on its own. Anything still longer is cut at a line break, never mid-word, with a line naming the overflow file when there is one and pointing at `rulecast run --format agent` when there is not. Block reasons and system messages get the same cut.
- **Block reason.** Starts with a sentence saying the findings come from the project's rulecast rules; without it, agents can read a block as instruction injection.
- **Compaction.** `/compact` re-attaches the main agent's 5 most recently read, edited or written files (a partial read comes back whole, an edited file with its current content) without tool calls, so the adapter declares `restoredFiles` 5. `SessionStart` `compact` output has the same 10,000-char limit as `PostToolUse`.
- Session id from `session_id`; agent id from `agent_id`. File paths come from `tool_input.file_path` (absolute; `tool_response` paths can be relative); the hook command makes them repo-relative and ignores files outside the project.
- `SubagentStop` with an empty `agent_type` is `/compact`'s summariser, not an agent doing work: no `verify`.
- `UserPromptSubmit` also fires when a background task finishes, with a `prompt` starting `<task-notification>` and no other distinguishing field. That is not the user: no `prompt` event, so it does not reset the stop gate.
- `/clear` and `fork` start a new `session_id`, so they begin with empty stores and need no event. Work from before a `/clear` is not verified at the next Stop: `/clear` starts a new task.
- `rulecast hook` always exits 0 (§14). A directory with no `.rulecast-config.yaml` above it is not a rulecast project: the hook does nothing and creates no state.
- Install markers for `init`: `.claude/` or `CLAUDE.md`.

Payloads for every row are recorded from Claude Code 2.1.273 in `packages/rulecast/test/payloads/claude-code/` (findings in its `README.md`, including the compaction behaviour recorded with 2.1.278), and the adapter is written against them. Claude Code 2.1.273 has no `MultiEdit` tool.

### CLI

Command names and flags follow pre-commit where it has an equivalent.

| Command | Does |
|---|---|
| `rulecast init [--rules id,id \| --no-rules] [--agent <name>]... [--scope shared\|personal] [--yes]` | Interactive setup (below) |
| `rulecast install [--agent <name>]... [--scope shared\|personal]` | Installs agent hooks (default: every adapter, shared scope), merged without modifying existing entries, and fetches missing rule repos |
| `rulecast uninstall [--agent <name>]...` | Removes only the hook entries rulecast added |
| `rulecast run [RULE_ID] [--all-files \| --files F…] [--from-ref A [--to-ref B]] [--format terminal\|agent\|json\|sarif] [--session <id>] [--no-llm]` | Verify event |
| `rulecast autoupdate [--freeze] [--repo URL]` | Moves each URL repo's `rev` to its latest tag, preserving comments and formatting; `--freeze` writes the commit SHA with a `# frozen: <tag>` comment |
| `rulecast try-repo <path\|url> [RULE_ID] [--ref REV] [run flags]` | Runs a repo's rules against the project without editing the config (for rule authors): a local directory as it is on disk, a URL at `--ref` (default `HEAD`) |
| `rulecast validate [file…]` | Validates `.rulecast-config.yaml` as a config and `.rulecast-rules.yaml` as a manifest, by filename; with no arguments, whichever exist at the root. Exit 2 on diagnostics |
| `rulecast clean [--project]` | Deletes the cache, or only the current project's directory |
| `rulecast hook <adapter>` | Reads a hook payload on stdin, writes the adapter's output |
| `rulecast warm [--detector <kind>]...` | Builds detector caches (started detached by hooks; §13) |
| `rulecast doctor` | Compile, check environment, dry-run every rule; prints cache paths |

**`run` file selection:** explicit `--files`; otherwise `--from-ref A [--to-ref B]`: files changed since the merge base of A and B (B defaults to `HEAD`; without `--to-ref`, changes up to the working tree including untracked files), read from the working tree, with that merge base as the baseline; otherwise `--all-files`: `git ls-files --cached --others --exclude-standard`; otherwise, with `--session`, the session's edited files, as at a Stop; otherwise staged files, as pre-commit does. Without `--from-ref` and `--session` there is no baseline and every finding is new. `RULE_ID` runs that rule only. The CLI adapter maps error findings to exit code 1; it has no stop decision, so a run never counts as a stop block. CI documentation recommends `--from-ref` so llm rules judge only changed files.

### `rulecast init`

Interactive, in the style of `npx skills add` and `gh skill install`. Agent-neutral: only adapter code knows about a specific agent.

1. **Detect.** Stack (file-type tags from `git ls-files`, `pyproject.toml`, `package.json` with `react`), docs, and agents. Docs: `AGENTS.md` at the root and in subdirectories first; a `CLAUDE.md` that imports `@AGENTS.md` is the same document; a `CLAUDE.md` without that import is a doc of its own; then other tracked markdown files except `README*`, `CHANGELOG*`, `LICENSE*` and `node_modules/`. Agents: each adapter's `install.markers`, plus a table of known agents without adapters (Cursor `.cursor/`, Codex `.codex/`).
2. **Catalog.** Fetch the rulecast repo's latest tag and multi-select its rules, grouped by package prefix. Preselected: rules that apply to at least one project file. Rules already configured are shown as installed. If the fetch fails, the step is skipped with a warning.
3. **Conventions.** For each selected rule with `context`: keep the package's doc (default) or choose a heading from the detected docs (`file › heading › subheading`), written as a `context` override.
4. **Agents.** Detected agents with an adapter are selectable and preselected; detected agents without one are shown disabled as "not supported yet". Each selected adapter's scope is chosen from its `install.scopes`.
5. **Review.** Every file `init` will create or change, with a summary. Nothing is written before confirmation; Ctrl+C exits 130 without writing.
6. **Write.** Write or update `.rulecast-config.yaml` (preserving comments), run `install`, run `validate`.
7. **Drafting prompt.** Show a prompt for the developer's own coding agent and offer to copy it (`pbcopy`, `wl-copy`, `xclip`, `clip.exe`; print only when none exists):

   ```
   Read https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/DRAFT-RULES.md
   and follow it to draft rulecast rules for this project from <AGENTS.md | CLAUDE.md | the project's docs>.
   ```

Re-running `init` only adds: new rules, and overrides for newly selected rules. Existing rules and overrides are never changed or removed.

Non-interactive: any choice without a flag takes the detected default; `--yes` skips confirmation and the clipboard question; without a TTY and without `--yes`, `init` prints the planned changes and exits 2. Non-interactive runs print the drafting prompt and never copy it.

### Agent docs

The rulecast repository publishes agent-facing docs under `agents/`, versioned by tag and written like skills (short, task-focused, references loaded on demand). The links require the repository to be public.

| File | Content |
|---|---|
| `agents/SETUP.md` | For agents asked to set rulecast up without the developer running `init`: run `npx @syv-ai/rulecast init --yes --agent <its own adapter>` (so its hooks are installed even when nothing in the project marks it yet), show the developer the resulting config, continue with `DRAFT-RULES.md` |
| `agents/DRAFT-RULES.md` | Read the named doc and the code it describes; propose conventions that can be checked mechanically (prefer `path`, `regex`, `ast-grep`; `llm` only when nothing else expresses it); for each, show the rule, add it under `repo: local`, run `rulecast validate` and `rulecast run <id> --all-files --format json`, report existing matches, and ask the developer to keep, edit or drop it; conventions that cannot be checked become `stages: [touch]` rules; never change repo rules, overrides or code |
| `agents/reference/rule-format.md` | Config and rule keys (§4) |
| `agents/reference/detectors.md` | Each detector's config, captures and default stages (§6) |

### Cache and state

Everything rulecast stores lives in one directory, `$RULECAST_HOME`, else `$XDG_CACHE_HOME/rulecast`, else `~/.cache/rulecast`:

```
repos/<host>_<owner>_<repo>/<rev>/
projects/<first 16 hex of sha256(realpath(project root))>/
  root                          the project path, for doctor and clean
  sessions/<session-id>/        stores and lock (§8, §9)
  cache/<detector kind>/        detector caches
  warm/<kind>/.lock
  debug.log
```

Separate checkouts and worktrees of one repository get separate project directories.

## 13. Performance

**Requirement:** the `edit` hook completes in under 500 ms at p95, measured from process start to exit, with a 30-rule project and warm caches, excluding llm rules.

Budget: process start with `@ast-grep/napi` ~4 ms on top of Node's own start, measured warm (the standalone binary is far slower, §16); compile and session open ~20 ms; detection and change sets within `timeouts.edit_deadline_ms` (350 ms); commit and rendering the remainder.

Mechanisms:

- one detector run per kind per event, kinds in parallel (§6);
- slow tools default to `verify` (`eslint`, `llm`);
- persistent, content-addressed caches for detectors with expensive setup;
- no daemon, no in-process caches.

**Edit deadline.** When `edit_deadline_ms` passes, the core aborts outstanding detector runs and delivers what finished. Rules whose results were dropped are written to the debug log, not delivered as warnings; they still run at the next `verify`. The hook then starts `rulecast warm --detector <kind>` detached (stdio ignored, so the hook's exit is not delayed), guarded by a per-detector lock, so an expensive cache build completes in the background instead of being aborted on every edit. `SessionStart` with `startup` or `resume` starts `rulecast warm` for every detector used by a rule that has a `warm` method (§3).

**File-size ceiling.** The deadline is a timer, and a timer only fires when the event loop is free. `regex` matches inside a `vm` timeout, which V8 honours; `ast-grep` parses in native code, which `TerminateExecution` does not reach, so nothing preempts it — a 2.6 MB TypeScript file measured 762 ms, linearly, which makes 26 MB 7.6 seconds of an agent blocked on its own write. So on `edit` and `guard`, a file over `max_file_bytes` (default 1 MiB) is not given to a detector that runs in this process: `regex`, `path`, `ast-grep` — the same set as `guards: true` (§6), which by contract reads only through `read`. The guard measures the **proposed** content, not the file on disk, because the write has not happened yet. `verify` has seconds to spend and always runs. Skipping is written to the debug log, not delivered as a warning, and does not mark the run failed: it is the same category as a missed deadline.

**Perf test.** A fixture project with 30 rules across ast-grep, regex, path, `linter` (oxlint — the one linter that can be a workspace devDependency, §15) and command, replaying 50 edit events.

**`pnpm perf`, on real hardware, is the measurement.** It builds, replays the events and prints p50/p95/max against the budget, exiting non-zero when p95 misses it. **CI does not measure performance**: a shared runner spawning one subprocess per external tool per event is several times slower than the hardware the promise is made about, so its numbers answer no question anyone has, and a job that goes red because a runner was busy teaches people to ignore CI. The script asserts that every event produced its expected finding — a measurement of a hook that quietly did nothing would be worse than none.

Measured on an Apple M3 Pro: p50 ~207 ms, p95 229–358 ms depending on machine load (2026-09-20, five detectors); **p50 170 ms, p95 187 ms** (2026-09-23, all six). A GitHub `ubuntu-latest` runner measured p50 218–235 ms, p95 237–247 ms on the same fixture — slower and more variable, which is why the budget is checked here and not there. Most of the growth over a regex-only project is subprocess start, one per external tool per event.

**The guard costs a process per write.** `PreToolUse` runs before every Edit and Write, ahead of the tool rather than beside it, and measured **~80 ms** on the same machine (2026-09-23) — the same whether a `refuse_write` rule matches the file or none does, because the time is node starting and the config compiling, not detection. Projects with no `refuse_write` rule pay it too. That is the price of the hook being installed unconditionally, which is what makes adding a refusing rule later work without another `rulecast install`.

## 14. Error handling

Hooks fail open; the CLI fails closed.

| Failure | Hook behaviour | CLI |
|---|---|---|
| Compile diagnostic | Rule skipped; warning once per agent context | exit 2 |
| Detector error for a rule | Rule disabled for the session; one warning | exit 2 |
| Detector error for a whole run | All rules in the run disabled for the session; one warning naming them | exit 2 |
| Declared capture missing from a match | Rule error | exit 2 |
| Edit deadline passed | Results dropped; debug log; background warm-up | n/a |
| File over `max_file_bytes` on edit or guard | Not given to an in-process detector; debug log; not a failure (§13) | n/a: `verify` always runs |
| Verify timeout | Results dropped; warning naming the rules | exit 2 |
| LLM credentials missing | llm rules disabled for the session; one warning | exit 2 unless `--no-llm` |
| Malformed LLM output | Error for the rules in that call | exit 2 |
| Store unreadable or lock not acquired within 2 s | Run without session state for this invocation (every reference `full`, no stop block); warning | n/a |
| Pinned rule repo not in the cache | Its rules disabled for the session; one warning: `run rulecast install` | Fetched; exit 2 if the fetch fails |
| Unreadable hook input, unknown adapter, or no `.rulecast-config.yaml` above the agent's directory | No output | n/a |

**Warnings are summarised above three of a kind.** Compile diagnostics collapse to `N rules failed to compile and were skipped — run rulecast validate.` plus one example, and a kind's detector errors to `N <kind> rules were disabled this session — see debug.log.` plus one example. A moved rule-repo rev or a `minimum_rulecast_version` bump invalidates many rules at once, and an agent mid-session cannot act on eighty of them individually; the detail is in `rulecast validate` and the debug log. The summary is keyed on a digest of the rule ids, not a fixed key, so a rule that breaks later in the session is still announced. The other warning kinds are left alone: each is already one line and names a specific lever (`max_files_per_verify`, `timeouts.verify_ms`) that a generic collapse would throw away.

Exit codes: `0` no new error findings, `1` new error findings, `2` rulecast itself failed. Hook adapters never exit non-zero on internal failure. All errors are logged to the project's `debug.log` in the cache (§12).

## 15. Testing

- **Compile:** config and manifest schema diagnostics, overrides and aliases, reference roots, `files`/`exclude` regexes and type tags, stage defaults, anchor resolution (slugs, duplicates, setext, fenced code), capture checks.
- **Rule repos:** fetching from a local bare git repository as the remote (no network), atomic rename, concurrent fetches, hooks with a missing repo, the monorepo manifest generator and its staleness check.
- **Commands:** `run` file selection per mode, `autoupdate` preserving comments and `--freeze`, `validate` by filename, `install`/`uninstall` round trip, `clean`, cache-home precedence and project hashing.
- **Init:** detection fixtures per doc case (AGENTS.md; CLAUDE.md importing it; standalone CLAUDE.md; `docs/`; nested AGENTS.md), planning to exact file contents including re-runs, end to end with `--yes` and with scripted answers, no-TTY refusal, clipboard command selection, drafting prompt snapshots, and a check that every agent-doc link exists in the repository.
- **Baseline:** line normalisation, FNV-1a hashing, Myers change sets (insertions, deletions, reindentation), first-writer-wins, fallbacks, classification.
- **Session:** scenario tests driven directly with synthetic findings and events — `touch → edit → edit → reset → edit → verify ×4 → prompt → verify`, sections covered by whole files, agent reads, budget fallbacks, subagent isolation, a reset re-delivering the touch context of restored files — asserted against golden `Delivery` values. No detectors, no fixture repo.
- **Detector contract suite** (exported as `detectorContract`): a detector plus a fixture (files, a matching config, optionally a failing one) becomes cases asserting declared kind/captures/events, empty input, exactly the declared captures on every match as strings, batching attribution, abort handling, and that one rule's failure is a per-rule error leaving the others working. Framework-free — the cases throw `node:assert` errors — so the published package never depends on a test runner. Every built-in detector runs them, with its fixture in `test/detectors/fixtures.ts`. Whole-run errors (`rule: null`) are the core's side of the contract and stay in `test/core/detection/run.test.ts`.
- **Adapter contract suite** (exported as `adapterContract`): self-description, `null` for input it does not handle (never an exception), recorded payloads → the expected `AdapterInput`, parsing is pure, well-formed events, deterministic formatting with an exit code of 0 or 1, an empty `Delivery` exiting 0, and `install.merge` being idempotent with `remove` undoing it.
- **Linters:** oxlint runs for real (a devDependency, forwarded into the fixture's `node_modules/.bin`); ruff and eslint are replayed from recordings under `test/payloads/linter/`, with `RULECAST_LINTERS=1` running whichever real binaries the machine has and checking the recordings still describe them.
- **End to end:** a few scenarios through `rulecast hook claude-code` on a fixture repo (TSX + Python).
- **Perf test:** §13.
- **`pnpm test:linux`:** the suite in CI's image (`node:24-bookworm`), because this is written on macOS and the two platforms disagree about what a test can reach. It mounts the repository read-only, copies it in, installs against a cached pnpm store, and runs vitest under a timeout — a hang must fail in minutes and say so, not reproduce the thing it exists to catch. Takes a vitest filter: `pnpm test:linux test/core/delivery`. **Run it before pushing anything that touches the filesystem, spawns a process, or asks the environment a question.** The case that paid for it: a test named `/proc` as a directory it could not write to. macOS has no `/proc`, so it failed instantly and the suite passed in 13 s; Linux has one, and touching it left the vitest worker unable to exit, so every CI run hung until the six-hour job timeout — and took the release workflow with it, because lefthook's pre-push runs the suite inside the changesets action. Nothing on macOS could have caught it, and CI's own `binary` job runs only `test/binary.test.ts`.
- **LLM:** a stub agent CLI in a fixture's `node_modules/.bin` replaying `test/payloads/llm/` for `claude-code` and `opencode`; a local `node:http` server for `anthropic` and `openai-compatible`, which also pins the request each sends. `RULECAST_LLM=1` makes one real call per provider the machine can reach, skipping the others by name and asserting the shape of the answer rather than the model's words. No test in `pnpm test` calls a model or opens a socket to one.
- **Dogfooding:** a private FastAPI + React platform, with rules drafted from its `CLAUDE.md` through the drafting prompt. **Done 2026-09-22** on a throwaway clone; see `docs/dogfooding/2026-09-22-private-platform.md`. Three of the four named conventions (service/CRUD layering, no `HTTPException` in services, no edits to `frontend/src/client/`) were already covered by catalog rules, since the starter catalog was drawn from this project; drafting added a local `path` rule that catches all 17 files of the generated client where the catalog's extension match caught 15. The fourth, `useUnsavedWork` on close paths, became the `llm` rule and found six real issues. It turned up three defects, all fixed: a multi-line match corrupting the message, an unactionable verify-timeout warning, and doctor mislabelling an alias that resolves to itself.

## 16. Package layout and distribution

A pnpm monorepo that is also a rule repo. The CLI keeps a stable, exported plugin API; detectors and adapters split into their own packages only when third-party ones exist.

```
packages/
  rulecast/                  the CLI, published to npm as @syv-ai/rulecast
    src/
      core/
        config/      config and manifest schemas, overrides, reference roots
        compile/     ready rules, anchors, diagnostics
        repos/       cache layout, fetching, latest tag
        detection/   selection, batching, deadline, cache
        baseline/    snapshots, change sets, classification
        session/     stores, lock, commit decisions
        delivery/    Delivery type, renderAgentText
        files.ts     regex and type matching, git ls-files
        pipeline.ts
      detectors/     regex/ path/ ast-grep/ command/ linter/ llm/
      adapters/      claude-code/ cli/
      init/          detect, plan, prompts (@clack/prompts), clipboard, drafting prompt
      commands/      init install uninstall run autoupdate try-repo validate clean hook warm doctor
      index.ts       exports types, perRule, contract suites
    test/
  rules-python/              rules.yaml and the docs its rules reference
  rules-react/
agents/                      agent-facing docs (§12)
.rulecast-rules.yaml         generated manifest (§4)
```

- TypeScript, Node ≥ 20.12 (the floor of `@clack/prompts`), published to npm as `@syv-ai/rulecast` with a `rulecast` bin.
- Releases via changesets and GitHub Actions; one tag versions the CLI and the rule packages.
- **Publishing is npm trusted publishing (OIDC)**, configured on npmjs.com against `syv-ai/rulecast` and `release.yml`, with no environment and direct publish allowed. There is no npm token in this repository: the workflow's `id-token: write` is exchanged for a short-lived credential, and provenance is attested without asking for it. 0.1.0 was published with a bypass-2FA token instead, because trusted publishing is configured on a package's settings page and the package did not exist yet — and that token's publish was *staged* rather than made public until it was approved by hand, which is the behaviour npm is moving all bypass-2FA tokens to (accounts from August 2026, direct publishing from January 2027).
- Standalone binary via `bun build --compile`, published to GitHub Releases in 0.1. **Built natively on each platform** (linux x64/arm64, darwin arm64/x64): `--target` would embed whatever `@ast-grep/napi` resolved on the *building* machine, so a cross-compiled binary carries the wrong native module and fails at the first ast-grep rule, in a way no test on the build machine can see. It is written to `packages/rulecast/binaries/`, not `dist/`, because `files` is `["dist"]` and a 65 MB binary must never reach the npm tarball.
- **Windows is not supported in 0.1.** `core/which.ts` and `detectors/linter/resolve.ts` shell out to `/bin/sh`, `commands/spawn.ts` assumes POSIX detached spawning, and nothing in the suite would catch a regression there.

**Resolved (2026-09-20, plan 5a):** `bun build --compile` embeds both `@ast-grep/napi`'s native module and `@ast-grep/lang-python`'s prebuilt parser; a binary run from a directory with no `node_modules` matches Python patterns. `test/binary.test.ts` keeps it that way, and skips where `bun` is absent. The detector reaches the native module only through a dynamic `import()` with a literal specifier: neither `createRequire` nor a computed specifier is bundled by bun, and must not be used on that path.

Loading the native module costs ~4 ms under Node but ~260 ms inside the binary, which extracts and `dlopen`s it on every run — one `rulecast run` over a one-rule fixture took ~110 ms under Node and ~370 ms as a binary on an Apple M3 Pro. The npm/Node path is the primary distribution and stays fast; the binary's hook latency is a release concern of its own.

## 17. Releases

| Release | Scope |
|---|---|
| **0.1** | Everything in this document: pre-commit-style config, rule repos and the monorepo manifest, compile, detection with batching and deadline, baseline, session, delivery; detectors `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint), `llm` (anthropic, openai-compatible); adapters `claude-code`, `cli`; commands `init`, `install`, `uninstall`, `run`, `autoupdate`, `try-repo`, `validate`, `clean`, `hook`, `warm`, `doctor`; first rule packages; agent docs; perf test; npm package and GitHub Releases binary; public repository; dogfooded on a private FastAPI + React platform |
| **0.2** | Codex, Cursor and OpenCode adapters (after recording their hook payloads); Biome; rule tests (inline good/bad examples run by `rulecast test`); an `azure-openai` llm provider (§6: its deployment path and `api-key` header do not fit `openai-compatible`); **a timeout `llm` rules can actually meet** — dogfooding measured one `haiku` call on a 135-line file at 89 s against the 60 s `verify_ms` default, so either the default rises or `llm` gets a timeout of its own. Not urgent for 0.1: no `llm` rule is ever selected for anyone (§6, Consent), so only a project that deliberately turned one on can meet this, and its warning now names the setting to raise |
| **0.3** | Evals harness measuring convergence rounds and token cost with and without rulecast; PyPI and Homebrew distribution of the binary |
| **Open** | **A compiled rewrite, in Go or Rust, if binary latency becomes the complaint.** §16 is the trigger: a compiled JS executable pays ~260 ms unpacking and `dlopen`ing `@ast-grep/napi` on every run, which the tools in this niche — lefthook, gitleaks, ripgrep — do not, because they are compiled languages distributing a real binary through npm's `optionalDependencies` rather than a JS program impersonating one. The port is smaller than it looks: the config format, the rule semantics, the hook payload contract and the recorded fixtures under `test/payloads/` are language-independent, and they, not the TypeScript, are the specification. What would be rewritten is the detector implementations and the delivery rendering. Not scheduled, and not worth doing while the npm/Node path is the primary distribution |

## 18. Follow-up sub-project: `design-system` detector

A first-party detector for Tailwind design systems (restyling components, raw colors, arbitrary values, inline styles, unknown classes, dynamic classes), with its own spec after 0.1. Decided approach, after a design review of `@shadcn/lint` 0.1.0 (MIT):

- **Not wrapped or forked.** Its load-bearing choices — synchronous ESLint visitors and ~30 module-level in-process caches — are what rulecast's batched, per-invocation detector model replaces. The review also found failures that degrade to "no findings" (component index build errors), an untyped AST core (`any` ×145, 79 in the class-site collector) and a duplicated color-function definition that has already diverged.
- **Rewritten:** project model (on oxc-resolver/oxc-parser), class-site collection, rules, messages, contracts. One project model per detector run, persisted through the detector `cache` and built in the background by `rulecast warm`.
- **Ported as isolated pure functions, with MIT attribution:** class-group classifier trie, color and length math, group→category table, stylesheet `@import` resolution.
- **Acceptance spec:** its 327 RuleTester cases converted into rulecast detector fixtures.
