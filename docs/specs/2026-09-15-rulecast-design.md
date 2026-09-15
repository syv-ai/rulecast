# rulecast — design

**Status:** draft for review
**Date:** 2026-09-15
**Package:** `@syv-ai/rulecast` (npm), public OSS under the syv-ai GitHub org

## 1. Summary

rulecast delivers project conventions to coding agents at the moment they matter: when the agent first touches a file a convention applies to, and when it writes code that violates one. Rules are YAML files that pair a detector with a short message and optional references to convention documents (`@conventions/api-access.md`). Agent hooks run the rules, render the context, dedupe it against what the agent has already seen this session, and inject it. The same rules run from a CLI for humans, CI and agents without hooks.

### Why

`@shadcn/lint` showed the pattern for Tailwind design systems: diagnostics that explain what is wrong *and* what the project wants instead. Its evals found that diagnostics at the moment of violation beat giving the agent the rules text up front: almost every task converged in one correction round, at 10–48% lower correction cost, with the largest gain for weaker models.

`@shadcn/lint` covers styling only, delivers through `npm run lint`, and has no hooks. rulecast generalises the pattern:

- **Any convention**, not just styling: API layering, state management, backend service boundaries, generated code.
- **Any detector**: structural patterns, regexes, paths, existing linters, custom commands, LLM judgement.
- **Just-in-time delivery through agent hooks**, instead of front-loading every rule into `CLAUDE.md` for every session.
- **Author-controlled context**: rules point at the team's own convention documents, which are injected verbatim and deduped.

rulecast composes with existing linters rather than replacing them. In a shadcn project, `@shadcn/lint` stays the styling engine; a rulecast rule can attach the team's design conventions to its findings.

### Goals

- One rule format for TypeScript and Python projects.
- Claude Code integration covering first touch, violations, a Stop gate, and context-reset handling.
- An adapter boundary that makes Codex, Cursor, OpenCode and others a single-file addition.
- A stateless CLI usable by humans, CI and any agent.
- Legacy-friendly: never block an agent on violations that existed before it started.

### Non-goals

- Replacing ESLint, Oxlint, ruff, Biome or `@shadcn/lint`.
- Autofixing code. rulecast informs; the agent fixes.
- Editor/LSP integration.
- A rule marketplace or shared rule presets (0.1).

## 2. Concepts

| Concept | Responsibility | Location |
|---|---|---|
| **Rule** | Scope (`files`), one detector, message template, `@` context references, triggers, severity | `.rulecast/rules/**/*.yml` |
| **Convention** | Plain text (usually markdown) for humans and agents. Knows nothing about rules | Anywhere in the repo; `conventions/` by convention |
| **Detector** | Plugin: files + config in, `Match[]` out | `src/detectors/*` |
| **Adapter** | Plugin: agent hook payload → `Event`; `Response` → agent's native output | `src/adapters/*` |
| **Ledger** | Per-session record of what has been injected, touched and edited | `.rulecast/.state/` |

## 3. Architecture

```
agent hook ──stdin──▶ adapter.parse ──▶ Event
                                          │
                   select rules (files glob × event kind × rule.on)
                                          │
                   detectors.run ──▶ Match[]
                                          │
                   baseline filter (drop pre-existing, git HEAD)
                                          │
                   render: message per match + resolve @ references
                                          │
                   ledger: group, dedupe, record injections
                                          │
adapter.format ◀── Response
```

### Core types

```ts
type EventKind = "touch" | "edit" | "stop" | "reset"

interface Event {
  kind: EventKind
  files: string[]            // repo-relative
  session?: { id: string; agentId?: string }
  cwd: string
}

interface Response {
  context?: string           // text to inject into the agent's context
  block?: { reason: string } // stop gate: refuse to finish
}

interface Match {
  file: string
  line: number
  column: number
  text: string                        // matched snippet
  captures: Record<string, string>    // detector-specific template variables
}

interface Detector<Config> {
  kind: string                        // key under `detect:` in a rule
  schema: ZodType<Config>
  defaultEvents: EventKind[]          // events the detector runs on unless the rule overrides
  run(input: { files: string[]; config: Config; cwd: string; signal: AbortSignal }): Promise<Match[]>
}

interface Adapter {
  name: string
  supports: EventKind[]
  parse(payload: unknown): Event | null     // null = event rulecast ignores
  format(response: Response, event: Event): { stdout: string; exitCode: number }
}
```

