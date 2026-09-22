# rulecast Plan 6a — LLM settings, the provider interface and the `claude-code` provider Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the `llm` detector needs except the detector: project-level `llm` settings reaching a detector run, a model-alias table, and one working provider — `claude-code`, which shells out to `claude -p` and needs no API key at all.

**Architecture:** A provider is a small interface, `ask(request) => Promise<LlmFinding[]>`, with one implementation per backend under `src/detectors/llm/providers/`. The two CLI providers spawn a binary and read stdout; the two HTTP providers (plan 6c) `fetch`. Model names are written as short aliases (`haiku`) that a table maps to whatever each provider wants (`haiku` for the Claude Code CLI, `claude-haiku-4-5-20251001` for the Anthropic API, `anthropic/claude-haiku-4-5-20251001` for OpenCode); a string that is not an alias is passed through verbatim, so an Ollama tag or a brand-new model id needs no rulecast release. Project `llm` settings reach the detector through a new `settings` field on `DetectorRun`, because a detector run is the only thing the core hands a detector.

**Tech Stack:** Node ≥ 20.12 (`node:child_process.spawn`, global `fetch`), TypeScript 5, zod 3, vitest.

Prerequisite: plan 5 is done (`e3f8831`). Continue with `2026-09-21-rulecast-06b-detector.md`, then `06c-providers-catalog.md`.

---

## Decisions this plan implements

