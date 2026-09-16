# rulecast — design

**Status:** draft for review (revised after architecture review A–F)
**Date:** 2026-09-15
**Package:** `@syv-ai/rulecast` (npm), public OSS under the syv-ai GitHub org

## 1. Summary

rulecast delivers project conventions to coding agents at the moment they matter: when the agent first touches a file a convention applies to, and when it writes code that violates one. Rules are YAML files that pair a detector with a short message and optional references to convention documents or sections of them (`@conventions/api-access.md#frontend-data-flow`). Agent hooks run the rules, deliver the context, dedupe it against what the agent has already seen, and gate the agent's Stop on new violations. The same rules run from a CLI for humans, CI and agents without hooks.

### Why

`@shadcn/lint` showed the pattern for Tailwind design systems: diagnostics that explain what is wrong *and* what the project wants instead. Its evals found that diagnostics at the moment of violation beat giving the agent the rules text up front: almost every task converged in one correction round, at 10–48% lower correction cost, with the largest gain for weaker models.

`@shadcn/lint` covers styling only, delivers through `npm run lint`, and has no hooks. rulecast generalises the pattern:

- **Any convention**, not just styling: API layering, state management, backend service boundaries, generated code.
- **Any detector**: structural patterns, regexes, paths, existing linters, custom commands, LLM judgement.
- **Just-in-time delivery through agent hooks**, instead of front-loading every rule into `CLAUDE.md` for every session.
- **Author-controlled context**: rules point at the team's own convention documents — whole files or single sections, injected or referenced — and rulecast dedupes them.

rulecast composes with a project's existing general-purpose linters (ruff, ESLint, Oxlint) through the `linter` detector. Design-system rules are not delegated to `@shadcn/lint`: rulecast will own them as a first-party `design-system` detector, specified separately (§18).

### Goals

- One rule format for TypeScript and Python projects.
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
- A rule marketplace or shared rule presets (0.1).

## 2. Concepts

| Concept | Responsibility | Location |
|---|---|---|
| **Rule** | Scope (`files`), one detector, message template, context references, triggers, severity | `.rulecast/rules/**/*.yml` |
| **Convention** | Plain text (usually markdown) for humans and agents. Knows nothing about rules | Anywhere in the repo; `conventions/` by convention |
| **Detector** | Plugin: all selected rules of its kind + files in, findings per rule out | `src/detectors/*` |
| **Adapter** | Plugin: agent input → `Event`; `Delivery` → agent's native output | `src/adapters/*` |
| **Baseline** | Snapshots of files before the agent touched them; decides whether a finding is new | `src/core/baseline` |
| **Session** | What the agent has in context and what it has worked on; decides what to deliver and whether to block | `src/core/session` |
| **Delivery** | Structured result of one event: findings, references, stop decision, warnings | `src/core/delivery` |

## 3. Architecture

Every hook invocation is a fresh process. No module-level mutable state: everything a module needs is passed in, and everything that must outlive the process is on disk under `.rulecast/.state/`.

```
input ──▶ adapter.parse ──▶ Event
                              │
                  compile (config + rules → ready rules + diagnostics)        §5
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
  baseRef?: string                   // verify from the CLI: --base
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
  ref: string                        // "conventions/api-access.md#frontend-data-flow"
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
  events(config: Config): DetectorEvent[]         // default events; a rule's `events` overrides
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

interface Adapter {
  name: string
  maxContextChars: number | null     // budget for commit (§9); null = unlimited
  parse(input: unknown): AdapterInput | null   // null = not an input this adapter handles
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
}
```

`perRule(detect)` is an exported helper that turns a per-rule function `(rule, input) => Promise<Match[]>` into a `run`, catching errors per rule. Simple and third-party detectors use it; detectors that share work across rules implement `run` directly.

## 4. Rule format

One rule per file, exactly one detector per rule. Two detection methods for the same convention are two rules sharing a context reference.

