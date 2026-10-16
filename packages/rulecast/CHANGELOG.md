# @syv-ai/rulecast

## 0.6.0

### Minor Changes

- c19d72e: A `command` rule can run any tool that works as a pre-commit hook, with config only:
  
  - `output` reads `sarif`, `json`, `checkstyle`, `gitlab` (code-quality JSON, which ty prints), `rdjson`, or lines: `{ lines: gcc }`, `{ lines: gcc-nocol }`, `{ lines: msbuild }`, or `{ lines: { pattern: "<regex with named groups file, line, message…>" } }`.
  - `stream: stderr | both` reads a tool that reports on stderr.
  - `rules: [...]` keeps only findings with those rule ids.
  - `exit_codes: { error: [2, 101] }` names the exit codes that mean the tool failed; such a run is a rule error carrying the tool's stderr. Other exit codes are findings-or-clean, as before.
  - `scope: project` runs the tool on the whole project without files and keeps the findings in the rule's files: type checkers, dead-code and duplication tools. It runs at verify only unless `stages` says otherwise. In a staged `rulecast run` it runs on the working tree when the rule's files there match the index, and is skipped with a warning naming the files when they don't. rulecast never stashes.
  
  Rules that call the same command share one run, so three semgrep rules scan once.
- 37fe900: `command` rules carry `{{message}}`, `{{ruleId}}` and `{{severity}}` for every finding, from whatever the tool reported. A SARIF finding's `{{ruleId}}` is its `ruleId` and its end column is kept.
  
  **Changed:** a `command` finding's `{{text}}` is now the source at the finding's range, as for `linter` rules. Before, a SARIF finding's `{{text}}` was the tool's message; use `{{message}}` for that. A JSON result's own `text` field still wins.
  
  SARIF results that passed, did not apply or were suppressed are no longer findings, and a uri relative to a `uriBaseId` the run declares is resolved against it. Empty output is no findings in every format.
- 3333711: A committed baseline for full-repository runs. `rulecast baseline` runs every rule over every file and writes `.rulecast/baseline.json`, the ids of the findings there are today. Commit it, and `rulecast run --all-files` or `--files` treats those findings as pre-existing and exits 0 unless something new appears. That is the gate a nightly sweep or a scheduled agent loop needs when it has no ref to diff against.
  
  - `rulecast baseline --prune` drops the entries that are no longer found. It never adds one, keeps the entries of rules that did not run, and leaves the file untouched when nothing changed.
  - `rulecast baseline --force` rewrites the file. Without it, an existing baseline is not overwritten, so recording new findings is a visible step.
  - `rulecast baseline` gives metered (llm) rules every file, past `llm.max_files_per_verify`. With `--no-llm` it names the rules it left out, and `--force` keeps the old entries of every rule that did not run.
  - An entry whose rule no longer has the `verify` stage is stale, like one whose rule or file is gone.
  - `run` says when entries are no longer found (`baseline: 3 entries no longer found …`), and `--format json` has a new `baseline` key: `{ file, entries, matched, stale }`, or `null`.
  - A session, `--from-ref` and a staged commit's `HEAD` keep their own baseline. Agent hooks never read the file.
  - `rulecast doctor` reports the baseline's size, when it was added and when it last changed, taken from git.
  - `.rulecast/.gitignore` now lets `baseline.json` through. One written by an earlier rulecast is updated the next time it is used, unless it was edited. When another ignore file excludes `.rulecast/`, `rulecast baseline` names the pattern to narrow. And no rule ever checks files under `.rulecast/`.
  
  Where a ref exists, `--from-ref` is still the better baseline: it never needs maintaining.