1. **`model` is a required key on every `llm` rule; the project-level `llm.model` setting is removed.** (The user's decision, 2026-09-20: "No default model … so cost is always an explicit choice by whoever writes the rule.") A rule author knows how hard their own question is; a project-wide default hides the cost of every rule behind one line someone set once. `.rulecast-config.yaml` is `.strict()`, so a config that still carries `llm.model` fails to load with a clear unknown-key error, which is the migration signal.

   The consequence, in 6b: spec §6's "one call per file" becomes **one call per (file, model)** — two rules that name different models cannot share a call.

2. **Models are written as aliases, with verbatim passthrough.** (The user's decision, 2026-09-21.) The three backends disagree about what a model is called:

   | Alias | `claude-code` | `anthropic` | `opencode` | `openai-compatible` |
   |---|---|---|---|---|
   | `haiku` | `haiku` | `claude-haiku-4-5-20251001` | `anthropic/claude-haiku-4-5-20251001` | — |
   | `sonnet` | `sonnet` | `claude-sonnet-5` | `anthropic/claude-sonnet-5` | — |
   | `opus` | `opus` | `claude-opus-5` | `anthropic/claude-opus-5` | — |
   | `fable` | `fable` | `claude-fable-5-1` | `anthropic/claude-fable-5-1` | — |

   Anything not in the left column is handed to the provider exactly as written (`gpt-5-mini`, `qwen3-coder:30b`, `claude-haiku-4-5-20251001`). This is the only way an `llm` rule shipped in a rule repo works for a reader who uses a different provider from its author. An alias that **is** in the table but has no mapping for the configured provider (every alias under `openai-compatible`) is a per-rule error at run time naming both, not a silent fallback.

   Verified 2026-09-20 against Claude Code 2.1.278: `claude --model` documents "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name". OpenCode's `run -m` takes `provider/model` ([opencode.ai/docs/cli](https://opencode.ai/docs/cli/)).

3. **No compile-time check that the alias maps.** `compileRule` knows the project config and could diagnose it, but the detector's own zod schema — the thing compile actually runs — does not, and threading settings into every detector schema to serve one detector is not worth it. The unmapped-alias case is a per-rule run-time error instead, phrased so it reads like a diagnostic. `rulecast doctor` (plan 7) is where this becomes a pre-flight check, together with "is `claude` installed" and "is `$ANTHROPIC_API_KEY` set", which are environmental and belong there anyway.

4. **Project `llm` settings reach detectors through `DetectorRun.settings`.** The registry is built in `main.ts` before any config is loaded (`src/commands/main.ts:51`), so a `createLlmDetector(settings)` factory would mean rebuilding the registry after compile in six commands. One typed field on the run input is a far smaller change and is honest about what it is: settings from `.rulecast-config.yaml` that a detector may read. It is named `settings` rather than `llm` so it has room for the next one.

5. **`claude -p` is run lean, and the prompt goes on stdin.** Measured 2026-09-20 on Claude Code 2.1.278, same prompt both ways:

   | Invocation | Input tokens |
   |---|---|
   | `claude -p --model haiku --output-format json --json-schema …` | 23,046 (cache creation) |
   | the same, plus `--system-prompt … --tools "" --restricted --strict-mcp-config --no-session-persistence` | 1,254 |

   A naive invocation drags Claude Code's whole system prompt, the project's `CLAUDE.md` and its plugins into every call — roughly 20× the cost for a question about one file. `--tools ""` also means the child cannot read, write or run anything, and `--restricted` makes it ignore user, project and local settings files, so a rulecast `Stop` hook cannot spawn a `claude` that trips the same hook again. Verified by running it from inside a Claude Code session: no recursion, no interference.

   stdin rather than argv because a file plus its grounding references can exceed `ARG_MAX`, and because passing a prompt on the command line puts source code in the process table.

6. **`--json-schema` gives real structured output.** `claude -p --output-format json` returns an envelope with a `structured_output` field already parsed against the schema, alongside the raw `result` string. Recorded probe, 2026-09-20:

   ```json
   {"is_error":false,"subtype":"success",
    "result":"{\"findings\":[{\"rule\":\"r1\",\"line\":2,\"text\":\"print(\\\"x\\\")\",\"reason\":\"Line uses print()\"}]}",
    "structured_output":{"findings":[{"rule":"r1","line":2,"text":"print(\"x\")","reason":"Line uses print()"}]}}
   ```

   The provider prefers `structured_output`, falls back to parsing `result`, and falls back again to scanning stdout for a JSON object with a `findings` key. The last fallback (`extractFindingsJson`) is shared: OpenCode has no schema flag at all, so text-scraping is its only option, and writing it once keeps the two CLI providers the same shape.

7. **Providers stay inside `packages/rulecast` for 0.1.** The user raised separate provider packages, monorepo style. Spec §16 already sets the rule for this repository — "detectors and adapters split into their own packages only when third-party ones exist" — and providers are the same kind of thing. What this plan does instead is export `LlmProvider`, `LlmRequest` and `LlmFinding` from `src/index.ts`, so the split is a file move when someone wants to publish one, not a redesign.

8. **Binaries resolve `node_modules/.bin` first, then `PATH`,** like linters (spec §6). It is what lets a test fixture drop a stub `claude` into its own project and get a hermetic, free, deterministic run. `src/detectors/linter/resolve.ts` is not reused: its `uv run` branch exists for ruff and would be dead weight here.

## Conventions

- The repository is a pnpm workspace; the CLI package lives in `packages/rulecast/`. Run commands from the repository root.
- Run one test file with `pnpm vitest run <path>`; the path is relative to `packages/rulecast/`. Run everything with `pnpm test` and types with `pnpm typecheck`.
- Tests never touch the real cache: `test/helpers/home.ts` gives each test file its own `RULECAST_HOME`, and a spawned CLI must get it in the child's env. `ls ~/.cache/rulecast` must still be absent when this plan is done.
- **No test in `pnpm test` may call a real model.** Every provider test in this plan runs against a stub binary in the fixture's `node_modules/.bin`. Live tests arrive in 6c, gated behind `RULECAST_LLM=1`.
- lefthook runs biome (with `--write`, re-staging fixes) and `pnpm typecheck` on commit, and `pnpm test` on push. Never bypass them; fix the cause. Biome runs with `--error-on-warnings`, so unsorted imports and unsorted `export` lines in `src/index.ts` fail a commit — run `pnpm lint:fix` before committing.
- Stage files by exact path (`git add <paths>`), then a plain `git commit`. Never `git add -A`, `git commit -- <paths>`, stash, reset or checkout. Check that `git commit` exited 0; don't filter its output through `grep` or `tail`.
- Commit after every task. Commit messages end with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`. Commit straight to `main`; `git fetch` before pushing.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/`.

| File | Responsibility |
|---|---|
| `src/core/types.ts` | `LlmSettings`, `DetectorSettings`; `DetectorRun.settings` |
| `src/core/config/schema.ts` | The `llm` block: provider names, `model` removed |
| `src/core/detection/run.ts` | `DetectionInput.settings`, passed into every `detector.run` |
| `src/core/pipeline.ts` | Passes `config.llm` in |
| `src/testing/detector-contract.ts` | Supplies default settings so third-party fixtures need no change |
| `src/detectors/llm/models.ts` | The alias table and `resolveModel` |
| `src/detectors/llm/providers/types.ts` | `LlmProvider`, `LlmRequest`, `LlmFinding`, `FINDINGS_SCHEMA`, the response zod schema |
| `src/detectors/llm/providers/extract.ts` | `extractFindingsJson`: find a `{"findings":…}` object in arbitrary text |
| `src/detectors/llm/providers/cli.ts` | `resolveCli` and `runCli`: spawn a binary with a prompt on stdin, collect stdout |
| `src/detectors/llm/providers/claude-code.ts` | The `claude-code` provider |
| `src/detectors/llm/providers/index.ts` | `providerByName` |
| `src/index.ts` | Exports the provider types |
| `test/helpers/llm.ts` | `stubAgentCli`, `stubStdin`, `stubArgv` |
| `test/payloads/llm/claude-code.json`, `README.md` | The recorded `claude -p` envelope and how it was recorded |
| `test/detectors/llm/models.test.ts` | Alias resolution |
| `test/detectors/llm/extract.test.ts` | JSON extraction from noisy text |
| `test/detectors/llm/providers/claude-code.test.ts` | argv, stdin, parsing, failure modes |
| `test/detectors/llm/live.test.ts` | `RULECAST_LLM=1`: one real `claude -p` call |
| `test/core/config/schema.test.ts` | The changed `llm` block |

---

## Task 1: `llm` settings lose `model` and gain the new provider names

**Files:** modify `src/core/config/schema.ts:78-106` · modify `src/core/types.ts:50-62` · test `test/core/config/schema.test.ts`

**Behaviour:** `.rulecast-config.yaml`'s `llm` block accepts `provider: claude-code | opencode | anthropic | openai-compatible`, defaulting to `claude-code`, and no longer accepts `model`. `Config["llm"]` is exported as `LlmSettings` so detectors can name the type.

- [ ] Write failing tests in `test/core/config/schema.test.ts`:
  - `llm: {}` parses to `{ provider: "claude-code", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 }`
  - `llm: { provider: opencode }` parses
  - `llm: { provider: gemini }` fails
  - `llm: { model: haiku }` fails with an unrecognised-key error (`.strict()` gives this for free; the test pins it so the removal cannot be undone silently)
- [ ] In `src/core/types.ts`, above `DetectorRun`, add:

  ```ts
  export const LLM_PROVIDERS = ["claude-code", "opencode", "anthropic", "openai-compatible"] as const
  export type LlmProviderName = (typeof LLM_PROVIDERS)[number]

  /** Project-level `llm` settings from .rulecast-config.yaml (spec §6, §12). */
  export interface LlmSettings {
    provider: LlmProviderName
    /** Overrides the provider's own endpoint; the only way to reach Azure OpenAI or Ollama. */
    baseUrl: string | null
    apiKeyEnv: string
    maxFilesPerVerify: number
  }

  /** Settings the core passes to every detector run. */
  export interface DetectorSettings {
    llm: LlmSettings
  }

  export function defaultDetectorSettings(): DetectorSettings {
    return { llm: { provider: "claude-code", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 } }
  }
  ```
- [ ] In `src/core/config/schema.ts`, change the `llm` object to `z.enum(LLM_PROVIDERS).default("claude-code")` for `provider`, delete the `model` key and delete `model` from the transform.
- [ ] Verify: `pnpm vitest run test/core/config/schema.test.ts` → passes; `pnpm typecheck` → passes.
- [ ] `git add packages/rulecast/src/core/config/schema.ts packages/rulecast/src/core/types.ts packages/rulecast/test/core/config/schema.test.ts && git commit`

## Task 2: `DetectorRun.settings`

**Files:** modify `src/core/types.ts:50-62` · modify `src/core/detection/run.ts:8-16,55-66` · modify `src/core/pipeline.ts:160-176` · modify `src/testing/detector-contract.ts:33-42` · test `test/core/detection/run.test.ts`

**Behaviour:** every detector's `run` receives the project's `llm` settings. Nothing reads them yet.

- [ ] Write a failing test in `test/core/detection/run.test.ts`: a fake detector records `input.settings` and `runDetection` is called with `settings: { llm: { provider: "opencode", … } }`; the recorded value equals it.
- [ ] `DetectorRun` gains `settings: DetectorSettings`. `DetectorWarm` does **not** — nothing warms an llm rule, and `rulecast warm` has no project config path that needs changing.
- [ ] `DetectionInput` gains `settings: DetectorSettings`; `runDetection` passes `settings: input.settings` in the `detector.run({…})` call at `src/core/detection/run.ts:57-66`.
- [ ] `runPipeline` passes `settings: { llm: config.llm }` in its `runDetection({…})` call.
- [ ] `src/testing/detector-contract.ts`'s private `run()` passes `settings: defaultDetectorSettings()`. **`DetectorFixture` does not change**, so every existing fixture and any third-party one keeps working.
- [ ] Verify: `pnpm test` → all 531 tests pass (4 skipped); `pnpm typecheck` → passes.
- [ ] `git add` the four `src/` files and the test, then `git commit`

## Task 3: Model aliases

**Files:** create `src/detectors/llm/models.ts` · test `test/detectors/llm/models.test.ts`

**Behaviour:** `resolveModel("haiku", "anthropic")` is `claude-haiku-4-5-20251001`; `resolveModel("haiku", "claude-code")` is `haiku`; `resolveModel("qwen3-coder:30b", "openai-compatible")` is `qwen3-coder:30b`; `resolveModel("haiku", "openai-compatible")` is `null`.

- [ ] Write the failing test, one case per cell of Decision 2's table plus the two passthrough cases and the `null` case.
- [ ] Implement:

  ```ts
  import type { LlmProviderName } from "../../core/types"

  /** Aliases so one rule's `model` works whichever provider a project configured (plan 6a, Decision 2). */
  const ALIASES: Record<string, Partial<Record<LlmProviderName, string>>> = {
    haiku: { "claude-code": "haiku", anthropic: "claude-haiku-4-5-20251001", opencode: "anthropic/claude-haiku-4-5-20251001" },
    sonnet: { "claude-code": "sonnet", anthropic: "claude-sonnet-5", opencode: "anthropic/claude-sonnet-5" },
    opus: { "claude-code": "opus", anthropic: "claude-opus-5", opencode: "anthropic/claude-opus-5" },
    fable: { "claude-code": "fable", anthropic: "claude-fable-5-1", opencode: "anthropic/claude-fable-5-1" },
  }

  export const MODEL_ALIASES: readonly string[] = Object.keys(ALIASES)

  /** The provider's own name for a model. null: a known alias this provider cannot express. */
  export function resolveModel(model: string, provider: LlmProviderName): string | null {
    const alias = ALIASES[model]
    if (alias === undefined) return model
    return alias[provider] ?? null
  }
  ```
- [ ] Verify: `pnpm vitest run test/detectors/llm/models.test.ts` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/models.ts packages/rulecast/test/detectors/llm/models.test.ts && git commit`

## Task 4: The provider interface and the response schema

**Files:** create `src/detectors/llm/providers/types.ts` · test — none of its own (Task 6 exercises it)

**Behaviour:** one interface every provider implements, and one zod schema every provider's output is validated against, so a malformed answer fails the same way everywhere.

- [ ] Implement:

  ```ts
  import { z } from "zod"
  import type { LlmSettings } from "../../../core/types"

  /** What the model is asked to answer with (spec §6). */
  export const responseSchema = z.object({
    findings: z.array(
      z.object({
        rule: z.string(),
        line: z.number().int().positive(),
        text: z.string().optional(),
        reason: z.string(),
      }),
    ),
  })

  export type LlmFinding = z.infer<typeof responseSchema>["findings"][number]

  /** The same shape as JSON Schema, for providers that can enforce it (claude-code's --json-schema). */
  export const FINDINGS_SCHEMA = {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rule: { type: "string" },
            line: { type: "integer" },
            text: { type: "string" },
            reason: { type: "string" },
          },
          required: ["rule", "line", "reason"],
        },
      },
    },
    required: ["findings"],
  } as const

  export interface LlmRequest {
    /** The provider's own model name, already resolved from the rule's alias. */
    model: string
    /** The whole prompt: rules, grounding and the marked-up file (plan 6b). */
    prompt: string
    settings: LlmSettings
    env: NodeJS.ProcessEnv
    cwd: string
    signal: AbortSignal
  }

  /** Thrown when the backend itself is unusable — no binary, no credentials. Spec §14 makes this a whole-run failure. */
  export class LlmUnavailableError extends Error {}

  export interface LlmProvider {
    name: string
    ask(request: LlmRequest): Promise<LlmFinding[]>
  }
  ```
- [ ] Verify: `pnpm typecheck` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/providers/types.ts && git commit`