```yaml
# .rulecast/rules/api/no-client-in-components.yml
id: api/no-client-in-components       # unique across the project; dedupe key
files: frontend/src/components/**/*.tsx
ignore: ["**/*.test.tsx"]             # optional
severity: error                       # error | warning
on: [touch, violation]                # default: [violation]
detect:
  ast-grep:
    language: tsx
    rule: { pattern: 'import { $$$NAMES } from "@/client"' }
message: >
  {{file}}:{{line}} imports {{NAMES}} from the generated client.
  Components never talk to the API. Use the feature's query hook.
context:
  - "@conventions/api-access.md#frontend-data-flow"
  - path: "@conventions/state.md"
    mode: read
```

### Fields

- **`id`** — required, unique, `[a-z0-9-]+(/[a-z0-9-]+)*`.
- **`files`** — required, glob or list of globs, repo-relative.
- **`ignore`** — optional globs excluded from `files`.
- **`severity`** — `error` (blocks Stop; CLI exit 1) or `warning` (delivered, never blocks). Default `error`.
- **`on`** — list of `touch` and/or `violation`. Default `[violation]`.
  - `touch`: the first time in a session the agent reads or edits a file matching `files`, the rule's context is delivered with no message. A rule with `on: [touch]` needs no `detect`.
  - `violation`: the detector runs; findings produce messages plus context.
- **`detect`** — required unless `on` is `[touch]`. A single key naming the detector, whose value is that detector's config.
- **`events`** — optional override of the detector events the rule runs on (`edit`, `verify`). Default: the detector's `events(config)`.
- **`message`** — required when `detect` is present. Logic-free template; `{{name}}` placeholders only.
- **`context`** — optional ordered list of references.

### Context references

A reference is a string or an object:

```yaml
context:
  - "@conventions/api-access.md"                     # whole file, project default mode
  - "@conventions/api-access.md#frontend-data-flow"  # one section
  - path: "@conventions/design-system.md#spacing"
    mode: read                                       # override: inject | read
```

- **Path** — repo-relative, prefixed with `@`. Any text file.
- **Anchor** — `.md`/`.mdx` only. A GitHub-style heading slug (`## Frontend data flow` → `#frontend-data-flow`; repeated headings get `-1`, `-2`, …). The section is the heading line and everything after it up to the next heading of the same or a higher level; subsections are included. Headings are recognised by a line scanner (ATX and setext) that skips fenced code blocks.
- **Mode** — `inject` delivers the content into the agent's context. `read` delivers an instruction to read the reference. Default from `context.mode` in the project config.

### Template variables

Always available: `file`, `line`, `column`, `text`, `rule`. Each detector declares the rest through `captures(config)` (§6). An unknown variable is a compile diagnostic.

### Project config

```yaml
# .rulecast/config.yml
rules: .rulecast/rules/**/*.yml       # default
context:
  mode: inject                        # default mode for references: inject | read
  maxBytes: 32768                     # per resolved reference; larger → delivered as read
maxMatchesPerRule: 10                 # agent and terminal rendering only
timeouts:
  editDeadlineMs: 350                 # detection deadline for edit events
  verifyMs: 60000                     # detection timeout for verify events
stopGate:
  maxBlocks: 3                        # per user prompt
llm:
  provider: anthropic                 # anthropic | openai-compatible
  model: claude-haiku-4-5-20251001
  baseUrl: null                       # openai-compatible only
  apiKeyEnv: ANTHROPIC_API_KEY
  maxFilesPerVerify: 10
```

## 5. Compilation

One compilation step turns config and rule files into ready rules plus diagnostics. `hook`, `check`, `validate` and `doctor` all use it, so a hook skips exactly the rules `validate` rejects.

Checks:

- config and rule files parse and match their zod schemas, including each detector's `schema` (which carries synchronous deep checks, e.g. that an ast-grep rule object compiles);
- rule ids are unique;
- `on: [touch]` rules have `context`; other rules have `detect` and `message`;
- globs compile;
- referenced files exist; markdown files with anchors are read and every anchor resolves to a section;
- every template variable is a core variable or in the detector's `captures(config)`.

