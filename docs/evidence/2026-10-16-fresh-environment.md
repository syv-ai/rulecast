# Fresh environments: rules that cannot run, 2026-10-16

Issue #29. Two headless `claude -p` runs where rulecast was configured but could not run some or all of its rules, to see whether the agent and the person reading the run's log find out.

**What this shows and does not.** Two small runs on Claude Code 2.1.301 with `--model haiku`, `--max-turns` 6 and 4. They show what reaches the model and what reaches the output. They say nothing about how often agents follow the instruction across tasks or models.

## Setup

Both runs used a throwaway git repository with `docs/conventions.md` and two `repos:` entries in `.rulecast-config.yaml`:

- `local`: one regex rule, `py/no-print`.
- A pinned repo, `<scratch>/never-installed-rules.git@v1.0.0`, with two rules (`python/no-bare-except`, `python/no-mutable-default`). The path does not exist, so it can never be fetched and is never in the cache. A local path was used so that no network or credential prompt could be involved.

`RULECAST_MODE=unattended` was set, `RULECAST_HOME` was a scratch directory, and stdin was `/dev/null`.

## Run 1: a rule repo missing from the cache

The hooks were the ones `rulecast install` writes, each running rulecast from source (`tsx packages/rulecast/src/cli.ts hook claude-code`). The task was "Create app.py with a function run() that logs hello using the logging module, called under if __name__ == '__main__'. Write a short final report when done."

| Event | rulecast | Where it shows |
|---|---|---|
| SessionStart | "rulecast problems: …never-installed-rules.git@v1.0.0: not in the cache (run rulecast install)" | `hook_response`: the user only, once |
| Stop 1 | **block** (`incomplete`): the preamble, then "- 2 rules disabled: …@v1.0.0: not in the cache (run rulecast install)" | reaches the model as `Stop hook feedback:` |
| Stop 2 | allowed, with a system message: "rulecast: rules that did not run: 2 rules disabled: …" | stream-json `system` / `informational`, "Stop says: …"; not the model |

The session store holds a single `{"t":"incompleteReport","agent":"main"}`, so the agent was held once. The agent's last message, which `claude -p` prints as its result:

> **Checks that did not run:** rulecast disabled 2 of this project's rules, so the work was not checked against them. The rule `never-installed-rules.git@v1.0.0` is not in the rulecast cache (the hook says to run `rulecast install`). I did not try to repair rulecast's setup.

The run used 6 turns and cost $0.005. The agent ran no `rulecast` command and did not touch `.rulecast-config.yaml` or `.claude/settings.json`. It called the repo "the rule" in its report, but the count and the cause are right.

`rulecast run --all-files` in the same repository (it fetches, and the fetch fails) ended with `no findings · incomplete: 2 rules did not run (see above)` and exit 2, and `--format json` gave `disabled: [{reason: "…: fetch failed: …", rules: ["python/no-bare-except", "python/no-mutable-default"]}]`. `CI=true rulecast doctor` printed the `ci` section with "error … not in the cache — hooks never fetch, so 2 rules would not run; run rulecast install before the agent starts", and exited 2.

> **Note, added later:** the exit 2 above was recorded before #25's output contract was merged. Under it, a run where some rules did not run is incomplete and exits **3**; 2 now means rulecast could not run at all. The same setup re-run on the integration branch exited 3 (`docs/evidence/2026-10-16-loop-recipes.md`). The record above is left as it was.

## Run 2: rulecast not installed

The same project with the hook command `rulecast install` writes when `node_modules/.bin/rulecast` exists (the guarded `LOCAL_COMMAND`), committed, and `node_modules` then removed. This is a clone where nobody ran `npm ci`. The task was "Create app.py that logs hello with the logging module. Reply in one sentence."

- SessionStart: "rulecast is configured in this project but not installed. Run npm install (or pnpm install), then rulecast doctor." This message is for the user.
- Stop: `informational`, "Stop says: rulecast is configured in this project but not installed: no rules ran this session. Run npm ci (or pnpm install) before starting the agent."
- Every other hook exited 0 silently. There was no hook error, and the run ended normally after 4 turns.

The guard cannot block, because it has no state to hold the agent only once per prompt. So in this case the model is never told; only the log says it.

## What this settles

- **A Stop hook's `systemMessage` is in the headless output, not the model's context.** `claude -p --output-format stream-json` shows it as a `system` entry, `subtype: "informational"`, with each line prefixed `Stop says: `. This is recorded in `packages/rulecast/test/payloads/claude-code/README.md`. That makes the once-per-prompt `incomplete` block the guarantee that the agent's report mentions the missing checks. The message at every stop is for whoever reads the log.
- **Report, don't repair, held.** Told not to repair rulecast's setup, the agent did not try.

The fixture tests cover the rest: `packages/rulecast/test/commands/hook-unattended.test.ts` (a repo never installed, a missing tool, CI, attended unchanged, a subagent stop), `test/adapters/claude-code/command.test.ts` (the guard), `test/commands/doctor.test.ts` (`--ci`), and `test/commands/run.test.ts`.
