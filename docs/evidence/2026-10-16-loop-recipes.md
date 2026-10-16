# The agent-loop recipes, run once each, 2026-10-16

Issue #33. Each recipe in `agents/reference/loops.md` run once, to check that its commands work as written and that the page says what they do. The CLI ran from source (`tsx packages/rulecast/src/cli.ts`) on `loop/integration`, which merges #24–#32. The agent parts were small `claude -p` runs on Claude Code 2.1.301 with `--model haiku`, `--max-turns` 6 or 8. Each cost about a cent.

**What this shows and does not.** That the commands, flags and JSON keys the page uses exist and behave as the page says, on toy repositories, once. Not how well any of it works on a real codebase, how often an agent follows the instructions, or what a sweep costs at scale. Where a run changed the page, it is marked **changed the page**.

## Setup

Every run used its own scratch git repository and cache home (`RULECAST_HOME`), with:

- `docs/conventions.md` with a `## Logging` and an `## Errors` section;
- two local `error` rules: `py/no-print` (regex `\bprint\((?<args>[^)]*)\)`, with `fix: 'logging.info({{args}})'` and a `bad` example with `fixed:`), and `py/no-bare-except` (regex `^\s*except\s*:`, no fix);
- `app/old.py` with a `print`, recorded by `rulecast baseline` and committed;
- the seven Claude Code hooks `rulecast install` writes, each running rulecast from source.

`rulecast` on `PATH` was a two-line wrapper around the source CLI, so the runs used `rulecast` where the page says `npx rulecast`. Nothing was pushed to a network remote and no pull request was opened.

## Before any loop

A shallow clone (`git clone --depth 1 file://…`) of a repository with a `feature` branch:

| Command | Output (abridged) | Exit |
|---|---|---|
| `rulecast doctor --ci --from-ref origin/main` | `error rulecast run --from-ref origin/main — no merge base with origin/main in a shallow clone: fetch full history (actions/checkout: fetch-depth: 0)`; also `warning mode — attended — default …` | 2 |
| after `git fetch --unshallow`, with `RULECAST_MODE=unattended` | `ok mode — unattended — from RULECAST_MODE=unattended; up to 10 blocked stops per prompt` / `ok merge base with origin/main` | 0 |
| a pinned `repos:` entry whose path does not exist, `doctor --ci --from-ref origin/main` | `error …/never-installed-rules.git@v1.0.0 not in the cache — hooks never fetch, so 1 rule would not run; run rulecast install before the agent starts` | 2 |
| the same, `rulecast run --from-ref origin/main --format json` | `complete: false`, `disabled: [{reason: "…: fetch failed: …", rules: ["python/no-mutable-default"]}]`, and the one real finding still reported | **3** |

`docs/evidence/2026-10-16-fresh-environment.md` recorded exit 2 for the same case. That was before #25's contract; it is 3 now, and that file has a note saying so.

## A goal that rulecast decides

Four `/goal` runs with `RULECAST_MODE=unattended`, each on a `feature` branch.

| Run | Goal (abridged) | What happened | Turns, cost |
|---|---|---|---|
| A | `app/report.py` … prints 'report done'. "Done when `rulecast run --from-ref main` exits 0. If it exits 2 or 3, stop and put its output in your final report." | The agent read the config first and wrote `logging` to stdout, ran the check (`exit=0`), and the evaluator said met on the first stop, quoting "`rulecast run --from-ref main` returning `checked 1 changed file`, `no findings`, `exit=0`". `stop_hook_summary`: `hookCount: 2`. | 5, $0.008 |
| B | the same, plus a rule whose `command` detector runs `definitely-missing-tool`; the escape clause as a separate sentence | `rulecast run` exited 3. The agent stopped and reported it, and rulecast's Stop hook held it once to report the rule that did not run. The evaluator found the goal **unmet** at both stops ("no transcript evidence shows the command exiting 0"), and the run ended on `--max-turns` (`error_max_turns`). | 9, $0.012 |
| B′ | the same repository, with the escape written into the condition: "either `rulecast run --from-ref main` exits 0, or it exits 2 or 3 and your final report quotes its output" | Exit 3, the agent quoted the output, the evaluator said met on the first stop, and the run ended normally. **Changed the page:** the recipe puts exits 2 and 3 in the condition. | 8, $0.009 |
| C | `app/hello.py` writes hello "with the print() builtin (not logging), and `rulecast run --from-ref main` exits 0" | The goal contradicts `py/no-print`. The agent read rulecast's source, found `rulecast-ignore`, added `# rulecast-ignore: py/no-print goal requires print() to stdout, not logging`, and `rulecast run` exited 0. It ran out of turns before stopping. **Changed the page:** the recipe's condition rules out new ignore comments. | 9, $0.009 |

