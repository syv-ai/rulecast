# @syv-ai/rulecast

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
