# @syv-ai/rulecast

## 0.4.0

### Minor Changes

- be50597: Two fixes found by measuring rather than reading, and a plugin API a third-party detector or adapter can use without reaching into `/internal`.
  
  **Fixed: a deadline that passed could switch a rule off for the whole session.** When an `ast-grep` rule failed after the edit deadline had passed but before the abort signal had fired — which is what happens when native parsing holds the event loop — it was recorded as a rule error, so the rule was disabled for the rest of the session and the run marked failed. It is now a timeout, logged and tried again at the next verify, as it always was for `regex` and `path`. `linter` and `llm` had the same shape and now share the same check.
  
  **Fixed: the context budget now spends exactly what the agent is sent.** The budget estimated a delivery's size with hand-tuned constants. Trimming seeded random deliveries across a sweep of limits, 5,708 of 24,000 rendered over their limit, by up to 500 characters; the adapter's slack absorbed it, so no agent saw a cut, but the budget was not keeping its own promise. The renderer now prices its own output and none overflow. Three causes: a block with findings cut was measured as if nothing were cut, every block was charged one character short, and a backlog with every summary cut still printed its heading and count. Exact prices also admit more — a doc section shorter than the "read this, too long" line that would replace it is no longer demoted to that line.
  
  **The plugin API is closed, and held closed.** `@syv-ai/rulecast` exported `CompiledRule` but not three types its own fields are declared with — `Stage`, `ReferenceSpec`, `RuleExamples` — so a third-party detector or adapter could not name them from either entry point. They are exported, with `RuleExample`, `renderAgentText` and `RenderOptions` (the budget is computed against this renderer, so an adapter should wrap it rather than replace it), and `lineStarts`, `positionAt` and `offsetAt`. A type-level check in the test suite fails if the public entry point names a type it does not export again.
  
  **A detector says what it is, instead of the core knowing its name.** `Detector` gains optional `metered`, `cost(config)`, `fileBudget(settings)`, `timeoutHint` and `wholeFile`. The `llm` detector declares the first four and `path` the last; everything the core used to do because a kind was called `"llm"` — never preselecting it in `init`, never fingerprinting it, budgeting its files, not dry-running it in `doctor` — it now does for any detector that declares `metered`. One wording changed as a result: `doctor` now says llm rules are not dry-run "(each run costs money)" rather than "(a model call costs money)".
  
  **Helpers for a detector that hands paths to another program**, on the plugin API: `repoRelative`/`repoRelativeTo` (handles a SARIF `file://` URI and a root reached through a symlink), `runTool` (a non-zero exit is an answer, a missing binary is an error), `sourceReader` and `pastDeadline`. `command` and `linter` each carried their own copies.
- 3d9b25a: rulecast reports the same line the same way in an agent hook, a git hook and CI. A team gets from `init` to a firing hook without a trap. The agent is told what to do with what it receives, and cannot quietly edit its way past the gate.
  
  **Changed: `rulecast run` with no file flags judges what is being committed.** It checks the staged files, reads their content from the index rather than the working tree, and classifies findings against `HEAD`. A line the commit did not change is backlog: shown, and never failing the commit. Before, a docstring added above an existing violation failed the commit, and a violation staged and then fixed only in the working tree passed. With nothing staged it says so and points at `--all-files`, and every run says how many files it checked. `llm` rules are skipped in this mode unless you pass `--llm`, and one line says so: a commit should not cost money.
  
  **`--to-ref B` reads content at `B`.** Pre-push and CI judge what is pushed, not whatever is uncommitted. `--from-ref` alone still reads the working tree. In a shallow clone, the error names `fetch-depth: 0`. `ruff` and `eslint` are handed the staged or committed content on stdin under the file's real path, so path-keyed configuration still applies; `command` scripts and `oxlint` get a scratch copy inside the project.
  
  **Git hooks and CI.** The repository ships a `.pre-commit-hooks.yaml` with `rulecast` (pre-commit) and `rulecast-push` (the pushed range), and the README has lefthook and GitHub Actions recipes, including SARIF upload. rulecast installs no git hooks itself.
  
  **Turning things off.** `enabled: false` switches a rule off, catalog rules included. `# rulecast-ignore: <rule-id> <reason>` on the matched line or the line above drops one finding; the reason is required. `run --all-files --summary` counts ignores.
  
  **The developer hears what the agent should not be the only one to see.** When an agent session changes `.rulecast-config.yaml` or adds an ignore, the developer is told at Stop through a `systemMessage`. Rule and detector warnings go there too, instead of into the model's context. The block reason tells the agent to say so when it thinks a finding is wrong rather than edit the config, and the backlog heading says to leave old violations alone unless asked. Overflow files and `read`-mode references now live in `<project>/.rulecast/`, which ignores itself: Claude Code blocks reads under `~/.cache` by default.
  
  **`init` installs hooks.** When no agent is detected, every supported adapter is preselected, interactively and under `--yes`; `--no-agents` installs none. The convention prompt defaults to the project's own doc heading when one matches the rule's doc.
  
  **A hook whose rulecast is not installed yet stays quiet.** The hook command exits 0 when `node_modules/.bin/rulecast` is missing (a fresh clone before `npm install`) and says so once, at session start. `rulecast install` upgrades rulecast's own stale hook entries, and `doctor` warns about them.
  
  **Commands that say what they did.** `rulecast list` shows every configured rule, catalog rules included: source, files and how many project files they match, what its detector looks for (a regex's pattern, an llm rule's question), the doc sections it cites; `rulecast list <rule-id>` adds the files it matches, the rule's message and the text of those sections; `--format json` too. `--version`, `help <command>` and `<command> --help` work. Validation errors say what to do (`unknown key "prompt" (did you mean "question"?)`). `test --against` prints one note chosen by the count, and says when there are too few matching files for the count to mean anything; `--against .` from the project root now means the whole project instead of being refused. A failing example shows what the detector matched, line breaks included, and bare `rulecast test` lists the `llm` rules it did not run. `doctor`'s dry run names the one file it tried out of how many. `validate` takes any file name and tells a config from a manifest by content.
  
  **The agent docs.** `DRAFT-RULES.md` starts from `rulecast list`. A convention a catalog rule already enforces gets a `context` override pointing at the project's doc. Examples with nothing real to quote are invented and labelled as invented. For each catalog rule it asks two questions separately, which section it should cite and whether what it checks fits the project, with a check for each. It covers conventions that are only partly checkable or require something to be present, and what to do when no developer is there to answer.
  
  **Catalog: `python/layering` reaches route modules.** It matched only `routes/`, `services/` and `crud/` directories, so a project with `app/api/routes.py` or `app/crud.py` never got the layering section. It now matches those layers as a directory or a single module, `api/` and `routers/` included, and leaves out tests.