Referenced content is not read beyond anchor resolution; delivery reads it. Compilation runs in every hook process and must stay within ~20 ms for 30 rules; no compilation cache in 0.1.

Consumers:

- **hook** — rules with diagnostics are skipped; a warning naming them is delivered once per agent context (§9).
- **validate** — prints diagnostics; exit 2 if any.
- **doctor** — compilation, then environment checks (linter binaries, `@ast-grep/napi`, LLM credentials, hook installation), then a dry run of every rule on one matching file.

## 6. Detectors

### Contract

- **Batching.** For each event, the core calls `run` once per detector kind with every selected rule of that kind. Detectors of different kinds run in parallel.
- **Attribution.** Every finding names the rule it belongs to. A finding may be reported for several rules when several rules select it.
- **Errors.** An error with a rule id disables that rule for the session. An error with `rule: null` disables every rule in that run for the session. Either delivers one warning naming the rules.
- **Captures.** Every match carries exactly the names in `captures(config)` for its rule, as strings (possibly empty).
- **Events.** `events(config)` gives the default events, so one detector kind can place slow tools on `verify` only.
- **Cancellation.** Detectors observe `signal`. Work still running when it fires is discarded (§13).
- **Cache.** Detectors that persist work use `cache`, keyed by content hashes. No module-level state.

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

Uses `@ast-grep/napi`. Parses each file once per language and runs every rule for that language against the parsed tree. Captures: metavariable names found anywhere in the rule object (`$NAME` → `NAME`, `$$$NAMES` → `NAMES`, multi-node captures comma-joined). Events: `edit`, `verify`.

### `command`

```yaml
detect:
  command:
    run: ["uv", "run", "python", "scripts/check_layers.py", "{{files}}"]
    output: json            # json | sarif
    captures: [layer, target]
```

Runs the command once per rule via `perRule`, with the rule's files substituted for `{{files}}` (or appended). `json` output is an array of `{ file, line, endLine?, column?, text?, ...captures }`; `sarif` output is read as SARIF 2.1.0 results. Every declared capture must be a string field of every result; a missing one is a rule error. Exit code is ignored; unparseable stdout is a rule error. Captures: as declared. Events: `edit`, `verify`.

### `linter`

```yaml
detect:
  linter: { tool: ruff, rules: [T201] }
```

Runs each tool once per event in JSON mode over the union of files selected by its rules, then attributes findings to rules by linter rule id (all findings when a rule omits `rules`). Tools in 0.1: `ruff`, `oxlint`, `eslint`, resolved from the project (`node_modules/.bin`, `uv run`, then `PATH`). Captures: `message`, `ruleId`. Events: `edit`, `verify` for `ruff` and `oxlint`; `verify` only for `eslint`.

### `llm`

```yaml
detect:
  llm:
    question: >
      Does this route do more than parse input, call a service,
      and return the result? Report each offending line.
    grounding: true         # default: send the rule's context references
```

- **Call shape.** One call per file, covering every llm rule selected for that file. The prompt contains each rule's id and question, the current file with changed lines marked (from `changes`; no marks and a whole-file judgement when the file has no change set), and, for rules with `grounding: true`, the rule's resolved references regardless of their delivery mode. The model is told to report only on changed lines when marks are present, and answers with structured output `{ findings: [{ rule, line, text, reason }] }`.
- **Skip.** Files whose change set is empty are not sent.
- **Events.** `verify` only by default; `events: [edit, verify]` opts in.
- **Providers.** `anthropic` and `openai-compatible` (OpenAI, Azure OpenAI, Ollama and others via `baseUrl`), behind a provider interface.
- **Cache.** Key: hash of file content, change set, model, and the ids, configs and grounding content of the rules in the call. Unchanged files make no calls on repeated verifies.
- **Budget.** At most `llm.maxFilesPerVerify` files per verify, most recently edited first; skipped files are named in a warning.
- **Captures.** `reason`.
- **Consent.** `rulecast init` never creates llm rules. Documentation states that file contents are sent to the configured provider.

## 7. Events

