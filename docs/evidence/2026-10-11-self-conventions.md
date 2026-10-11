# rulecast on rulecast, again, 2026-10-11

The first self-install (`2026-09-28-self-install.md`) wrote four rules, measured zero violations and
said so plainly: that proves compliance is free here, not that enforcement works. This trial threw
that install away and started from the conventions. It wrote 80 of them, granular and cynical,
turned them into 75 rules, and installed everything the way a new user would, from the published
`@syv-ai/rulecast@0.5.0` and the docs the README points an agent at.

**What this shows and does not.** It shows the rules find real defects once the conventions are
specific enough: seven, four of them user-visible, all fixed (`a325666`). It shows the hooks deliver
inside a live Claude Code session — the session that did this work received the test conventions
the first time it opened a test file, and was told about backlog in files it touched without being
blamed for it. It does not show how often an agent breaks these rules: `--against` counts the stock,
and 47 of 57 pattern rules measured zero in a repository that already follows them. That still needs
edit history.

## How it was run

- `rulecast uninstall`, then the old `.rulecast-config.yaml` and `docs/conventions.md` deleted.
- `docs/conventions.md` rewritten from four read-only research passes: the 44 `fix` commits, every
  plan's decisions and reviews with the spec, a map of `src/` for shortcut risks, and the tests,
  catalog, agent docs and release machinery. About 120 candidates, merged to 80, every named
  function verified to exist.
- `init --yes --agent claude-code`, as `agents/SETUP.md` says, then `agents/DRAFT-RULES.md` against
  the new doc.
- The open questions — where the conventions live, what they bind, what to do with the defects the
  rules found, whether to release — were first taken as defaults and then put to the developer,
  who asked why they had not been asked. Four rule-tuning questions were asked before the first
  commit; no convention was put to the developer. None of the 80 was the developer's choice. That
  is the reason the scope below is "all code".
- The lesson is rulecast's as well as the session's. Its docs let it happen:

  | Where | What it said | What it licensed |
  |---|---|---|
  | `DRAFT-RULES.md` line 12 | "If no developer is there to answer (you were told to work unattended, or nobody replies), don't wait: take the default" | The agent called itself unattended without asking anything |
  | `DRAFT-RULES.md` step 7 | "Unattended, keep every rule that passes step 5" | Enforcing every rule nobody agreed to |
  | `DRAFT-RULES.md`, `SETUP.md`, `init` | All assume a doc that already states the conventions | With none, the agent wrote its own, from the code |

  Plan 14 removes the unattended mode and makes the developer the source of the conventions.

## What the user path did

```
$ npx -y @syv-ai/rulecast@0.5.0 init --yes --agent claude-code

Detected
typescript · AGENTS.md · 50 other docs · Claude Code (.claude/)

Review
.rulecast-config.yaml  new, no rules yet
.claude/settings.json  +11 hooks (Claude Code)

Validate
rulecast validate: 0 rules valid

Draft rules for your own conventions. Paste this into your coding agent:
Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.5.0/agents/DRAFT-RULES.md
and follow it to draft rulecast rules for this project from AGENTS.md.
```

All eleven 0.5.0 hooks were installed: `Edit|Write` before and after, `Read`, `Bash` before, after
and on failure, `Stop`, `SubagentStop`, `UserPromptSubmit`, `SessionStart startup|resume|compact`
and `clear|fork`. `doctor` said "no problems found".

Friction, in the order it was met:

1. **`npx @syv-ai/rulecast` here is not npm.** The root `package.json` depends on the workspace
   package, so npx runs `node_modules/.bin/rulecast` → `packages/rulecast/dist`. `--version` prints
   `0.5.0` either way; only `npx -c 'command -v rulecast'` tells them apart. An agent following
   `SETUP.md` in this repository runs the local build without knowing. Pinning
   (`npx -y @syv-ai/rulecast@0.5.0`) reaches npm. Outside a repository that depends on rulecast this
   is the right behaviour, so the fix is visibility: plan 13, Task 3.