- 8606098: Plugin detectors can declare three new optional things: `wholeProject(config)` (the tool needs the real project, so a staged run uses the working tree when the rule's files match it, and skips the rule otherwise), `changesFiles` (the tool may change files while it runs; it runs after every other kind, alone), and `validate({ rules, cwd })` (static checks against the project's files, reported by `rulecast validate`).
- e42fd8a: New command: `rulecast stats [--since 30d] [--format terminal|json]`. It shows, per rule, what became of the findings rulecast reported to agents: how many fired, were blocked at a stop, were fixed (and after how many turns), were left in place at a stop, were silenced with `rulecast-ignore`, or were prevented (a refused write the agent gave up on). It flags noisy rules, the ones the agent keeps hitting or silencing, and lists rules that never fired. In unattended mode, where an ignore silences nothing on code the agent changed, ignores the agent added or changed still count towards a rule being flagged as one the agent keeps silencing. `--format json` is a documented contract (`agents/reference/output.md`), for loops that improve rules.
  
  To get these numbers, agent hooks now append a small record per edit check, refused write and stop to `findings.jsonl` in the project's cache directory. A record holds finding ids, rule ids, file paths and line numbers only, never code or messages, and never leaves the machine. The file rotates at 4 MiB, a hook never fails because it could not be written, and `rulecast clean` removes it. `rulecast run`, git hooks and CI write nothing to it.
- f285003: New `rulecast fix` command: rules whose violations have a mechanical fix can now carry that fix, and rulecast applies it for you instead of an agent fixing each one by hand.
  
  - A `regex` rule takes `fix:` in the message's `{{name}}` syntax: `fix: "log.info({{args}})"`. An `ast-grep` rule takes ast-grep's own syntax: `fix: "logger.debug($$$ARGS)"`. No other detector accepts `fix`, and `rulecast validate` says so.
  - `rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A)` fixes every finding of those rules in the files, old ones too, then checks the files as `rulecast run` does and exits with `run`'s codes. `--dry-run` prints the diff and writes nothing. A fix that leaves its own finding in place is undone and reported as unresolved, so running the command twice changes nothing the second time (unless fixes were still pending after 10 passes: then it writes what it got and says to run it again). Findings with a `rulecast-ignore` comment are left alone, and a file where a fix would move that comment away from its finding is left unchanged. It never writes through a symlink (the file or a directory in its path), outside the project, to a file that is not UTF-8 or that changed while it was fixing, or to a file whose fixes keep undoing each other; it says which files it left and why, and a file it cannot write does not stop the others.
  - A fix has to be proven: a rule with `fix` needs at least one `bad` example, or its fix is dropped with a warning (the rule itself still runs). `rulecast test` applies the fix to every bad example and fails if the rule still fires on the result, or if the result differs from the example's optional `fixed:` text. `rulecast fix` runs the same check before it applies anything.
  - Agent hooks never apply a fix. rulecast still never rewrites an agent's file behind its back.
  - `--format json` marks a finding `"fixable": true` when `rulecast fix` can fix it, so a loop can send those to `rulecast fix` and the rest to an agent. The key is absent otherwise.
  - Plugin API: a detector can declare `fixable(config)` and attach a `fix` (a text edit) to its findings when `DetectorRun.fixes` is set. The detector contract suite has optional cases for it.
- 01ebbb4: rulecast no longer goes quiet in a fresh environment, such as a CI job, a cloud agent session or a new container, when it is configured but cannot run some of its rules. Common causes are a pinned rule repo that was never fetched (`rulecast install` was not run), a linter or script that is not installed, and a rule that fails to compile.
  
  - **Agent hooks, unattended mode:** every stop names the rules that did not run and why, for example "2 rules disabled: …@v1.0.0: not in the cache (run rulecast install)". When nothing else blocks, the main agent is held once per prompt and told to state in its final report that those checks did not run; a block for findings earlier in the prompt counts as that hold. It is told not to repair rulecast's setup itself. A block for findings lists the rules that were not checked. Attended sessions are unchanged: the problem is said once.
  - **`rulecast run`** says `incomplete: N rules did not run` instead of reading as clean, and `--format json` has a new `disabled` key: `[{ "reason", "rules" }]`. `run --session` also names rules the agent's session had disabled.
  - **`rulecast doctor --ci`** checks what a headless run needs: pinned repos as the hooks will find them (hooks never fetch, and `doctor --ci` does not either), detector dependencies, hooks that cannot run, the mode, and with `--from-ref REF` whether a merge base can be found. It exits 2 when rulecast would run degraded. It is on by itself when `CI` or `GITHUB_ACTIONS` is set.
  - **The hook command changed.** When rulecast is not installed (no `node_modules`) and the run is unattended by its environment (`RULECAST_MODE=unattended`, `CI` or `GITHUB_ACTIONS`), every stop now says so. To get it, run `rulecast install` again and commit `.claude/settings.json`. It upgrades the command from any earlier release, also in a clone that has not installed its dependencies yet.
  
  The README has a "Fresh environments" checklist under "Git hooks and CI".
