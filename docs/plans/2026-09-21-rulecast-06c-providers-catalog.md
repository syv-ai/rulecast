# rulecast Plan 6c — The remaining providers, the catalog rule and the docs Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The other three providers — `opencode`, `anthropic`, `openai-compatible` — a catalog `llm` rule that `init` offers but never preselects, the docs that say file contents leave the machine, one opt-in live test per provider, and the spec brought back in line with what was built.

**Architecture:** Two more shapes behind the same `LlmProvider` interface 6a defined. `opencode` is a second CLI provider, but unlike `claude -p` it has no structured-output flag, so its answer is scraped out of its stdout with the shared `extractFindingsJson`. `anthropic` and `openai-compatible` are one `fetch` each, both honouring `llm.base_url`, which is what makes them testable against a local `node:http` server and is also how anyone reaches Azure OpenAI or Ollama. Everything in `pnpm test` stays offline; `RULECAST_LLM=1` adds one real call per provider for anyone who wants to check the recordings still describe reality.

**Tech Stack:** Node ≥ 20.12 (global `fetch`, `node:http`), TypeScript 5, zod 3, vitest.

Prerequisite: `2026-09-21-rulecast-06b-detector.md` is done. This is the last part of plan 6; plan 7 follows.

---

## Decisions this plan implements

1. **`llm.base_url` overrides the endpoint for both HTTP providers, not just `openai-compatible`.** Spec §6 introduces `base_url` for the OpenAI-compatible family, but there is no reason `anthropic` should not honour it: it costs one `??`, it is how the provider gets tested without a network, and it is how someone reaches a proxy or a gateway in front of the Anthropic API. A `base_url` set with a CLI provider is ignored, and that is said in the docs rather than made an error — a project that switches provider should not have to delete a line.

2. **No `response_format` / JSON-mode flag on the OpenAI-compatible request.** `response_format: { type: "json_object" }` is an OpenAI extension that Ollama, llama.cpp and several gateways either reject outright or interpret differently, and `openai-compatible` exists precisely to reach those. The prompt already demands JSON and `extractFindingsJson` already survives a model that wraps it in prose, so the flag buys reliability we already have at the cost of the compatibility the provider is named after.