**Why two error kinds:** spec §14 separates "LLM credentials missing → llm rules disabled for the session; one warning" from "Malformed LLM output → Error for the rules in that call". `LlmUnavailableError` is the first; every other throw is the second. 6b maps them to `rule: null` and per-rule errors respectively.

## Task 5: `extractFindingsJson` and the CLI spawn helper

**Files:** create `src/detectors/llm/providers/extract.ts`, `src/detectors/llm/providers/cli.ts` · test `test/detectors/llm/extract.test.ts`

**Behaviour:** `extractFindingsJson(text)` returns the parsed `{ findings: [...] }` object found anywhere in `text`, or `null`. `runCli` spawns a binary with a prompt on stdin and returns its stdout, stderr and exit code without throwing on a non-zero exit.

- [ ] Write failing tests for `extractFindingsJson`:
  - bare JSON → parsed
  - JSON inside a fenced block with prose either side → parsed
  - two objects, only the second with a `findings` key → the second
  - braces inside a string value (`"reason": "uses {} literals"`) → parsed, i.e. the scanner tracks string state and escapes
  - no JSON at all, and JSON without a `findings` key → `null`
  - a `findings` object followed by trailing garbage → parsed
- [ ] Implement `extractFindingsJson` as a single left-to-right scan: for each `{`, walk forward tracking brace depth while respecting double-quoted strings and backslash escapes; when the object closes, `JSON.parse` it and return it if it has a `findings` array; otherwise continue from the next `{`. Return the **last** such object, so a model that thinks out loud in JSON before answering still parses.
- [ ] Implement `src/detectors/llm/providers/cli.ts`:

  ```ts
  import { spawn } from "node:child_process"
  import { access, constants } from "node:fs/promises"
  import path from "node:path"

  export interface CliResult {
    stdout: string
    stderr: string
    code: number | null
  }

  /** <root>/node_modules/.bin/<name>, then PATH (spec §6; plan 6a, Decision 8). */
  export async function resolveCli(name: string, root: string): Promise<string> { … }

  /** Spawns with the prompt on stdin. Never throws on a non-zero exit; ENOENT becomes LlmUnavailableError. */
  export function runCli(
    command: string,
    args: string[],
    options: { cwd: string; input: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
  ): Promise<CliResult> { … }
  ```

  `runCli` details that matter:
  - `stdio: ["pipe", "pipe", "pipe"]`; write `input` to `child.stdin` and `end()` it. Ignore `EPIPE` on stdin — a CLI that answers without reading its input is allowed.
  - collect stdout and stderr as arrays of `Buffer`, join at `close`. No `maxBuffer` cliff.
  - on `error` with `code === "ENOENT"`, reject with `new LlmUnavailableError(\`${command} is not installed\`)`.
  - pass `signal` straight to `spawn`; an abort rejects, and 6b rethrows it so the core records a timeout.