## 0.3.0

### Minor Changes

- c83362b: Three changes drawn from measurements of where rulecast was weak, and a `doctor` fix.
  
  **`scope: instance | container` on a rule.** A rule can say whether its convention belongs to the token the detector matched or to the node around it. `instance` is the default and is what every rule did before. `container` classifies a finding as new only when the node it spans was not already violating the rule at the baseline, which is what a `slim-routes`-shaped rule needs: measured over 1,377 agent-written sites, line overlap scored precision 0.62 there and the container comparison 0.76. The baseline records what a container rule matched when it snapshots a file, so the edit path still runs each detector exactly once and no file content is stored.
  
  **`rulecast run --all-files` prints an adoption backlog**, and `--summary` prints it alone; `--format json` gains a `backlog` object. Counts, never a percentage: one codebase went from 61 violations in 80 files to 57 in 194 over eight months — the rate fell from 76% to 29% while the count stood still, because new code complied and the old violations were only diluted. Pre-existing findings in a hook delivery are now headed as a backlog and name the command that shows all of it, instead of reading as "not blocking, ignore this".
  
  **`rulecast test`**, with an `examples` rule key holding `good` and `bad` cases. It runs them and scores each rule; `rulecast test <id> --against <paths>` fires the rule over real files and reports how much it would flag, so a rule that nobody breaks or that everybody breaks is visible before adoption rather than after. Every catalog rule now ships examples. `agents/DRAFT-RULES.md` no longer asks an agent to pick a detector tier up front: the same convention scored P 0.99 as a pattern under one wording and P 0.70 under a stricter one, so the flow is now attempt a pattern, measure it, and fall back to `llm` only on failure.
  
  **Fixed:** `rulecast doctor` reported hooks as `ok` when the command they run is on neither the PATH nor `node_modules/.bin` — installed, and silently doing nothing on every event. It now warns and names the lever.

## 0.2.0

### Minor Changes

- 8578864: Warnings can no longer crowd findings out of a delivery, and a very large file can no longer hold
  up a write.
  
  Eighty rules that fail to compile used to produce eighty warnings — 13,500 characters against a
  9,000 character budget — and the one rule that still worked was dropped whole, so the agent was
  told eighty times that rulecast was broken and nothing about its own code. A rule repo pinned to a
  rev that has moved does exactly this, and that is the moment the working rules matter most.
  
  Two changes. Compile diagnostics and detector errors now collapse above three of a kind into one
  line with a count and an example — "80 rules failed to compile and were skipped — run rulecast
  validate" — keyed so that a rule breaking later in the session is still announced. And warnings are
  charged against the context budget *after* the findings rather than before them, capped at a share
  of it, so no number of warnings of any kind can cost the agent a finding it could act on. The other
  warnings are untouched: each already names a specific setting to change.
  
  New config key **`max_file_bytes`** (default 1 MiB). `ast-grep` parses in native code, which the
  timeout that bounds `regex` cannot interrupt, and the pre-write guard runs it before the agent's
  write is allowed: a 5 MB proposed write measured 942 ms of a blocked agent. Files over the ceiling
  are now skipped by the in-process detectors (`regex`, `path`, `ast-grep`) on edit and on guard, and
  the same write returns in 1 ms. `verify`, which has seconds to spend, always runs. A skipped file is
  written to the debug log, not delivered as a warning, and does not mark the run failed.