3. **OpenCode gets the prompt as an argument, not on stdin.** `opencode run [message..]` documents a positional message and says nothing about reading stdin ([opencode.ai/docs/cli](https://opencode.ai/docs/cli/)), and OpenCode is not installed on this machine, so stdin cannot be verified here. The argument path is the documented one. That caps the prompt at `ARG_MAX`, so a prompt over **128 KiB** is a per-rule error naming the file rather than an `E2BIG` from `spawn`; 128 KiB is well under macOS's 1 MiB and leaves room for the rest of the argv.

   **This is the one unverified assumption in plan 6.** If the `RULECAST_LLM=1` live test shows OpenCode reads stdin, switch it to stdin and delete the size guard — the change is confined to `providers/opencode.ts`.

4. **`--format default`, not `--format json`, for OpenCode.** `--format json` emits "raw JSON events" whose schema is not documented and which this plan cannot record from a real run. Since the answer has to be scraped out of text either way, scraping the plain output depends on nothing beyond "the model's reply appears in stdout", which is true of both formats. Fewer assumptions, and it keeps working if OpenCode changes its event schema.

5. **401 and 403 are `LlmUnavailableError`; every other HTTP failure is a per-rule error.** Spec §14's "LLM credentials missing" row is about the whole run being unable to proceed, and a rejected key is the same situation as an absent one — the fix is the same, and repeating it once per rule is noise. A 429, a 500 or a timeout is per-call and might affect only some rules, so it stays per-rule.

6. **One catalog llm rule: `python/thin-routes`.** Spec §6's own example question, grounded on the layering doc the Python package already ships. One is enough to make `init`'s consent path real and to give the catalog test something to exercise; more would be guesses about conventions nobody asked for. It uses `model: haiku` — the cheapest alias, and the one whose cost a reader can look up.

7. **`init` never preselects an llm rule, and says why in the hint.** Spec §6, Consent. The implementation is one clause in `chooseRules`'s `preselected` filter at `src/commands/init.ts:168-169`, which also covers the non-interactive path immediately below it (`if (ui.prompter === null) return available.filter(…preselected…)`) — so `rulecast init --yes` never installs an llm rule either. `--rules python/thin-routes` still does, because that is an explicit request.

## Conventions

Identical to plan 6a — read that plan's Conventions section.

## File structure

Paths under `src/` and `test/` are in `packages/rulecast/` unless they start with `packages/` or `docs/`.

| File | Responsibility |
|---|---|
| `src/detectors/llm/providers/opencode.ts` | The `opencode` provider |
| `src/detectors/llm/providers/http.ts` | Shared `fetch` plumbing: endpoint, key lookup, status mapping |
| `src/detectors/llm/providers/anthropic.ts` | `/v1/messages` |
| `src/detectors/llm/providers/openai.ts` | `/v1/chat/completions` |
| `src/detectors/llm/providers/index.ts` | All four, no throwing placeholders left |
| `test/helpers/llm-server.ts` | A local HTTP stand-in for both APIs |
| `test/detectors/llm/providers/{opencode,anthropic,openai}.test.ts` | One per provider |
| `test/detectors/llm/live.test.ts` | Gains the other three providers (6a created it) |
| `packages/rules-python/rules.yaml` | The catalog llm rule |
| `.rulecast-rules.yaml` | Regenerated manifest |
| `src/commands/init.ts` | Never preselect llm rules; the consent hint |
| `agents/reference/detectors.md`, `agents/reference/rule-format.md` | The `llm` section replaces "Coming later" |
| `docs/specs/2026-09-15-rulecast-design.md` | §4, §6, §12, §15 |
| `docs/plans/2026-09-15-rulecast-00-index.md` | Plan 6 marked done |

---

## Task 1: The `opencode` provider

**Files:** create `src/detectors/llm/providers/opencode.ts` · modify `src/detectors/llm/providers/index.ts` · test `test/detectors/llm/providers/opencode.test.ts`

**Behaviour:** `opencodeProvider.ask({ model: "anthropic/claude-haiku-4-5-20251001", prompt, … })` spawns `opencode run`, and finds the findings in whatever it printed.

- [ ] Write failing tests against a stub `opencode` (`stubAgentCli(root, "opencode", …)`):
  - **argv**: `run`, `--model <model>`, `--format default`, and the prompt as the last argument
  - **plain JSON output** → the findings
  - **output with prose around a fenced JSON block** → the same findings
  - **output with no JSON** → an `Error` (per-rule, not `LlmUnavailableError`) whose message includes the first line of stderr when there is one
  - **missing binary** → `LlmUnavailableError`
  - **a prompt over 128 KiB** → an `Error` mentioning the size and the limit, and the stub was never spawned
  - **abort** → rejects
- [ ] Implement. `resolveCli("opencode", cwd)`, then `runCli(command, ["run", "--model", model, "--format", "default", prompt], { input: "", … })` — the prompt is the argument, and stdin gets nothing. Parse with `extractFindingsJson(stdout)`, validate against `responseSchema`, and throw on `null`.
- [ ] Wire it into `providerByName`.
- [ ] Verify: `pnpm vitest run test/detectors/llm/providers/opencode.test.ts` → passes.
- [ ] `git add` the two `src/` files and the test, then `git commit`

## Task 2: The local API server and the `anthropic` provider

**Files:** create `test/helpers/llm-server.ts`, `src/detectors/llm/providers/http.ts`, `src/detectors/llm/providers/anthropic.ts` · modify `src/detectors/llm/providers/index.ts` · test `test/detectors/llm/providers/anthropic.test.ts`

**Behaviour:** with `llm: { provider: anthropic, base_url: http://127.0.0.1:<port> }` and the key env var set, the provider POSTs to `/v1/messages` and returns the findings from the reply's text.

- [ ] Implement `test/helpers/llm-server.ts` first — it is test scaffolding, so it does not need its own red step:

  ```ts
  export interface FakeApi {
    url: string
    /** Every request the server received, in order. */
    requests: { path: string; headers: Record<string, string>; body: any }[]
    close(): Promise<void>
  }

  /** `reply` gets the parsed request body and returns [status, body]. */
  export function fakeApi(reply: (body: any, path: string) => [number, unknown]): Promise<FakeApi>
  ```

  Bind to `127.0.0.1` port `0` and read the assigned port, so parallel test files never collide. Close it in `afterEach`.
- [ ] Write failing tests for the provider:
  - **request**: path is `/v1/messages`, `x-api-key` is the value of the configured env var, `anthropic-version` is present, and the body has `model` and one user message whose content is the prompt
  - **reply** `{ content: [{ type: "text", text: "{\"findings\":[…]}" }] }` → the findings
  - **reply with prose around the JSON** → the same findings, via `extractFindingsJson`
  - **reply with no JSON** → an `Error` (per-rule)
  - **env var unset** → `LlmUnavailableError` naming the variable, and **no request was made**
  - **401** → `LlmUnavailableError`; **500** → a plain `Error` whose message carries the status
  - **`base_url` unset** → the request goes to `https://api.anthropic.com` (assert by reading the URL the provider built, through a tiny exported `endpoint()` helper, rather than by making a call)
  - **abort** → rejects
- [ ] Implement `http.ts` with what both HTTP providers share: `apiKey(request)` (throws `LlmUnavailableError` naming `settings.apiKeyEnv` when unset), `endpoint(baseUrl, fallback, path)`, and `postJson(url, headers, body, signal)` which maps 401/403 to `LlmUnavailableError` and any other non-2xx to `Error` with the status and the first 200 characters of the body.
- [ ] Implement `anthropic.ts`: `max_tokens: 4096`, `messages: [{ role: "user", content: request.prompt }]`. Join every `content[]` part with `type === "text"`, then `extractFindingsJson`.
- [ ] Verify: `pnpm vitest run test/detectors/llm/providers/anthropic.test.ts` → passes, and no test made an outbound request.
- [ ] `git add` the three `src/` files, the helper and the test, then `git commit`

## Task 3: The `openai-compatible` provider

**Files:** create `src/detectors/llm/providers/openai.ts` · modify `src/detectors/llm/providers/index.ts` · test `test/detectors/llm/providers/openai.test.ts`

**Behaviour:** the same, against `/v1/chat/completions`, with `Authorization: Bearer`.

- [ ] Write failing tests mirroring Task 2's list, plus: the request body has **no** `response_format` key (Decision 2 — pin it, or someone will add it back), and `base_url` unset sends the request to `https://api.openai.com`.
- [ ] Implement, reading `choices[0].message.content` and passing it to `extractFindingsJson`.
- [ ] `providerByName` now returns a real provider for all four names; delete the placeholder throws 6a left in it.
- [ ] Verify: `pnpm vitest run test/detectors/llm/providers/` → all four provider suites pass; `pnpm test` → everything passes.
- [ ] `git add` the two `src/` files and the test, then `git commit`

## Task 4: The remaining live tests

**Files:** modify `test/detectors/llm/live.test.ts` (created in plan 6a, Task 8)

**Behaviour:** `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` makes one real call per provider the machine can reach, and skips by name the ones it cannot. `pnpm test` skips the whole file.

- [ ] Turn the file's single `claude-code` case into a table-driven suite with one case per provider, and switch the hand-built prompt over to `buildPrompt` now that plan 6b has it (6a left a comment saying to). Each case: a three-line Python file with one obvious `print()`, `model` resolved through `resolveModel`, and assertions on the **shape** — an array, at least one finding, `rule` equal to the id that was asked, `line` an integer inside the file, `reason` a non-empty string. Never assert the model's words.
  - `claude-code`: skip by name when `claude` is not on `PATH`
  - `opencode`: skip by name when `opencode` is not on `PATH`. **This is the case that settles Decision 3** — if it passes only after switching the prompt to stdin, make that change in `providers/opencode.ts`, delete the 128 KiB guard and its test, and say so in the commit message.
  - `anthropic`: skip by name when `$ANTHROPIC_API_KEY` is unset
  - `openai-compatible`: skip by name when `$OPENAI_API_KEY` is unset; `baseUrl` `https://api.openai.com`, `model: "gpt-4o-mini"` (no alias maps for this provider by design)

  A skip prints `console.log(\`skipping ${name}: …\`)` and returns, as the linter suite does, so a machine that has none of them still shows what was not exercised. Timeout `120_000` — a cold `claude -p` took 9 s on the machine this was written on, and a loaded CI box will be slower.
- [ ] Add a line to `test/payloads/llm/README.md` pointing at this file as where the recordings get checked against reality.
- [ ] Verify: `pnpm test` → the file is skipped and the skip count rises from 5 to 8 (three more live cases). Then run it for real on this machine: `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` → `claude-code` passes, `opencode` skips by name (it is not installed here), the two API cases skip or pass depending on the environment.
- [ ] Record the outcome in the commit message: which providers actually ran.
- [ ] `git add packages/rulecast/test/detectors/llm/live.test.ts packages/rulecast/test/payloads/llm/README.md && git commit`

## Task 5: The catalog rule, which `init` offers but never ticks

**Files:** modify `packages/rules-python/rules.yaml` · regenerate `.rulecast-rules.yaml` · modify `src/commands/init.ts:160-193` · test `test/catalog.test.ts`, `test/commands/init.test.ts`

**Behaviour:** `python/thin-routes` is in the catalog, compiles, fires on a fat route handler, and is offered by `rulecast init` **unticked**, with a hint saying what it costs and what it sends.

The catalog rule and the consent rule are one task because they are one behaviour: adding a catalog llm rule without the preselect change would ship a release in which `rulecast init --yes` silently starts sending source code to a model.

- [ ] Add the rule to `packages/rules-python/rules.yaml`:

  ```yaml
  - id: thin-routes
    name: Route handlers stay thin
    description: A model judges whether a route does more than parse input, call a service and return. Sends file contents to your configured LLM provider.
    files: ^app/(api|routers)/
    types: [python]
    severity: warning
    detect:
      llm:
        model: haiku
        question: >
          Does this route handler do more than parse input, call a service and return the
          result — business logic, database access, or error translation inline? Report each
          offending line.
    message: "{{file}}:{{line}} does work that belongs in a service. {{reason}}"
    context:
      - "@layering.md#business-logic-goes-in-services"
  ```

  `severity: warning`, not `error`: a model's judgement should not block an agent's stop. `layering.md` has the `## Business logic goes in services` heading the anchor needs (line 15); a missing anchor is a compile diagnostic, so `pnpm test` would catch it, but knowing why beats bisecting.
- [ ] Regenerate the manifest: `pnpm manifest`. The suite has a staleness check, so a stale `.rulecast-rules.yaml` fails `pnpm test`.
- [ ] Write the failing `init` tests:
  - interactive, in a project full of `app/api/*.py`: `python/thin-routes` is among the offered choices but **not** in `initialValues`
  - `--yes` in that project: the written config has no `thin-routes` entry
  - `--rules python/thin-routes`: it is installed
  - the choice's `hint` contains `llm`, `haiku` and the word `sends`
- [ ] Implement in `chooseRules`:

  ```ts
  // Spec §6, Consent: an llm rule sends file contents to a third party, so it is never ticked
  // for someone. It is still offered, and --rules still installs it.
  const preselected = available
    .filter((rule) => rule.detector?.kind !== "llm" && files.some((file) => rule.matches(file)))
    .map((rule) => rule.id)
  ```

  One clause, and it covers the non-interactive path too — the line immediately below it is `if (ui.prompter === null) return available.filter(…preselected…)`, which is what `--yes` takes. In the loop that builds `groups`, give an llm rule a hint of the form `llm · haiku · sends file contents to your provider`, reading the model out of `rule.detector.config`, and keep `rule.description ?? rule.name` for every other kind.
- [ ] Update the catalog test: add `"python/thin-routes"` to the `CATALOG` list in `test/catalog.test.ts` and one case for it — a fat route handler that fires and a thin one that does not. The catalog test drives `runPipeline`, so its fixture needs a stub `claude` (`stubAgentCli`) and `llm: { provider: claude-code }` in the fixture config. **This test must never reach a real model.**
- [ ] Update the rule count in `test/commands/init.test.ts`: `rules!.values` goes from 8 to 9. The `PYTHON` preselect list does **not** change — that is the point of this task.
- [ ] Verify: `pnpm vitest run test/catalog.test.ts test/commands/init.test.ts` → passes.
- [ ] `git add packages/rules-python .rulecast-rules.yaml packages/rulecast/src/commands/init.ts packages/rulecast/test/catalog.test.ts packages/rulecast/test/commands/init.test.ts && git commit`

## Task 6: The agent docs

**Files:** modify `agents/reference/detectors.md`, `agents/reference/rule-format.md` · test `test/agents-docs.test.ts` (no change expected — confirm it still passes)

**Behaviour:** an agent drafting rules can write an `llm` rule correctly from the reference alone, and the "Coming later" section is gone.

- [ ] Replace `agents/reference/detectors.md`'s `## Coming later` section with a `## llm` section in the same shape as the others:

  ```yaml
  detect:
    llm:
      model: haiku
      question: >
        Does this route do more than parse input, call a service,
        and return the result? Report each offending line.
      grounding: true
  ```

  covering: `model` is required and has no default (an alias — `haiku`, `sonnet`, `opus`, `fable` — or the exact name your provider uses); `question` is what the model is asked; `grounding` defaults to true and sends the rule's `context` references with the question whatever their delivery mode; one call per file and model, covering every llm rule that selected that file; files with no changed lines are not sent; answers are cached on the file's content, the change set, the model and the rules; capture `{{reason}}`; `{{text}}` is the line from the file, not the model's quote; **default stage is `verify` only** — write `stages: [edit, verify]` to pay for it on every edit; at most `llm.max_files_per_verify` files per verify, most recently edited first.

  End the section with a paragraph that an agent drafting rules must not miss, since `agents/DRAFT-RULES.md` already tells it to prefer `path`, `regex` and `ast-grep`: **an llm rule sends the file's contents and the rule's grounding to the configured provider, costs money on every uncached file, and is the right answer only when no pattern expresses the convention.**
- [ ] Update `agents/reference/rule-format.md:46` — the `llm.*` settings row. `llm.model` is gone, the provider list is the four names, the default provider is `claude-code`, and "(not available yet)" comes off.
- [ ] Verify: `pnpm vitest run test/agents-docs.test.ts` → passes (it checks every link in the agent docs resolves in the repository).
- [ ] `git add agents/reference/detectors.md agents/reference/rule-format.md && git commit`

## Task 7: The spec

**Files:** modify `docs/specs/2026-09-15-rulecast-design.md`

**Behaviour:** the spec describes what was built. Every edit below is a place where the implementation knowingly departs from the text written on 2026-09-15.

- [ ] §6 `llm`, the example (line ~435): add `model: haiku` and keep `grounding: true`.
- [ ] §6 `llm`, **Call shape** (line ~442): "One call per file" → "One call per file and model"; add the sentence that a rule's `model` is required and may be an alias.
- [ ] §6 `llm`, **Providers** (line ~445): the four providers, `claude-code` the default, one line each on what they need — `claude-code` shells out to `claude -p` and needs no credentials; `opencode` shells out to `opencode run`; `anthropic` and `openai-compatible` use `api_key_env` and honour `base_url`.
- [ ] §6 `llm`, **Cache**: add the provider to the key.
- [ ] §4 config example (line ~222) and §12 settings table (line ~274): drop `model`, change the default provider to `claude-code`, and note that `base_url` applies to both HTTP providers.
- [ ] §15 **LLM** (line ~732): "recorded-response fake behind the provider interface; one opt-in live test per provider" → say what it actually is: stub binaries in a fixture's `node_modules/.bin` for the CLI providers, a local `node:http` server for the HTTP ones, and `RULECAST_LLM=1` for one live call per provider.
- [ ] §14 needs **no change** — the "LLM credentials missing" and "Malformed LLM output" rows describe exactly what was built (plan 6b, Decision 3).
- [ ] Verify: `grep -n "claude-haiku-4-5-20251001" docs/specs/2026-09-15-rulecast-design.md` → only inside the alias table, if you added one; no stale `llm.model` default anywhere.
- [ ] `git add docs/specs/2026-09-15-rulecast-design.md && git commit`

## Task 8: Close out plan 6

**Files:** modify `docs/plans/2026-09-15-rulecast-00-index.md`

- [ ] `pnpm test:perf` and record the numbers. `llm` is verify-only, so the edit-hook p50/p95 must still be in plan 5's 207 ms / 229–358 ms range. A jump means something imports or constructs a provider on the edit path.
- [ ] Mark row 6 `Done (2026-09-21)` in the index, listing the three parts and their task counts in the same style as row 5, and note the measured perf number.
- [ ] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` → clean. `ls ~/.cache/rulecast` → absent.
- [ ] `git add docs/plans/2026-09-15-rulecast-00-index.md && git commit && git fetch && git push`

---

## End-to-end verification

From the repository root:

- [ ] `pnpm test` → every test passes. Skipped count is 8: the perf test, three `RULECAST_LINTERS=1` linter tests, and four `RULECAST_LLM=1` live tests.
- [ ] `pnpm typecheck`, `pnpm lint` → clean. `pnpm build` → clean, and `pnpm vitest run test/build.test.ts` still passes (nothing new is statically importing something heavy).
- [ ] `RULECAST_LLM=1 pnpm vitest run test/detectors/llm/live.test.ts` → `claude-code` really calls a model and passes; the others pass or skip by name with a printed reason.
- [ ] `rulecast init` in a scratch Python project with `app/api/users.py`: `python/thin-routes` appears in the rule list, **unticked**, with a hint naming `haiku` and saying file contents are sent. Ticking it and finishing writes it to `.rulecast-config.yaml`; `rulecast run --all-files` then reports the model's judgement on that file.
- [ ] The same project with `rulecast init --yes`: no `thin-routes` in the written config.
- [ ] `rulecast run --all-files --no-llm` in a project with llm rules → no `claude` process is spawned and the exit code ignores them.
- [ ] Switch that project to `llm: { provider: anthropic }` with `ANTHROPIC_API_KEY` unset and run a verify → exactly **one** warning naming every llm rule, not one per rule, and exit 2 (spec §14).
- [ ] `ls ~/.cache/rulecast` → absent.
- [ ] `git log --oneline` → eight commits on top of 6b, one per task, all on `main` and pushed.