- [ ] Verify: `pnpm vitest run test/detectors/llm/extract.test.ts` → passes; `pnpm typecheck` → passes.
- [ ] `git add packages/rulecast/src/detectors/llm/providers/extract.ts packages/rulecast/src/detectors/llm/providers/cli.ts packages/rulecast/test/detectors/llm/extract.test.ts && git commit`

## Task 6: The recorded `claude -p` payload and the stub helper

**Files:** create `test/payloads/llm/claude-code.json`, `test/payloads/llm/README.md`, `test/helpers/llm.ts`

**Behaviour:** a fixture can install a stub `claude` that replays a recorded envelope, records the argv and stdin it was given, and can be told to misbehave for a named model.

- [ ] Save the recorded envelope as `test/payloads/llm/claude-code.json`. It is the real thing, captured 2026-09-20 from Claude Code 2.1.278; trim it to the fields the provider reads plus enough context to be recognisable:

  ```json
  {
    "type": "result",
    "subtype": "success",
    "is_error": false,
    "duration_ms": 3680,
    "result": "{\"findings\":[{\"rule\":\"r1\",\"line\":2,\"text\":\"print(\\\"x\\\")\",\"reason\":\"Line uses print(), which the rule forbids\"}]}",
    "structured_output": {
      "findings": [
        { "rule": "r1", "line": 2, "text": "print(\"x\")", "reason": "Line uses print(), which the rule forbids" }
      ]
    },
    "modelUsage": { "claude-haiku-4-5-20251001": { "costUSD": 0.0012 } }
  }
  ```