2. **`uninstall` left `.claude/settings.json` as `{}`.** It removed every hook it had added and wrote
   back the empty object, so the file `install` created outlived it. **Fixed:** a settings file left
   with nothing in it is removed.
3. **"new, no rules yet"** is still all `init` says when the catalog matches nothing — open since the
   first trial. A config with `rules: []` reads as a dead one. **Fixed:** with `--yes`, `init` now
   says "Nothing in <catalog> applies to this project's files. Draft rules from your own docs."
4. **The drafting prompt names `AGENTS.md`, which only points at the conventions.** The developer
   chose to keep the conventions in `docs/conventions.md` (80 sections would bury `AGENTS.md`) with
   a pointer from `AGENTS.md`. An agent following the prompt reads a pointer and drafts from it.
   **Fixed in `DRAFT-RULES.md`:** step 1 follows a doc that says its conventions live elsewhere, and
   drafts from that.
5. **`doctor` checked the hooks' presence, not which binary they run.** It ran as the published
   0.5.0 and reported the hooks, which run the workspace `dist/`, as ok. Plan 13, Task 3.

## Drafting

DRAFT-RULES worked as written for 57 pattern rules and 18 touch rules, with four things worth
recording.

- **`rulecast test --against` needed a rule id**, and DRAFT-RULES asks for every rule's counts, so
  the counts took a 57-iteration shell loop. **Fixed:** without an id it prints one line per rule;
  metered rules are named and not run.
- **`validate` named the file twice**: `.rulecast-config.yaml: .rulecast-config.yaml (rule): …`.
  **Fixed** for diagnostics about a rule; a YAML parse error still doubles it (plan 13, Task 5).
- **A `regex` sees comments.** `process/no-global-env-or-cwd` first flagged a doc comment that says
  "without reaching for process.env", and `tests/no-real-home` a comment naming `~/.cache/rulecast`.
  The first moved to `ast-grep`, which matches code. **Fixed in `DRAFT-RULES.md`:** a pattern whose
  only hits are prose is a slip, and `ast-grep` is the fix.
- **Volume-checking caught four false positives before they shipped.** `exec` in this codebase is a
  local alias of promisified `execFile`, so a "no `exec(`" rule flagged every safe spawn; a version
  rule flagged SARIF's `"2.1.0"`; a lock rule flagged `warm.ts`'s own, unrelated lock. Each was
  narrowed and re-measured. This is the `--against` loop doing its job, and the reason to run it on
  every rule rather than the ones that look risky.

Two slips (`execFileAsync` missing from an alternation, `` `/private${dir}` `` not matched) were
fixed as slips; no rule needed its meaning revised twice, and none fell back to `llm`.

## The defect that mattered: a protected file the remedy writes

`generated/no-hand-edit` was drafted as `refuse_write` on the four generated files, as
`rule-format.md` recommends for generated code. Replaying hook payloads — `PreToolUse Bash`, the file
changes, `PostToolUse Bash`, `Stop` — showed what happens when an agent does what the rule's message
tells it to and runs `pnpm manifest`:

```
rulecast: 1 rule violated in .rulecast-rules.yaml, changed by your Bash command
error generated/no-hand-edit
  .rulecast-rules.yaml is generated. Edit its source … and run `pnpm manifest` …
.rulecast-rules.yaml (generated/no-hand-edit): This file is protected; revert your change.
  git checkout -- .rulecast-rules.yaml
```

and the Stop is blocked. The remedy is reported as the violation. Plan 11 made a shell write to a
protected file block Stop because nothing can know what a command will write — right for `sed -i`,
wrong for the project's own generator — and the rule format cannot say which commands may write the
file. **Every project that protects generated code and regenerates it from the shell has this.**

The repository's own rules ship these as touch rules for now, decided with the developer, with a
comment pointing at plan 13 Task 1, which adds a way for a `refuse_write` rule to name its writers.

## What the rules found

Measured before any fix: **34 violations in 19 files** across 10 rules. After the fix commit:
**19 in 9**.