- 05d0f70: The `linter` detector supports gitleaks, for hard-coded secrets: `linter: { tool: gitleaks }`, optionally narrowed with `rules: [aws-access-token, ...]`. It runs on edits as well as verify, reads staged content on stdin, and honours the project's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments. A gitleaks finding's `{{text}}` is always `[redacted]`, so the secret is never repeated into an agent's context, a log or SARIF.
- f16e3bf: A new `hook` detector runs a hook the project already declares, so its findings reach the agent with the doc section the rule cites:
  
  - `hook: { pre-commit: mypy }` runs a hook from `.pre-commit-config.yaml` through prek when it is installed, else pre-commit, on the rule's files (`run <id> --files …`, which never stashes). A hook that only runs at another stage is run at that stage.
  - `hook: { lefthook: pre-commit/typecheck }` runs a lefthook job's own command with the rule's files in place of `{staged_files}`, `{files}`, `{all_files}` and `{push_files}`, without `lefthook run`, which can install git hooks.
  - `output` (default `{ lines: gcc }`), `rules` and `exit_codes` work as for `command`.
  - A hook that changes a file (a formatter) has the file put back, and each changed file is a finding: "<hook> would change this file". rulecast never rewrites an agent's file behind its back.
  - A hook that fails with output no format reads is one finding carrying its first lines.
  
  Hook rules run at verify unless `stages` says otherwise, and in a staged run they run on the working tree when the rule's files there match the index. husky hooks are shell scripts with nothing structured to read: use `command` with the script's command.