- [ ] Write `test/payloads/llm/README.md` in the same shape as `test/payloads/linter/README.md`: what produced each file, the exact command, and why it is a recording (a live call costs money, needs credentials and is non-deterministic; `RULECAST_LLM=1` in 6c re-checks the recordings against the real CLIs).
- [ ] Implement `test/helpers/llm.ts`:

  ```ts
  /**
   * A stub agent CLI in <root>/node_modules/.bin. It records argv and stdin, then prints the
   * recorded envelope — unless --model names a model in `broken`, when it prints unparseable
   * output instead, which is how a fixture gets a deterministic per-rule failure.
   */
  export async function stubAgentCli(
    root: string,
    name: "claude" | "opencode",
    options?: { broken?: string[]; exitCode?: number; stdout?: string },
  ): Promise<void>

  /** The argv the stub was called with, one space-joined line. */
  export async function stubArgv(root: string, name: string): Promise<string>
  /** Everything written to the stub's stdin. */
  export async function stubStdin(root: string, name: string): Promise<string>
  ```

  The generated shell script writes `"$*"` to `<root>/<name>.argv`, `cat > <root>/<name>.stdin`, then branches on whether `"$*"` contains a broken model name.

  **The stub rewrites the envelope's rule ids to match the prompt it was given.** The recording names `r1`, but callers use whatever ids their test needs — the contract suite uses `a`, `b`, `good` and `bad`. Rather than a recording per test, the script greps the first `### <id>` heading out of `<root>/<name>.stdin` (the prompt's rule sections, plan 6b Task 2) and substitutes it for `r1` before printing. One `sed` in the script; document it in the helper's doc comment so nobody is surprised that the stub is prompt-sensitive.