| Rule | Found | Outcome |
|---|---|---|
| (none; found by research) | `commands/hook.ts` parsed the payload and created its state directory before its `try`: an unwritable cache home made the hook exit 2 | Fixed, with a test |
| `git/nul-separated` | `changedFilesSince` listed paths without `-z`: git returned `"caf\303\251.ts"` and `run --from-ref` never checked the file | Fixed, with a test that reproduced it |
| `git/through-core` | `init` spawned git itself, skipping the `GIT_DIR` scrub | Fixed |
| `adapters/no-default-over-events` | the Claude Code adapter's `default: return NONE` over `EventKind` | Fixed; a new kind now fails the type-check (verified) |
| `perf/group-in-place` | 6 groupings that copy the group per item | Fixed |
| `errors/*`, `data/no-json-cast` | inline `ENOENT`, `errorMessage` spelled out twice, a cast `package.json` | Fixed |
| `spawn/stdin-epipe` | `live.test.ts` ended stdin with no `EPIPE` handler | Fixed |
| (research) | `integrations/pre-commit.test.ts` ran rulecast with the developer's real cache home | Fixed |
| `process/no-global-env-or-cwd` | `llm/detector.ts` reads `process.env`: `DetectorRun` has no `env` | Backlog: plan 13, Task 2 |
| `tests/no-raised-timeout` | 18 per-test timeouts in 8 files, most in perf and integration tests | Backlog, by the developer's choice |

The first row is the one to remember: the fail-open invariant, the oldest in the spec, was broken in
the file whose doc comment states it. No pattern rule sees it; a touch rule now delivers the section
to whoever opens that file.

## The configuration

- 80 conventions in `docs/conventions.md`, one `##` each; `AGENTS.md` points at it.
- 57 pattern rules (54 `regex`, 3 `ast-grep`; no `path`, `command`, `linter` or `llm`), every one
  with two good and two bad examples, all passing.
- 18 touch rules, one per area, delivering 35 conventions no pattern can express.
- Scope: all code — `packages/rulecast`, the catalog packages, `agents/`, the README, the site's
  generated pages, the workflows.
- 47 pattern rules measured zero before the fixes. Each guards a shortcut taken at least once in `git log` or forbidden
  by a decision in a plan; the developer kept all of them, style rules included.

A finding while writing the doc: **a section runs to the next heading, so anything between the last
paragraph and that heading is delivered with it.** The `---` separators between areas arrived at the
end of the section before each one. Removed; worth a sentence in `rule-format.md` if it bites again.

## Cost, measured here

Ten runs each of the workspace build against `packages/rulecast/src/core/types.ts`, 75 rules, Apple
M3 Pro, load ~5, timed from a shell (so including ~30 ms of process start the earlier table did not
have):

| hook | median | max |
|---|---|---|
| `touch` (PostToolUse on Read) | 203 ms | 207 ms |
| `edit` (PostToolUse on Edit) | 220 ms | 230 ms |
| `guard` (PreToolUse) | 198 ms | 205 ms |

Against 106–141 ms for four rules on 2026-09-28, under the 500 ms budget. The three `ast-grep` rules
load the native module on every edit of a TypeScript file.

## How rulecast's own hooks find rulecast

Unchanged and undecided: the agent hooks run `node_modules/.bin/rulecast`, the workspace `dist/`,
while lefthook runs the source with `tsx`. After a change to the rule format the agent hooks judge
with a stale build until `pnpm build`. Plan 13 Task 4 puts the choice to the developer.

## Open

- Plan 13: `refuse_write` writers, `DetectorRun.env`, `doctor` naming the hook binary, the dogfood
  binary, smaller friction, and two pieces of convention backlog no rule sees (`release.yml`'s inline
  step, a rendered string in `decide.ts`).
- The interactive `init` on a monorepo, by hand, with a TTY — still never run.
- The fixes ship with the next release: a changeset is in `.changeset/`. Until a release, the docs
  site keeps building from 0.5.0's README and agent docs.