- 31d4ff2: `rulecast init` offers the project's own pre-commit and lefthook hooks as `hook` rules, shown in the review before anything is written. Hooks that look like formatters or fixers are offered but not ticked; hooks that run rulecast itself and pre-commit `meta` hooks are left out. Each rule cites the config that declares the hook until it is pointed at a convention. `--no-hooks` skips them.
- 05d0f70: A `linter` rule now turns on the rules it names instead of only reporting what the project's linter config already enables: ruff gets `--extend-select`, oxlint `-D` and eslint `--rule`. A rule asking for ruff `S110` used to find nothing in a project whose config didn't select it, which is most projects. Inline suppressions still hold, and so do ruff's `per-file-ignores` and oxlint's `overrides`. Rules without a `rules` list still see only what the project's config reports; they get a run of their own.
- f22e042: A new catalog pack, `loop-safety`, for agents that run with nobody watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes. The pack catches those shortcuts as they are written:
  
  - `loop-safety/no-skipped-tests-python`, `-ts` and `-js`: a new pytest skip or xfail, a unittest skip, or a `.skip`, `.only`, `.todo`, `.failing`, `xit`, `fit` or `this.skip()` in a test file.
  - `loop-safety/no-deleted-assertions-python`, `-ts` and `-js`: a test file with fewer assertions than before the change (`assert`, unittest and mock `assert*` calls, `pytest.raises`, `expect()`, `assert()`). A commented-out assertion counts as removed.
  - `loop-safety/no-new-suppressions`: a new `noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `biome-ignore` or coverage pragma.
  - `loop-safety/no-config-suppressions-python` and `-js`: the same shortcut in a checker's config, such as a mypy `ignore_missing_imports` override, a ruff or flake8 `ignore` entry, pytest `--deselect` in `addopts`, an ESLint or Biome rule set to `"off"`, or `"strict": false` in `tsconfig.json`.
  - `loop-safety/no-lowered-thresholds`: an edit to a coverage threshold or to `--max-warnings`.
  - `loop-safety/protected-loop-config`: an edit to CI workflows, git hooks, `.rulecast-config.yaml` or `.claude/settings.json`.
  
  Only what the change adds is flagged, never what was already there; the deleted-assertion rules compare the file's assertion count with its baseline instead. Each finding tells the agent to fix the code, or to leave the test failing and report why it believes the test is wrong, and links the pack's doc, which explains how a developer makes such a change on purpose. The rules are warnings while someone is watching. In unattended mode (set `RULECAST_MODE=unattended` or `mode: unattended` for `/goal`, `claude -p` and scheduled runs; on by itself in CI) they are errors, and edits to the loop's configuration are refused before they are written. `rulecast init` offers the pack but never ticks it for you, unless the config already says `mode: unattended`. `rulecast init --rules loop-safety` installs all of it.
  
  Three rule-format changes come with it:
  
  - `scope: removed`: a match is something the code should keep, and the finding is a file with fewer matches than at its baseline: the session's, `run --from-ref`'s merge base, or `HEAD` in a staged run. It is judged when the agent stops, not after each edit, so an assertion moved over two edits is not reported. It needs a `regex` or `ast-grep` detector and reports nothing without a baseline (`run --all-files`). `rulecast test --against` does not count a removed rule, since its matches are not violations. Its message says how many went with `{{removed}}` and `{{baseline}}`; its `{{text}}` is always `removed`, so deleting one more is the same finding, and an unattended run is not blocked afresh for each one.
  - `escalate: true` on a rule makes it an error in unattended mode, the same as listing it in `unattended.escalate`. Set `escalate: false` on a catalog rule's entry to turn that off.
  - A rule's `minimum_rulecast_version` is now checked before the rest of the rule. A rule that uses a key added in a newer rulecast now says to upgrade, instead of failing on the key it does not know.
  
  Fixed: a file the agent changed with its shell and then read kept the read as its baseline, so the change was no longer new at the stop, and a deleted assertion was no longer counted. A read now never replaces the baseline of a file the session already changed.
- 89f366a: **Breaking for plugin detectors:** `runTool` now resolves to `{ stdout, stderr, exitCode }` instead of the stdout string, so a detector can tell a tool's "found something" exit code from its "I failed" one. Replace `await runTool(...)` with `(await runTool(...)).stdout` to keep the old behaviour. The `ToolResult` type is exported.
- be7a668: `rulecast run` has a stable output contract that scripts and agent loops can rely on. It is written down in `agents/reference/output.md`.
  
  - **Every finding has an `id`.** It is a hash of the rule, the file and the finding's source line, not its line number, so the same violation keeps its id when lines are added above it, and changes it when its line is edited. That lets a loop tell "the same finding as last run" from a new one. Findings also carry `endLine`. A detector can set `wholeFile: true` on a `Match` that is about the file as a whole, or `redacted: true` on one whose source is a secret; either id then hashes the match's text and captures instead of its line.
  - **The JSON has `schemaVersion: 1` and `complete`.** It also lists pre-existing findings in full under `preexisting`, and ignored findings carry their `id`. Adding a field leaves the version alone; removing, renaming or changing one bumps it.
  - **The SARIF is richer.** Each result has `partialFingerprints` (the id), `baselineState` (`new`, or `unchanged` for pre-existing findings, which are now included so code scanning does not read them as fixed) and `endLine`. Each rule in `tool.driver.rules` has its name, description, severity, and help text taken from the doc sections it cites. `invocations` says whether the run was complete.
  
  **Breaking:**
  
  - **Exit codes changed** for `run` and `try-repo`: `0` clean, `1` new error findings, `2` rulecast could not run, `3` incomplete. A rule that fails to compile, a rule repo that cannot be fetched, a detector that fails and a verify timeout used to exit 2 and hide the findings of the other rules. They now exit 3, with those findings still printed; so does `run --session` when the session had disabled a rule that would have run. `run RULE_ID` is incomplete only over that rule. `try-repo` still exits 2 when the repo it tries cannot be fetched. `3` wins over `1`. The table is in the README and in `rulecast run --help`.
  - **A config file that does not load** (bad YAML or schema, `minimum_rulecast_version` too new) is now an error on stderr with exit 2 and nothing on stdout, instead of a report that checked nothing. Agent hooks still warn, as before.
  - **`Finding` has two new required fields**, `id` and `endLine`. An adapter or tool that builds `Finding` values itself must set them.
  - The session store's `fingerprint` record is renamed `container`. A session that is running while rulecast is upgraded ignores its old records and classifies `scope: container` rules by line until it measures them again.
- 1fa1d80: `rulecast test` can gate a rule an agent drafted, so a loop can check one without reading terminal text:
  
  - **`--format json`** prints one document: per rule a `status`, and per example what it expected, what the rule found and, when it failed, why. It has its own `schemaVersion: 1`. The fields are in `agents/reference/output.md`.
  - **A `bad` example can pin what it finds** with `expect: { count: 2 }` or `expect: { lines: [3, 7] }`. `lines` is compared as a set. Without `expect`, a `bad` example still passes on at least one finding.
  - **A new `baseline` list** holds edits: `{ path, before, after, expect: { new: [...], preexisting: [...] } }`. `rulecast test` sorts the rule's findings in `after` into new and pre-existing by the rule's `scope`, the way an agent session would. This catches a rule that reports code an edit did not touch as new.
  - **`--against PATH --max-rate 0.5`** exits 1 when a rule flags more than that share of the files it matches. It is not applied under 25 matching files.
  
  `rulecast validate` rejects an `expect` on a `good` example, an empty `expect`, an expected line past the end of its example, and a `count` below the number of `lines` it pins. `agents/DRAFT-RULES.md` now asks for these expectations and gates on `--against . --max-rate 0.5`.
  
  `rulecast test` without a rule id now exits 1 when a rule failed to compile, with its diagnostic on stderr; it used to leave the rule out and pass. A config that does not load exits 2. Terminal output is otherwise unchanged without the new flags.
  
  **Breaking, for plugin code only:** the exported `RuleExamples` type has a required `baseline` list, and `bad` examples are `BadRuleExample` (exported, with the optional `expect`). Code that builds a `RuleExamples` value itself must add `baseline: []`.
- 9f07938: Unattended mode, for agent runs that nobody is watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. Until now the stop gate blocked a stop once per user prompt. A loop sends one prompt, so it got one block per run, and after that the findings went to a message that nobody read.
  
  Set `RULECAST_MODE=unattended`, or `mode: unattended` in `.rulecast-config.yaml`. The environment variable wins over the config. When neither is set, `CI` or `GITHUB_ACTIONS` turns the mode on. In unattended mode:
  
  - Every stop with new error findings is blocked, up to `unattended.max_blocks` (default 10) per prompt.
  - A finding that has blocked two stops is reported instead of blocked again, so a false positive cannot loop. A protected file changed with the shell keeps blocking until it is reverted.
  - When the budget is spent, or only repeated findings are left, the agent is held once more and told to record the findings as unresolved in its final report. Before, they went only to a message for the user.
  - The block message tells the agent that nobody is there to ask. If it disputes a finding, it records the finding in the run's decisions file or final report instead of asking the user.
  - In unattended mode a `rulecast-ignore` does not silence a finding on a line the agent changed during the run, whoever wrote the comment; ignores on code the run did not touch keep working. This holds in the stop gate and in `refuse_write`'s refusal.
  - `unattended.escalate: [rule-id, ...]` makes chosen warning rules errors, and `refuse_write: unattended` makes a rule refuse writes only in this mode.
  
  The mode applies to agent hooks only. `rulecast run`, in a git hook or a CI job, always runs the rules as written, so a CI job's exit code does not change. `rulecast run --session <id>` runs in the mode the session's hooks ran in, so it lists the same findings the stop blocks on. `rulecast doctor` shows the active mode and where it came from. Attended behaviour is unchanged.

### Patch Changes

- 53a4a3f: New docs page: rulecast in agent loops (`agents/reference/loops.md`, on the site under Guides as "Agent loops"). It has recipes for running rulecast inside agent loops that nobody watches:
  
  - a checklist before any loop: unattended mode, `rulecast doctor --ci`, and the `loop-safety` pack;
  - a Claude Code `/goal` whose condition is `rulecast run --from-ref main` exiting 0, worded so that exits 2 and 3 end the run with a report instead of looping;
  - a scheduled convention-drift sweep: one rule's new errors per run, `rulecast fix` for the ones it can fix, an agent for the rest, `rulecast baseline --prune`, and a draft pull request;
  - babysitting a pull request with `/loop` and `rulecast run --from-ref`;
  - reading `rulecast stats` to find noisy and dead rules, with the rules themselves revised together with the developer in a reviewed pull request.
  
  The output contract (`agents/reference/output.md`) now lists the `disabled` key of `rulecast run --format json`: the rules that did not run, and why.
- a325666: Hooks fail open when the cache home cannot be created: the hook exited 2 if `RULECAST_HOME` (or `~/.cache`) was unwritable, because it parsed the payload and created its state directory before its error handling. `rulecast run --from-ref` now checks files with non-ASCII names, which git listed quoted and no rule matched. `init` finds the git root through the same scrubbed environment as every other git call, so a `GIT_DIR` inherited from a git hook no longer names another repository.
  
  `rulecast test --against <paths>` without a rule id counts every rule, one line each. `uninstall` removes a settings file it leaves empty instead of writing `{}`. `init --yes` says when nothing in the catalog applies to the project's files. `validate` names the file once in a rule's diagnostic.
- 8d04795: A subagent's stop is now blocked only by findings in files that subagent edited. Before, it could be blocked by a file the main agent or another subagent changed, and was then asked to fix code it never touched. The main agent's stop still checks every file the session changed. A change no agent's tool call made is reported at the main agent's stop, and at a subagent's only when that subagent's own shell calls found it.
  
  Agents running in parallel in one working tree that change files with the shell can still be blamed for each other's writes: a shell command is held to every file that changed while it ran. Give parallel agents their own worktrees. An agent whose shell call overlaps another agent's, and that is held to files changed while it ran, is now told so, once per session, with the same advice.

## 0.5.0

### Minor Changes

- f440ea2: **Files the agent changes with Bash are now checked during the session.** Until now only `Edit` and `Write` were watched, so a rule broken with `sed -i`, a Python one-liner or a `>` redirect went unseen until a git hook or CI caught it. rulecast now records the working tree before and after each Bash call, and what changed during the call goes through the same check as an `Edit`: the finding arrives right after the call, titled "changed by your Bash command", and Stop is blocked until it is fixed. Run `rulecast install` again to add the Bash hooks to an existing install; `rulecast doctor` says when they are missing.
  
  **`refuse_write` catches shell writes.** A command cannot be refused before it runs, because nothing knows what it will write, so a protected file changed with Bash is caught right after: the agent is told the file is protected and how to revert it (`git checkout -- <file>`, or "undo only your change" when the file had your uncommitted work), Stop is blocked until it does, whatever the rule's severity, and you get a notice naming the file.
  
  **Changes nobody's tool call explains are reported, and never block.** Your own edits in another editor, a formatter, a job the agent left running: rulecast finds them by comparing the tree between calls and at Stop, reports them under "changed outside your tool calls", and never lets them stop the agent from finishing. On an allowed Stop they are shown to you.
  
  **Your uncommitted work stays yours.** At session start rulecast snapshots the files that are already dirty, so an agent that reads a file with `cat` and rewrites it with `sed` is judged only on the lines it added, not on yours. A `git stash && git stash pop`, a commit or a checkout during a call is not counted as an edit.
  
  The hook before each Bash call only records the tree. On a 20,000-file repository it adds 135–150 ms at p95; on an ordinary one, a few milliseconds. Outside a git repository rulecast says once that it cannot see the tree, and Bash edits are left to git hooks and CI as before.

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