- [ ] Verify: nothing to run yet; `pnpm typecheck` → passes.
- [ ] `git add packages/rulecast/test/payloads/llm packages/rulecast/test/helpers/llm.ts && git commit`

## Task 7: The `claude-code` provider

**Files:** create `src/detectors/llm/providers/claude-code.ts`, `src/detectors/llm/providers/index.ts` · modify `src/index.ts` · test `test/detectors/llm/providers/claude-code.test.ts`

**Behaviour:** `claudeCodeProvider.ask({ model: "haiku", prompt, … })` spawns the lean `claude -p`, writes the prompt to stdin, and returns the findings from `structured_output`.

- [ ] Write failing tests against a project with a stub `claude` (`stubAgentCli`):
  - **argv**: contains `-p`, `--model haiku`, `--output-format json`, `--tools` with an empty value, `--restricted`, `--strict-mcp-config`, `--no-session-persistence`, and a `--json-schema` argument that parses as JSON and has `properties.findings`
  - **stdin**: is exactly the prompt it was given
  - **structured output**: the recorded envelope yields one finding, `{ rule: "r1", line: 2, reason: "Line uses print(), …" }`
  - **fallback to `result`**: an envelope with no `structured_output` but a JSON `result` string yields the same finding
  - **fallback to scanning**: stdout that is not an envelope at all but contains `{"findings":[…]}` yields the finding
  - **`is_error: true`** in the envelope throws an `Error` whose message includes the envelope's `result`
  - **unparseable stdout** throws an `Error` (not `LlmUnavailableError`) — this is §14's "malformed LLM output"
  - **missing binary**: a project with no stub and a `PATH` that has no `claude` throws `LlmUnavailableError`
  - **abort**: an already-aborted signal rejects and `signal.aborted` is true