| Event | Claude Code source | Rules selected | Files |
|---|---|---|---|
| `touch` | `PostToolUse` on `Read`; implicit on every `edit` | `touch` rules matching the file, not yet touched in this agent context | the file (no detection) |
| `edit` | `PostToolUse` on `Edit`, `Write` | `violation` rules matching the file whose events include `edit` | the edited file |
| `verify` | `Stop`, `SubagentStop`; `rulecast check` | `violation` rules whose events include `verify` | Stop: work memory's edited files whose content differs from their snapshot; CLI: §12 |
| `prompt` | `UserPromptSubmit` | none | none; resets the agent's stop-block counter |
| `reset` | `SessionStart` with source `compact` | none | none; clears the agent's context memory |

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

A finding is new if its `line`–`endLine` range intersects a changed range of its file, or its file has no baseline. The CLI's `--base <ref>` uses the merge base with `<ref>` as the baseline commit (§12).

**Known miss:** a change that causes a finding on an untouched line (e.g. an unused import after deleting its last use) is classified pre-existing. Accepted for 0.1; a detector-declared `nonLocal` opt-in with cached fingerprints can be added later without breaking detectors.

### Storage

`.rulecast/.state/sessions/<session-id>/baseline.jsonl`: one `start` record with the session-start commit, one record per snapshot (line hashes base64-encoded). Never cleared by `reset`.

## 9. Session

Session owns everything rulecast remembers about a session and every decision about what to deliver.

### Stores

| Store | Contents | Scope | Cleared by |
|---|---|---|---|
| **Context memory** | references delivered (ref → covered range + content hash), touch rules fired, pre-existing summaries shown, rule warnings shown | session + agent | `reset` |
| **Work memory** | edited files; stop-block counter per agent | session | `prompt` resets that agent's counter; nothing clears edited files |

Files: `.rulecast/.state/sessions/<session-id>/work.jsonl` and `context.<agent-id|main>.jsonl`. `.rulecast/.state/` gets its own `.gitignore` containing `*`. Agent id comes from the adapter (Claude Code: `agent_id`, present only inside subagents).

Consequences:

- A subagent has its own context memory, because it has not seen the main agent's context.
- Edited files are shared, so the main agent's Stop re-verifies files its subagents edited.
- Compaction clears context memory but not stop-block counters, so a reset cannot restart a Stop loop.

### Flow

1. **open** — read and fold both stores without a lock.
2. Detection and change sets run outside any lock.
3. **commit** — take the lock, re-read, decide, append, release, return the `Delivery`.

The lock is a lock file per session directory, considered stale after 5 s; it is held only for step 3. Stores are append-only JSONL. A `reset` appends a reset record; folding ignores context records before the last one. An unparseable final line (crash mid-append) is ignored; any other unparseable line is a store error (§14).

### Decisions in commit

**Findings**

- New findings are delivered in full.
- Pre-existing findings are delivered as one summary line per rule per file (`preexistingSummary`), once per agent context; details are available through `rulecast check`.
- Messages of new findings are never deduped across events: a violation that still exists is reported again.
- Within one delivery, identical rendered findings merge with a count.

**References**

1. Collect references from every rule with findings or touches, in order of first appearance; each ref once.
2. Resolve each to a covered range (whole file or section line range) and a content hash.
3. A ref is **covered** when context memory holds a delivery of the same path whose range contains it with the same content hash. Covered refs get state `pointer`. A whole file covers its sections; a section covers its subsections; a section never covers the whole file.
4. Refs with mode `read` get state `read` with reason `mode` and are not recorded as delivered.
5. Refs with mode `inject` larger than `context.maxBytes` get state `read` with reason `tooLarge`.
6. Missing files get state `missing` (compilation normally prevents this).
7. Remaining `inject` refs are recorded as delivered with state `full`, subject to the budget below.

**Budget**

When the adapter declares `maxContextChars`, commit fills the delivery in priority order: new error findings, new warning findings, pre-existing summaries, references in order. Findings and summaries are never dropped; a reference that does not fit gets state `read` with reason `budget` and is not recorded. Renderers never drop content, so what is recorded is what was delivered.