The core only sees `Event` and `Response`. An adapter for an agent without a `touch` or `stop` event omits it from `supports`; nothing else changes. The CLI is an adapter too.

## 4. Rule format

One rule per file, exactly one detector per rule. Two detection methods for the same convention are two rules sharing a `context` reference.

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
  - "@conventions/api-access.md"
  - "@frontend/src/features/documents/queries.ts"
```

### Fields

- **`id`** — required, unique, `[a-z0-9-]+(/[a-z0-9-]+)*`.
- **`files`** — required, glob or list of globs, repo-relative.
- **`ignore`** — optional globs excluded from `files`.
- **`severity`** — `error` (blocks Stop; CLI exit 1) or `warning` (injected, never blocks). Default `error`.
- **`on`** — list of `touch` and/or `violation`. Default `[violation]`.
  - `touch`: the first time in a session the agent reads or edits a file matching `files`, the rule's `context` is injected with no message. A rule with `on: [touch]` only needs no `detect`.
  - `violation`: the detector runs; matches produce messages plus `context`.
- **`detect`** — required unless `on` is `[touch]`. A single key naming the detector, whose value is that detector's config.
- **`events`** — optional override of which events the detector runs on (`edit`, `stop`). Default: the detector's `defaultEvents`.
- **`message`** — required when `detect` is present. Logic-free template; `{{name}}` placeholders only.
- **`context`** — optional ordered list of `@path` references, repo-relative. Any text file. Whole files are injected verbatim.

### Template variables

Always available: `file`, `line`, `column`, `text`, `rule` (the rule id). Detectors add captures:

| Detector | Captures |
|---|---|
| `ast-grep` | metavariables (`$NAME` → `NAME`, `$$$NAMES` → `NAMES`, comma-joined) |
| `regex` | named groups |
| `path` | none beyond the defaults |
| `command` | fields from the command's output (see §5) |
| `linter` | `message`, `ruleId` |
| `llm` | `reason` |

An unknown variable is a validation error.

### Project config

```yaml
# .rulecast/config.yml
rules: .rulecast/rules/**/*.yml       # default
maxContextBytes: 32768                # per referenced file
maxMatchesPerRule: 10                 # further matches summarised as "and N more in M files"
timeouts:
  detectorMs: 10000
  llmMs: 60000
  hookMs: 90000                       # total budget per hook invocation
stopGate:
  maxBlocks: 3
llm:
  provider: anthropic                 # anthropic | openai-compatible
  model: claude-haiku-4-5-20251001
  baseUrl: null                       # openai-compatible only
  apiKeyEnv: ANTHROPIC_API_KEY
  maxFilesPerStop: 10
```

Rules and config are validated with zod at load. `rulecast validate` reports schema errors, globs matching nothing, missing `@` files, `@` files over `maxContextBytes`, duplicate ids, and unknown template variables.

## 5. Detectors (0.1)

All detectors receive only the files selected for the event (see §7) and return `Match[]`.

### `regex`

```yaml
detect:
  regex: { pattern: 'raise HTTPException\((?<args>.*)\)', flags: "m" }
```

Runs a JavaScript regex over file contents. Default events: `edit`, `stop`.

### `path`

```yaml
detect:
  path: {}            # every file matching `files` is a match