- [ ] Implement the provider. Argv, in order:

  ```ts
  const args = [
    "-p",
    "--model", request.model,
    "--output-format", "json",
    "--json-schema", JSON.stringify(FINDINGS_SCHEMA),
    "--system-prompt", SYSTEM_PROMPT,
    "--tools", "",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
  ]
  ```

  with

  ```ts
  const SYSTEM_PROMPT =
    "You check one source file against a list of rules and answer only with the structured result. " +
    "You never edit files, run commands or ask questions."
  ```

  Parsing, in order: `JSON.parse(stdout)` → if it has `is_error: true`, throw with `result` in the message; if `structured_output` parses against `responseSchema`, return it; if `result` is a string that parses against it, return that; otherwise fall through to `extractFindingsJson(stdout)`; `null` throws `new Error(\`claude returned no usable JSON (exit ${code}): ${firstLine(stderr || stdout)}\`)`.
- [ ] `src/detectors/llm/providers/index.ts` exports `providerByName(name: LlmProviderName): LlmProvider`, throwing `LlmUnavailableError` for the three names 6c adds — so 6b can be finished and shipped with one provider, and a project configured for `anthropic` gets "the anthropic provider is not available in this build" rather than a crash. **6c replaces those three throws with real providers.**
- [ ] Add to `src/index.ts` (keeping the export list sorted, or `pnpm lint:fix` will):

  ```ts
  export { type LlmFinding, type LlmProvider, LlmUnavailableError, type LlmRequest } from "./detectors/llm/providers/types"
  export { MODEL_ALIASES, resolveModel } from "./detectors/llm/models"
  ```
- [ ] Verify: `pnpm vitest run test/detectors/llm/providers/claude-code.test.ts` → passes; `pnpm test` → passes; `pnpm typecheck` and `pnpm lint` → clean.
- [ ] `git add` the three `src/` files and the test, then `git commit`

## Task 8: The first live test

**Files:** create `test/detectors/llm/live.test.ts`

**Behaviour:** `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` makes one real `claude -p` call and checks the provider against it. `pnpm test` skips the file.

- [ ] Write the suite, modelled on `test/detectors/linter/live.test.ts`:

  ```ts
  describe.runIf(process.env.RULECAST_LLM === "1")("live llm providers", () => { … })
  ```

  One case, `claude-code`: a three-line Python file with one obvious `print()`, a prompt naming rule `r1`, `model: resolveModel("haiku", "claude-code")`. Assert the **shape** — an array, at least one finding, `rule === "r1"`, `line` an integer inside the file, `reason` a non-empty string. Never assert the model's words. Skip by name with a `console.log` when `claude` is not on `PATH`, as the linter suite does. Timeout `120_000`: a cold `claude -p` took 9 s on the machine this was written on, and a loaded CI box is slower.

  6c adds the other three providers to this file. Build the prompt here by hand — `buildPrompt` does not exist until 6b — and leave a comment saying 6c should switch it over.
- [ ] Verify: `pnpm test` → the file is skipped, skip count 4 → 5. Then `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` → passes on this machine.
- [ ] `git add packages/rulecast/test/detectors/llm/live.test.ts && git commit`

---

## End-to-end verification

From the repository root:

- [ ] `pnpm test` → all tests pass, 5 skipped: the perf test, the three `RULECAST_LINTERS=1` linter tests, and the new `RULECAST_LLM=1` live case. No test made a network call or spawned a real `claude`.
- [ ] `pnpm typecheck` → clean. `pnpm lint` → clean.
- [ ] `ls ~/.cache/rulecast` → absent. No test wrote to the real cache home.
- [ ] `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` → the one live case really spawns `claude`, gets a finding on the right line and passes. It costs roughly a tenth of a cent; if it costs noticeably more, the lean flags of Decision 5 are not all being passed — check the argv test.
- [ ] `git log --oneline e3f8831..HEAD` → eight commits, one per task.