**Agent reads**

A `touch` from a complete read (`completeRead: true`) of a file records that file as delivered in context memory (whole-file range, current content hash). A later reference to that file or any of its sections is a `pointer`. Partial reads record nothing.

**Stop decision** (verify from a stop)

- No new error findings: `allow`.
- New error findings and the agent's stop-block counter is below `stopGate.maxBlocks`: `block`, counter incremented.
- Otherwise: `capReached` (the agent may stop; the delivery lists what remains).
- Only `block` reaches the agent. A stop that does not block records nothing in context memory, so what it would have delivered is delivered again at the next event.

## 10. Rule and file selection

For each event, the core selects `(rule, files)` pairs before detection:

- a rule applies to a file when the file matches `files` and not `ignore`;
- `touch` pairs come from `on: [touch]` rules not yet fired in context memory;
- `edit` and `verify` pairs come from `violation` rules whose effective events include the event;
- rules disabled for the session (compile diagnostics, detector errors) are excluded.

## 11. Delivery rendering

Renderers arrange a `Delivery`; they never filter or truncate references.

- **`renderAgentText`** (shared by agent adapters and `check --format agent`) groups findings by rule, caps each group at `maxMatchesPerRule` lines plus `…and N more in M files`, then lists references.
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

--- conventions/api-access.md#frontend-data-flow ---
<section content>

--- conventions/state.md: read this file before fixing these findings ---
--- conventions/design-system.md#spacing (provided earlier in this session) ---
```

## 12. Adapters and CLI

### Claude Code adapter

Installed by `rulecast init` into `.claude/settings.json`, merged with existing hooks: existing entries are never modified or removed, and a hook whose command runs `rulecast hook claude-code` counts as installed. Every hook runs `rulecast hook claude-code`, or `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code` when rulecast is installed in the project.

| Hook | Matcher | Event | Output | Hook timeout |
|---|---|---|---|---|
| `PostToolUse` | `Read` | `touch` (`completeRead` when `tool_response.file` has `startLine` 1 and `numLines` equal to `totalLines`) | `hookSpecificOutput.additionalContext` | 5 s |
| `PostToolUse` | `Edit\|Write` | `edit` | `hookSpecificOutput.additionalContext` | 5 s |
| `Stop`, `SubagentStop` | — | `verify` | `block`: `{ "decision": "block", "reason": <agent text> }`; `capReached`: `{ "systemMessage": <agent text> }`; `allow`: nothing | `timeouts.verifyMs` + 10 s |
| `UserPromptSubmit` | — | `prompt` | none | 5 s |
| `SessionStart` | `startup\|resume\|compact` | `startup`, `resume`: none, starts warm-up (§13); `compact`: `reset` | none | 5 s |

- **Output limit.** Claude Code injects `additionalContext` of up to 10,000 chars whole and replaces anything longer with a pointer to a saved file plus a 2 KB preview. The adapter declares `maxContextChars` 9,000, so rendering overhead stays under the limit, and cuts output longer than 10,000 chars (possible only when findings alone exceed it) with a line pointing at `rulecast check --format agent`. Block reasons and system messages get the same cut.
- **Block reason.** Starts with a sentence saying the findings come from the project's rulecast rules; without it, agents can read a block as instruction injection.
- Session id from `session_id`; agent id from `agent_id`. File paths come from `tool_input.file_path` (absolute; `tool_response` paths can be relative); the hook command makes them repo-relative and ignores files outside the project.
- `SubagentStop` with an empty `agent_type` is `/compact`'s summariser, not an agent doing work: no `verify`.
- `/clear` and `fork` start a new `session_id`, so they begin with empty stores and need no event. Work from before a `/clear` is not verified at the next Stop: `/clear` starts a new task.
- `rulecast hook` always exits 0 (§14). A directory with no `.rulecast/` above it is not a rulecast project: the hook does nothing and creates no state.

Payloads for every row are recorded from Claude Code 2.1.273 in `test/payloads/claude-code/` (findings in its `README.md`), and the adapter is written against them. Claude Code 2.1.273 has no `MultiEdit` tool.

### CLI

```
rulecast init                   scaffold config, example rule, conventions/, install Claude Code hooks
rulecast check [files...]       verify event
    --base <ref>                files changed since the merge base with <ref>; that merge base is the baseline
    --format terminal|agent|json|sarif   (default: terminal)
    --session <id>              use session stores (agents calling the CLI themselves)
    --no-llm                    skip llm rules