```

Matches the file itself (line 1). Used for "do not edit generated code" (`files: frontend/src/client/**`). Default events: `edit`, `stop`.

### `ast-grep`

```yaml
detect:
  ast-grep:
    language: python
    rule: { pattern: "raise HTTPException($$$ARGS)", inside: { kind: function_definition } }
```

Uses `@ast-grep/napi`. The `rule` value is an ast-grep rule object (pattern, kind, relational and composite rules). Languages: those built into `@ast-grep/napi` plus Python. Default events: `edit`, `stop`.

### `command`

```yaml
detect:
  command:
    run: ["uv", "run", "python", "scripts/check_layers.py", "{{files}}"]
    output: json      # json | sarif
```

Runs a command with the selected files appended (or substituted for `{{files}}`). `json` output is an array of `{ file, line, column?, text?, ...captures }`; extra string fields become captures. `sarif` output is read as SARIF 2.1.0 results. Exit code is ignored; stdout parsing failure is a detector error. Default events: `edit`, `stop`.

### `linter`

```yaml
detect:
  linter: { tool: oxlint, rules: [shadcn/no-restyle] }
```

Runs a known linter in JSON mode on the selected files and keeps findings whose rule id is in `rules` (all findings if `rules` is omitted). Tools in 0.1: `eslint`, `oxlint`, `ruff`. The linter is resolved from the project (`node_modules/.bin`, `uv run`, then `PATH`). Default events: `edit`, `stop`.

### `llm`

```yaml
detect:
  llm:
    question: >
      Does this route do more than parse input, call a service,
      and return the result? Report each offending line.
    grounding: true   # default: send the rule's `context` files with the question
```

For each selected file the detector sends: the question, the full file, the file's diff against the baseline ref (§8), and — when `grounding` is true — the rule's `context` files. The model is instructed to report violations only on changed lines and to answer with structured output `{ violations: [{ line, text, reason }] }`, which maps to `Match[]` with a `reason` capture. Files with no diff against the baseline are skipped. When there is no baseline ref (CLI without `--base`, or a file outside git), no diff is sent and the model judges the whole file.

- **Default events:** `stop` only. `events: [edit, stop]` opts in to per-edit judging.
- **Providers:** `anthropic` (Anthropic API) and `openai-compatible` (OpenAI, Azure OpenAI, Ollama and others via `baseUrl`). Model from rule or project config.
- **Cache:** results are cached in `.rulecast/.state/llm-cache/` under `sha256(rule id + detector config + model + file content + diff + grounding content)`. Shared across sessions. Re-running Stop on unchanged files makes no calls.
- **Budget:** at most `llm.maxFilesPerStop` files judged per Stop, most recently edited first; skipped files are listed in a warning.
- **Consent:** `rulecast init` never creates `llm` rules. Documentation states that file contents are sent to the configured provider.

## 6. Rendering the injected context

For one response:

1. Group matches by rule, in rule id order.
2. Render `message` for each match. Identical rendered lines merge with a count. More than `maxMatchesPerRule` lines are cut to that many plus `…and N more in M files`.
3. Collect every `@` reference from every triggered rule (violations and touches). Each distinct file appears once, in order of first appearance.
4. For each reference, consult the ledger (§7): inject the full content, or a pointer line if already injected with the same content hash.

Output shape (Claude Code `additionalContext`, CLI `--format agent`):

```text
rulecast: 2 rules violated in frontend/src/components/DocumentCard.tsx

error api/no-client-in-components
  frontend/src/components/DocumentCard.tsx:3 imports DocumentsService from the generated client.
  Components never talk to the API. Use the feature's query hook.

warning design/no-restyle
  frontend/src/components/DocumentCard.tsx:41 "p-4" is not allowed on <Button>: <Button> owns its spacing. (×2)

--- conventions/api-access.md ---
<file contents>

--- conventions/design-system.md (provided earlier in this session) ---
```

A missing `@` file or one over `maxContextBytes` renders as `--- <path> (missing) ---` or `--- <path> (too large to inject: N bytes) ---` and never suppresses the messages.

## 7. Events, ledger and dedupe

### Event semantics

| Event | Rules selected | Files given to detectors |
|---|---|---|
| `touch` | Rules with `touch` in `on` whose `files` match, not yet in the ledger's `touched` set | none (no detection) |
| `edit` | Rules with `violation` in `on` whose `files` match the edited file and whose detector events include `edit` | the edited file |
| `stop` | Rules with `violation` in `on` whose detector events include `stop` | files in the ledger's `edited` set matching `files` |
| `reset` | none | none; clears ledger state (below) |

An `edit` event also counts as a `touch` for that file, so the first edit of a file the agent never read still delivers touch context.

### Ledger

Stored as an append-only JSONL log at `.rulecast/.state/sessions/<session-id>[.<agent-id>].jsonl`. `.rulecast/.state/` gets its own `.gitignore` containing `*`. Folded on read into:

```json
{
  "injected": { "conventions/api-access.md": "sha256:9f2…" },
  "touched": ["api/no-client-in-components"],
  "edited": ["frontend/src/components/DocumentCard.tsx"],
  "reportedPreexisting": ["sha256:41c…"],
  "stopBlocks": 1
}
```

Each hook invocation holds a lock file (`<log>.lock`, stale after `timeouts.hookMs`) across its read–decide–append step, so concurrent hooks from parallel tool calls cannot inject the same reference twice.

The ledger is keyed by session id plus agent id when the adapter provides one, because a subagent has its own context window and has not seen the main agent's injections.

### Dedupe levels

1. **Per response, per rule** — grouping and merging as in §6.
2. **Per response, per reference** — each `@` file at most once.
3. **Per session, per reference** — a reference whose path and content hash are in `injected` renders as a pointer. A changed file is injected again.

Messages are never deduped across the session. A violation that still exists is reported on every relevant event.

### Reset

A `reset` event clears `injected`, `touched` and `reportedPreexisting`. `edited` and `stopBlocks` are kept. Adapters emit `reset` whenever the agent's context may have lost earlier injections (Claude Code: compaction and `/clear`).

### Stop gate

On `stop`, if any `error`-severity match remains after the baseline filter and `stopBlocks < stopGate.maxBlocks`, the response blocks with the rendered report and `stopBlocks` increments. At the cap, the response does not block and injects a warning listing the remaining violations.

## 8. Baseline

Violations that existed before the session must not block the agent.

- **Baseline ref:** `HEAD` in hooks; `--base <ref>` in the CLI (default: none, all findings reported).
- **Fingerprint:** `sha256(rule id + file path + normalised match text + occurrence index of that text in the file)`. Line numbers are excluded so unrelated edits above a violation do not change it. Normalisation collapses whitespace.
- **Filter:** for non-LLM detectors, the detector also runs on the baseline version of the file (`git show <ref>:<path>`, written to a temp file with the same extension); matches whose fingerprint appears in the baseline are pre-existing. Baseline results are cached per blob hash in `.rulecast/.state/baseline-cache/`.
- Pre-existing `error` matches are reported as warnings the first time their fingerprint is seen in a session (tracked in the ledger's `reportedPreexisting`), are omitted afterwards, and never block.
- New files and files outside git have an empty baseline.
- LLM rules use the diff-scoped prompt (§5) instead of a baseline run.

## 9. Claude Code adapter

Installed by `rulecast init` into `.claude/settings.json`, merged with existing hooks (existing entries are never modified or removed). Every hook runs `rulecast hook claude-code`, with the hook's `timeout` set to `timeouts.hookMs` rounded up to seconds.

| Claude Code hook | Matcher | rulecast event | Output |
|---|---|---|---|
| `PostToolUse` | `Read` | `touch` (file from `tool_input.file_path`) | `hookSpecificOutput.additionalContext` |
| `PostToolUse` | `Edit\|MultiEdit\|Write` | `edit` (+ implicit `touch`) | `hookSpecificOutput.additionalContext` |
| `Stop`, `SubagentStop` | — | `stop` | `{ "decision": "block", "reason": … }` when blocking; `systemMessage` with remaining warnings when not blocking |
| `SessionStart` | `compact\|clear` | `reset` | none |

Session id comes from `session_id`; agent id from the subagent identifier field in the payload when present.

**Before implementation:** record real payloads for every row above from the current Claude Code release into `test/payloads/claude-code/`, confirm the subagent identifier field name, and confirm how `SubagentStop` blocking and `SessionStart` sources are reported. The adapter is written against those recordings, not against documentation alone.

## 10. CLI

```
rulecast init                 scaffold config, example rule, conventions/, install Claude Code hooks
rulecast check [files...]     run violation rules (all matching files if none given)
    --format terminal|agent|json|sarif   (default: terminal)
    --base <ref>              drop findings present at <ref>
    --session <id>            enable the ledger (for agents calling the CLI themselves)
    --no-llm                  skip llm rules
rulecast hook <adapter>       read a hook payload on stdin, write the adapter's response
rulecast validate             validate config and rules
rulecast doctor               check linter/ast-grep availability, hook installation, LLM credentials; dry-run every rule
```

Without `--session`, `check` is stateless and prints full context for every reference.

A `SETUP.md` in the repo root is written for agents ("Read <url>/SETUP.md and set up rulecast in this project"), in the style of `@shadcn/lint`.

## 11. Error handling

Hooks fail open; CLI fails closed.

| Failure | Hook behaviour | CLI |
|---|---|---|
| Invalid config or rule | Rule skipped; one warning per session naming the rule and `rulecast validate` | exit 2 |
| Detector error or missing binary | Rule disabled for the session; one warning | exit 2 |
| Detector or hook timeout | Result dropped; warning with rule id | exit 2 |
| LLM credentials missing | LLM rules skipped; one warning | exit 2 unless `--no-llm` |
| Malformed LLM output | Treated as no matches; logged | exit 2 |
| Missing or oversized `@` file | Placeholder line (§6); messages still delivered | exit 2 from `validate` |
| Ledger unreadable or lock timeout | Run stateless for this invocation; start a new log | n/a |

Exit codes: `0` clean, `1` violations of `error` severity, `2` rulecast itself failed. Hook adapters never exit non-zero on internal failure. All errors are logged to `.rulecast/.state/debug.log`.

## 12. Testing

- **Unit:** rule selection, template rendering, grouping, reference dedupe, fingerprinting, ledger folding, reset semantics.
- **Detector contract suite:** a shared suite every detector passes (abort handling, empty input, repo-relative paths, capture naming), plus fixture directories per case with snapshot `Match[]`. Exported for third-party detectors.
- **Adapter contract suite:** recorded real payloads → `parse` → `Event` snapshots; `Response` → `format` → output snapshots. Exported for third-party adapters.
- **Scenario tests:** a fixture repo (TSX + Python) and scripted event sequences — e.g. `touch → edit → edit → reset → edit → stop → stop → stop → stop` — asserted against golden files of every injected context and block decision. These cover dedupe, reset, baseline and the stop cap.
- **LLM detector:** provider calls behind the provider interface; tests use a recorded-response fake. One opt-in live test per provider, skipped without credentials.
- **Dogfooding:** aka-agents2, with rules derived from its `CLAUDE.md` (service/CRUD layering, no `HTTPException` in services, no edits to `frontend/src/client/`, `useUnsavedWork` on close paths) and `@shadcn/lint` wrapped through the `linter` detector once its shadcn migration lands.

## 13. Package layout and distribution

Single package with a stable, exported plugin API. Split into multiple packages only when third-party detectors or adapters exist.

```
src/
  core/         pipeline, rule loading + schema, render, ledger, baseline
  detectors/    regex/ path/ ast-grep/ command/ linter/ llm/
  adapters/     claude-code/ cli/
  commands/     init check hook validate doctor
  index.ts      exports Detector, Adapter, Event, Response, Match, contract suites
test/
  unit/ contracts/ payloads/ scenarios/
```

- TypeScript, Node ≥ 20, published to npm as `@syv-ai/rulecast` with a `rulecast` bin.
- Releases via changesets and GitHub Actions.
- Standalone binary via `bun build --compile` for projects without Node, published to GitHub Releases in 0.1.

**Early risk:** the standalone binary must embed `@ast-grep/napi`'s native module. This is verified in the first implementation milestone; if it fails, the binary ships without the `ast-grep` detector and reports it as unavailable in `doctor`.

## 14. Releases

| Release | Scope |
|---|---|
| **0.1** | Everything in this document: pipeline, rule format, `validate`, ledger/dedupe/reset, baseline, Stop gate; detectors `regex`, `path`, `ast-grep`, `command`, `linter` (eslint, oxlint, ruff), `llm` (anthropic, openai-compatible); adapters `claude-code`, `cli`; commands `init`, `check`, `hook`, `validate`, `doctor`; npm package and GitHub Releases binary; dogfooded on aka-agents2 |
| **0.2** | Codex, Cursor and OpenCode adapters (after recording their hook payloads); Biome linter support; rule tests (inline good/bad examples run by `rulecast test`) |
| **0.3** | Evals harness measuring convergence rounds and token cost with and without rulecast; PyPI and Homebrew distribution of the binary |
