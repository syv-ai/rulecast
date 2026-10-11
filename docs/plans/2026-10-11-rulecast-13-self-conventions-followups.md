# rulecast Plan 13 — Follow-ups from rulecast on rulecast

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1 and 4 have an open decision: ask the developer before starting either.

**Goal:** Close the friction that running rulecast on its own repository found on 2026-10-11 and that was too large to fix in place, and burn down the two pieces of convention backlog no rule can see.

**Evidence:** `docs/evidence/2026-10-11-self-conventions.md`. Small friction from that trial was fixed in the same session (validate naming a file twice, `uninstall` leaving `{}`, `init` silent when the catalog matches nothing, `test --against` needing a rule id, two DRAFT-RULES gaps); what is here is what was not.

**Stack:** Node ≥ 20.12, TypeScript 5, zod 3, vitest.

Prerequisite: none. Each task ships on its own.

---

## Task 1 — `refuse_write` that knows who may write the file

**The defect.** `generated/no-hand-edit` was drafted as a `path` rule with `refuse_write: true` on `.rulecast-rules.yaml`, the npm README, `LICENSE` and `version.ts`. Replaying hook payloads (`PreToolUse Bash` → change the file → `PostToolUse Bash` → `Stop`) showed that an agent running `pnpm manifest` through Bash — the exact remedy the rule's message names — is told "This file is protected; revert your change" and its Stop is blocked. The same holds for `CHANGELOG.md` and the version line under `pnpm version-packages`. rulecast's own config ships these as touch rules instead, with a comment pointing here.

The cause is plan 11 Decision 5: a `refuse_write` finding in a file a Bash call changed is reported and blocks Stop, because nothing can know what a command will write. That is right for `sed -i` and wrong for the project's own generator, and the rule format has no way to say which is which. It is the general case of generated code, which `agents/reference/rule-format.md` names as the first use of `refuse_write`: every project that protects a generated client also regenerates it from the shell.

**Open decision (ask first):** how a rule names its writers. Candidates:

- (a) `refuse_write: { allow_commands: ['^pnpm (manifest|readme|sync-version)\b'] }` — a regex over the Bash command. Simple; matches what the agent typed, so `pnpm run manifest` or `cd x && pnpm manifest` needs the pattern to allow it.
- (b) `written_by: [...]` as its own key beside `refuse_write: true`, same matching. Keeps `refuse_write` a boolean; one more key.
- (c) No key: a `refuse_write` finding after a Bash call whose file's new content equals what `git` would produce… not computable in general. Listed to rule it out.

Whichever is chosen, an `Edit`/`Write` to the file is still refused: the allowance is for a command, never for the edit tools.

- [ ] Ask the developer (a) or (b).
- [ ] The key, as four changes: `core/config/schema.ts`, `core/compile/rule.ts` (compile the regexes; a diagnostic for one that does not compile), spec §4 and §9 (Guard, shell writes), `agents/reference/rule-format.md` "Refusing a write".
- [ ] `core/pipeline.ts` shell-after: the Bash command reaches the comparison (`Event` already carries it for the adapter; the core sees it as an opaque string). A `refuse_write` finding in a changed file whose rule allows that command is delivered as an ordinary finding of its severity, not as protected; it does not block Stop on its own.
- [ ] Tests: the replay above as a pipeline test — allowed command, Stop not blocked; `sed -i` on the same file, blocked; an `Edit` to the file, refused.
- [ ] rulecast's own config: `generated/no-hand-edit` back to `path` + `refuse_write` with the allowance; delete the comment that points here.

## Task 2 — An environment on `DetectorRun`

**The backlog.** `detectors/llm/detector.ts` hands `process.env` to its provider, because `DetectorRun` carries no environment (`DetectorCheck` does). It is the one violation of `process/no-global-env-or-cwd` left in `src/`, and it means a test cannot give a run a different API key than the process has.

- [ ] `env: Readonly<Record<string, string | undefined>>` on `DetectorRun` (`core/types.ts`), exported through `src/index.ts`.
- [ ] Thread it from `CliIo.env` through every path that builds a run: the pipeline input (`hook`, `run`), the guard, baseline staging, `rulecast test` (`core/examples.ts`), `--against`. The contract suite (`testing/detector-contract.ts`) passes an empty one.
- [ ] `llm/detector.ts` uses `input.env`. Remove the **Backlog** line under "Read env and cwd from what you were handed" in `docs/conventions.md`.
- [ ] Test: an `anthropic`-provider run whose `env` names a key the process does not have reaches `fakeApi` with it.

## Task 3 — `doctor` names the binary the hooks run

**The friction.** In this repository `npx @syv-ai/rulecast` resolves to the workspace link (`node_modules/.bin/rulecast` → `packages/rulecast/dist`), not to npm, and `rulecast --version` prints `0.5.0` either way. The hooks `install` writes run the same link. `doctor` reported "hooks ok" while running from the published 0.5.0 that `npx -y @syv-ai/rulecast@0.5.0` fetched — a different binary from the one the hooks run, and nothing said so. In a user's project the two can differ the same way (a global install, an npx cache, a stale local version).

- [ ] `doctor`'s hooks section prints the path the hook command resolves to and that binary's `--version`, and warns when it differs from the running version.
- [ ] Test with a fixture whose `node_modules/.bin/rulecast` is a stub printing another version.

## Task 4 — How rulecast's own hooks find rulecast

**The friction.** The agent hooks run `node_modules/.bin/rulecast`, the workspace build in `dist/`. lefthook runs rulecast from source with `tsx` precisely because `dist/` can be stale or missing; the agent hooks cannot, because `install` owns their command and `SETUP.md` forbids editing it. So in a session that changes the rule format, the agent hooks judge with yesterday's build — the failure the 2026-09-28 trial already hit (`Unrecognized key(s) in object: 'examples'`).

**Open decision (ask first):**

- (a) `"prepare": "lefthook install && pnpm build"` at the root, so a fresh `pnpm install` always leaves a current `dist/`. Staleness during a session remains.
- (b) Leave it, and say in `AGENTS.md`: after a change to the rule format or the compiler, run `pnpm build` before trusting the agent hooks.
- (c) Both.

- [ ] Ask; implement; record the choice in `AGENTS.md`.

## Task 5 — Smaller friction

- [ ] `validate` still names the file twice for a YAML parse error (`broken.yaml: broken.yaml: Flow sequence…`): `readYamlFile` puts the name in its message for every other caller. Move the name to the callers that print it alone (`doctor`, the hook's warnings), and keep `test/commands/validate.test.ts` "a file that is neither a config nor a manifest" honest about the change.
- [ ] `rulecast run --all-files --summary` counts every file a `path` rule matches as a violation, so a `refuse_write` rule over four generated files reads as "4 violations". A `path` rule's stock is its scope by definition: list such rules as "protects N files" instead of in the violation table.
- [ ] `uninstall` removed every hook and printed one line per file, but a file it now deletes is reported the same way as one it rewrote. Say "removed .claude/settings.json (nothing else was in it)".

## Task 6 — Convention backlog no rule sees

- [ ] `.github/workflows/release.yml` "Tag and release" is a 25-line inline shell step with a retry loop. "Workflows that follow a release are called" says a step longer than one command is a script: move it to `packages/rulecast/scripts/` and run it from the step, with a test of its failure path.
- [ ] `core/session/decide.ts` builds the warning text "…and N more (run rulecast validate)". It is priced correctly through `deliveryCost.warning`, but it is rendered text living in the budget, which "The renderer prices its own output" forbids. Move it beside `backlogMoreLine` in `core/delivery/render-agent.ts`.