A fifth run (D) tried to make a rulecast block and an unmet goal meet on one stop: "writes hello … with print(). Write it straight away … Never add rulecast-ignore comments". rulecast blocked twice and then held the agent to report (`stopBlock`, `stopBlock`, `stopReport` in the session store), as in #24's run 1. But the evaluator said met on the first stop, so again the goal was not open across a block.

**The open question from #24, "does a rulecast block count as no progress for `/goal`?", is still not measured.** In run B the goal stayed unmet across two evaluated stops, one of them with a rulecast block, and `/goal` did not end the run for lack of progress before `--max-turns 8` did. That says only that its guard, if it has one, needs more than two stops.

## A convention-drift sweep

The script on the page, with `npx rulecast` → `rulecast`, `--model haiku --max-turns 8`, and two stubs: `gh` printed its arguments and body, and the `git push` line was not in the copy that ran (the scratch repository has no remote). On `main`: the baselined `app/old.py`, then a commit adding `app/a.py` (one `print`), `app/b.py` (two) and `app/c.py` (one bare `except:`).

`rulecast fix py/no-print --all-files --dry-run` before the sweep: a diff for `app/a.py`, `app/b.py` and **`app/old.py`**, "would fix 4 findings in 3 files (py/no-print ×4)", exit 0. With `--format json`: `dryRun: true`, `fixed` the four sites, `changedFiles: ["app/a.py", "app/b.py", "app/old.py"]`, `unresolved: []`, `findings: []`.