rulecast hook <adapter>         read a hook payload on stdin, write the adapter's output
rulecast validate               print compile diagnostics
rulecast doctor                 compile, check environment, dry-run every rule
rulecast warm [--detector <kind>]...   build detector caches (started detached by hooks; §13)
```

`check` file selection: explicit arguments (what pre-commit passes); otherwise with `--base`, files changed since the merge base; otherwise every file matching any rule's `files`. Without `--base` and `--session` there is no baseline and every finding is new. The CLI adapter maps error findings to exit code 1; it has no stop decision. CI documentation recommends `--base` so llm rules judge only changed files.

A `SETUP.md` in the repo root is written for agents ("Read <url>/SETUP.md and set up rulecast in this project").

## 13. Performance

**Requirement:** the `edit` hook completes in under 500 ms at p95, measured from process start to exit, with a 30-rule project and warm caches, excluding llm rules.

Budget: process start with `@ast-grep/napi` ~80–120 ms; compile and session open ~20 ms; detection and change sets within `timeouts.editDeadlineMs` (350 ms); commit and rendering the remainder.

Mechanisms:

- one detector run per kind per event, kinds in parallel (§6);
- slow tools default to `verify` (`eslint`, `llm`);
- persistent, content-addressed caches for detectors with expensive setup;
- no daemon, no in-process caches.

**Edit deadline.** When `editDeadlineMs` passes, the core aborts outstanding detector runs and delivers what finished. Rules whose results were dropped are written to the debug log, not delivered as warnings; they still run at the next `verify`. The hook then starts `rulecast warm --detector <kind>` detached (stdio ignored, so the hook's exit is not delayed), guarded by a per-detector lock, so an expensive cache build completes in the background instead of being aborted on every edit. `SessionStart` with `startup` or `resume` starts `rulecast warm` for every detector used by a rule that has a `warm` method (§3).

**Perf test.** CI runs a fixture project with 30 rules across ast-grep, regex, path, ruff and command, replays 50 edit events, and fails if p95 exceeds 500 ms.

## 14. Error handling

Hooks fail open; the CLI fails closed.

| Failure | Hook behaviour | CLI |
|---|---|---|
| Compile diagnostic | Rule skipped; warning once per agent context | exit 2 |
| Detector error for a rule | Rule disabled for the session; one warning | exit 2 |
| Detector error for a whole run | All rules in the run disabled for the session; one warning naming them | exit 2 |
| Declared capture missing from a match | Rule error | exit 2 |
| Edit deadline passed | Results dropped; debug log; background warm-up | n/a |
| Verify timeout | Results dropped; warning naming the rules | exit 2 |
| LLM credentials missing | llm rules disabled for the session; one warning | exit 2 unless `--no-llm` |
| Malformed LLM output | Error for the rules in that call | exit 2 |
| Store unreadable or lock not acquired within 2 s | Run without session state for this invocation (every reference `full`, no stop block); warning | n/a |
| Unreadable hook input, unknown adapter, or no `.rulecast/` above the agent's directory | No output | n/a |

Exit codes: `0` no new error findings, `1` new error findings, `2` rulecast itself failed. Hook adapters never exit non-zero on internal failure. All errors are logged to `.rulecast/.state/debug.log`.

## 15. Testing

- **Compile:** schema diagnostics, anchor resolution (slugs, duplicates, setext, fenced code), capture checks.
- **Baseline:** line normalisation, FNV-1a hashing, Myers change sets (insertions, deletions, reindentation), first-writer-wins, fallbacks, classification.
- **Session:** scenario tests driven directly with synthetic findings and events — `touch → edit → edit → reset → edit → verify ×4 → prompt → verify`, sections covered by whole files, agent reads, budget fallbacks, subagent isolation — asserted against golden `Delivery` values. No detectors, no fixture repo.
- **Detector contract suite** (exported): batching attribution, per-rule and whole-run errors, declared captures present on every match, abort handling, empty input. Plus fixture cases per built-in detector.
- **Adapter contract suite** (exported): recorded payloads → `Event` snapshots; `Delivery` → output snapshots.
- **End to end:** a few scenarios through `rulecast hook claude-code` on a fixture repo (TSX + Python).
- **Perf test:** §13.
- **LLM:** recorded-response fake behind the provider interface; one opt-in live test per provider.
- **Dogfooding:** aka-agents2, with rules derived from its `CLAUDE.md` (service/CRUD layering, no `HTTPException` in services, no edits to `frontend/src/client/`, `useUnsavedWork` on close paths).

## 16. Package layout and distribution

Single package with a stable, exported plugin API. Split into multiple packages only when third-party detectors or adapters exist.

```
src/
  core/
    compile/     config + rule loading, schemas, anchors, diagnostics
    detection/   selection, batching, deadline, cache
    baseline/    snapshots, change sets, classification
    session/     stores, lock, commit decisions
    delivery/    Delivery type, renderAgentText
    pipeline.ts
  detectors/     regex/ path/ ast-grep/ command/ linter/ llm/
  adapters/      claude-code/ cli/
  commands/      init check hook validate doctor warm
  index.ts       exports types, perRule, contract suites