- 2533d3b: The stop gate reads what was found, not what fitted the context budget.
  
  A rule the budget dropped was filtered out of the delivery before the stop gate read it, so the agent could stop with an unresolved error and nothing reached it.
  
  Breaking: the package entry point is now the plugin API. `compile`, `runPipeline`, `cacheHome` and the rest of rulecast's own machinery moved to `@syv-ai/rulecast/internal`, and `rulecast run --format json` no longer carries `templates`, `omitted` or `overflowPath`.
- a55c674: Three ways rulecast could stop responding, found by stress testing and fixed.
  
  A rule that fired tens of thousands of times in one file — which an ordinary pattern does to a
  generated or minified file — made the delivery take time proportional to the square of its matches:
  62,000 matches took 5.9 seconds, and an 8 megabyte file never finished at all. Findings are now
  grouped in place, and that file completes in a second.
  
  A regex that backtracks exponentially could hold the edit hook, and the pre-write guard, open
  indefinitely. The deadline could not stop it — the matching is synchronous, so the timer that would
  fire the deadline never got to run — and the hook then reported the run as having finished on time.
  Matching is now bounded by a timeout V8 can actually enforce, and a missed deadline is recorded as
  one.
  
  A session store with a half-written record in the middle of it threw out of the hook. It now runs
  without session memory and says so, which is what the failure policy always specified.
  
  Detectors now receive `deadlineAt` on `DetectorRun`: the wall-clock time after which their results
  are discarded. A detector whose work is synchronous needs it, because `signal` cannot reach it.

## 0.1.1

### Patch Changes

- 193ec4a: Published through npm trusted publishing.
  
  Releases are now authorised by the release workflow's own OIDC identity rather than by a long-lived npm token, and every published tarball carries a provenance attestation tying it to the workflow run that built it. There is no npm publish token in the repository.

## 0.1.0

### Minor Changes

- cfee5bd: First release.
  
  rulecast delivers a project's conventions to a coding agent at the moment the agent is about to break one. A rule pairs a check with a message and a pointer to the doc section that explains it; rulecast runs as an agent hook, so the agent gets both in the same turn as the edit.
  
  - **Rules** in `.rulecast-config.yaml`, in pre-commit's style: local rules, or rules from a git rule repo pinned by tag. `rulecast autoupdate` moves the pins; `rulecast try-repo` runs a repo without configuring it.
  - **Six detectors**: `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint) and `llm`. The first four run on every edit; `llm` runs only when the agent stops, names its own model, and speaks to Claude Code, OpenCode, the Anthropic API or any OpenAI-compatible endpoint.
  - **Claude Code adapter**, written against recorded hook payloads. The edit hook is budgeted under 500 ms at p95 and measured at p50 173 ms / p95 199 ms on an Apple M3 Pro with all six detectors configured. The pre-write hook adds about 80 ms per Edit or Write.
  - **Only what changed**: a per-session baseline separates findings the agent just introduced from what was already there, so an agent is told about its own work rather than the whole repository's.
  - **`refuse_write`** refuses the edit itself, before the file changes: the agent is shown the rule's message and the doc section it cites in place of the tool's result. It rests only on the text the agent is writing, gives up rather than guess when an edit cannot be reconstructed exactly, and refuses once per file per session, so a rule can stop a mistake without trapping the agent.
  - **A message is printed once**, not once per match: a rule that fired eleven times shows its message with `{name}` in place of its variables and one line per site under it. Under a hook's context budget, every rule that fired keeps a finding and the section it cites; repeats go first, then pre-existing summaries, then doc contents. A delivery too large even for that is written whole to the cache and the message ends with its path.
  - **`rulecast init`** detects the project, offers catalog rules that apply to its files, installs the hooks and prints a prompt for drafting rules from your own docs. **`rulecast doctor`** says why a rule is quiet: what compiled, which binaries, parsers and credentials are actually there, where the hooks and caches live, and what every rule matches today.
  - **Rule packages** for general, Python and React projects, and agent-facing docs under `agents/` so an agent can set rulecast up and draft rules itself.
  - Published to npm as `@syv-ai/rulecast`, with standalone Linux and macOS binaries on GitHub Releases.