| Sweep | Output (abridged) | Exit |
|---|---|---|
| 1 | branch `rulecast/sweep-py-no-print-20261016`; `fixed 4 findings in 3 files (py/no-print ×4)`; no agent (the rule's check exited 0 after the fix); `baseline: 1 entry no longer found`; `pruned 1 entry: py/no-print app/old.py −1`; one commit, 4 files; the draft PR body "3 new findings of py/no-print: app/a.py:5, app/b.py:5, app/b.py:6" | 0 |
| 2 (after merging 1 into `main` by hand) | branch `rulecast/sweep-py-no-bare-except-20261016`; no fix; the agent changed `except:` to `except (ValueError, TypeError):` in `app/c.py` and nothing else; `nothing to prune`; one commit, 1 file; the draft PR body "1 new findings of py/no-bare-except: app/c.py:7" | 0 |
| 3 (after merging 2) | `nothing new since the baseline` | 0 |

Two earlier attempts at sweep 2 failed, and both **changed the page**:

- `--allowedTools` takes several values, so it swallowed the prompt that followed it: "Input must be provided either through stdin or as a prompt argument". The script now passes the prompt first.
- The script wrote the batch to a temp directory and told the agent to read it. Under `claude -p` the agent was not allowed to: "Claude requested permissions to read from /var/folders/…/batch.json, but you haven't granted it yet". It ran out of turns. The findings and the doc they cite now go in the prompt. In the same attempt the agent's `Edit` was refused as "a sensitive file", because these scratch repositories sit under `~/.claude/`; the run that worked used `--dangerously-skip-permissions` in place of `--permission-mode acceptEdits`, so **`acceptEdits` with `--allowedTools "Bash(npx rulecast run:*)"` is not verified** on a normal path. The allow-list did refuse the agent's compound commands (`rulecast run …; echo "EXIT=$?"`), and it carried on with single ones.

A review of #45 found five more faults in the script. Each was shown on the script as written, then on the fixed one, in a scratch repository with `npx` wrapping the source CLI, `claude` and `gh` as stubs (the `claude` stub saved its prompt and fixed the bare excepts with `sed`), and a local bare repository as `origin`. Rules: `py/no-print` and `py/no-bare-except` as above, plus a `warning` rule `py/no-todo`. All of them **changed the page**:

| Case | The script as it was | Fixed |
|---|---|---|
| 4 `TODO` warnings, 1 `print`, 1 bare `except:` | chose `py/no-todo`; its check exited 0, so no fix and no agent; `git commit` said "nothing to commit", and the script still pushed the branch, ran `gh pr create` and exited 0 | chooses from errors only: `py/no-print`, fixed, pruned, one commit |
| the same with an untracked `stray.txt` | `git add -A` committed `stray.txt`, the commit's only file | `git add -u`: the fixed files and `.rulecast/baseline.json` (tracked since the baseline commit), not `stray.txt` |
| two bare excepts, the agent's turn | the prompt named the doc (`docs/conventions.md#errors`) without its text, and each line read `- app/c.py:3 app/c.py:3 has a bare except…` | the prompt holds the section's text from `references[].content`, and each finding once |
| the per-rule `rulecast run` exiting 3 (simulated by the `npx` wrapper) | the agent was started on an empty list of findings | stops: "rulecast did not check everything" |
| a pre-commit hook that refuses the commit | pushed and opened the pull request anyway, exit 0 | stops before the push, exit 1 |

## Babysitting a pull request

A local bare repository as `origin` (inside the scratch directory), and a `feature` branch with one `print`, pushed there.

`/loop` under `claude -p`: the agent loaded `CronCreate`, scheduled `*/1 * * * *` ("Session-only (not written to disk, dies when Claude exits)"), then ran the body at once: `git fetch origin`, `rulecast run --from-ref origin/main --format json` (exit 1, one finding with its `id`), a fix to a module logger, the check again (exit 0), a commit, and a push to the local `origin`. Then the run ended (8 turns, $0.007) and the scheduled job with it. **So `/loop` is not a loop under `claude -p`: it runs the body once.** The page says so.

An interactive session under `script` (a pseudo-terminal) did not get past Claude Code's folder-trust dialog, so no second iteration ran. **Whether a `/loop` iteration counts as a new prompt for the stop gate's budget is not measured.** The session store of the headless run has one `prompt` record.

## Learning from what the agent hits

Three `claude -p` sessions in one repository, unattended, then `rulecast stats`. The sessions were small real runs, not replayed payloads:

1. "Create app/a.py … prints hi with print()": the edit hook flagged it, the stop gate blocked twice, the agent kept `print` because the prompt asked for it and reported the finding as unresolved (5 turns, $0.005).
2. "Create app/b.py … that logs bye": no finding (2 turns).
3. "Create app/cli.py … print() … with `# rulecast-ignore: py/no-print CLI output goes to stdout` on the line above": written in one edit (2 turns).

```text
3 sessions since 2026-10-16T05:29:07.935Z

rule         fired  blocked  refused  fixed  ignored  suppressed  open  repeated  turns to fix
py/no-print      1        1        0      0        1           0     0         1             -

never fired: py/no-bare-except
```

The page's `jq` summary of `stats --since 30d --format json` gave:

```text
- py/no-print: fired 1, repeated 1, suppressed 0, fixed 0
- py/no-bare-except: never fired
```

Session 3's ignore is in the log (`ign` on its edit and stop records) but in no count: the finding was never reported, so it never fired and cannot be suppressed. That is how `stats` defines its counts (`core/stats/derive.ts`), and the page now says so. In run C above, where the ignore came after the finding had been reported, `stats` counted `suppressed: 1`.

The second step, drafting rule changes with the developer, was not run: it needs the developer (D38).