test/
  compile/ baseline/ session/ contracts/ payloads/ e2e/ perf/
```

- TypeScript, Node ≥ 20, published to npm as `@syv-ai/rulecast` with a `rulecast` bin.
- Releases via changesets and GitHub Actions.
- Standalone binary via `bun build --compile`, published to GitHub Releases in 0.1.

**Early risk:** the standalone binary must embed `@ast-grep/napi`'s native module. Verified in the first implementation milestone; if it fails, the binary ships without the `ast-grep` detector and `doctor` reports it unavailable.

## 17. Releases

| Release | Scope |
|---|---|
| **0.1** | Everything in this document: compile, detection with batching and deadline, baseline, session, delivery; detectors `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint), `llm` (anthropic, openai-compatible); adapters `claude-code`, `cli`; commands `init`, `check`, `hook`, `validate`, `doctor`, `warm`; perf test; npm package and GitHub Releases binary; dogfooded on aka-agents2 |
| **0.2** | Codex, Cursor and OpenCode adapters (after recording their hook payloads); Biome; rule tests (inline good/bad examples run by `rulecast test`) |
| **0.3** | Evals harness measuring convergence rounds and token cost with and without rulecast; PyPI and Homebrew distribution of the binary |

## 18. Follow-up sub-project: `design-system` detector

A first-party detector for Tailwind design systems (restyling components, raw colors, arbitrary values, inline styles, unknown classes, dynamic classes), with its own spec after 0.1. Decided approach, after a design review of `@shadcn/lint` 0.1.0 (MIT):

- **Not wrapped or forked.** Its load-bearing choices — synchronous ESLint visitors and ~30 module-level in-process caches — are what rulecast's batched, per-invocation detector model replaces. The review also found failures that degrade to "no findings" (component index build errors), an untyped AST core (`any` ×145, 79 in the class-site collector) and a duplicated color-function definition that has already diverged.
- **Rewritten:** project model (on oxc-resolver/oxc-parser), class-site collection, rules, messages, contracts. One project model per detector run, persisted through the detector `cache` and built in the background by `rulecast warm`.
- **Ported as isolated pure functions, with MIT attribution:** class-group classifier trie, color and length math, group→category table, stylesheet `@import` resolution.
- **Acceptance spec:** its 327 RuleTester cases converted into rulecast detector fixtures.
