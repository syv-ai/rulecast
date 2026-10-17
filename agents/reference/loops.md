# rulecast in agent loops

An agent loop runs until something tells it to stop. rulecast can be that something: `rulecast run` exits 0 only when every rule ran and nothing new breaks one, and a loop can read an exit code without a model judging a transcript. These recipes use only `rulecast run`, `fix`, `baseline`, `stats`, `test` and `doctor`, with the flags `rulecast <command> --help` lists and the output in [output.md](output.md).

Each recipe was run once, on small scratch repositories. What happened, where the runs differed from the commands shown here, and what was not measured, is in [`docs/evidence/2026-10-16-loop-recipes.md`](../../docs/evidence/2026-10-16-loop-recipes.md).

## Before any loop

A loop usually starts somewhere fresh: a CI job, a cloud session, a new container. Work through the README's [Fresh environments](../../README.md#fresh-environments) checklist first. For loops, three things on it matter most:

- **Unattended mode.** It is on by itself under `CI` or `GITHUB_ACTIONS`. For `claude -p` or `/goal` on your own machine, set `RULECAST_MODE=unattended`. The stop gate then blocks up to `unattended.max_blocks` (10) stops per prompt instead of one, a finding that has blocked twice is reported instead of retried, and the agent is held once more at the end to report what is left. See [Unattended mode](rule-format.md#unattended-mode). `/goal` sends one prompt for the whole run, so there the 10 blocks are a budget for the run.
- **`npx rulecast doctor --ci --from-ref origin/main`** before the agent starts. It exits 2 if rulecast would run degraded: a rule repo missing from the cache, a rule's tool not installed, hooks that cannot run, or no merge base (a shallow clone). Fix that before the loop, not during it.
- **The `loop-safety` pack:** `npx @syv-ai/rulecast init --rules loop-safety`. It catches the shortcuts a loop takes to make a check pass, such as a skipped test, a new `noqa` or an edit to CI. See [loop-safety.md](../../packages/rules-loop-safety/loop-safety.md). How much it catches in real loops is not measured yet.

Agents running in parallel in one working tree each need their own worktree when they change files through the shell ([Agents](../../README.md#agents)).

## A goal that rulecast decides

Claude Code's `/goal` keeps the agent working until a condition holds. Make rulecast's exit code part of the condition:

```text
/goal Add CSV export to the reports page. Done when `npm test` passes and either
`npx rulecast run --from-ref main` exits 0 without any new rulecast-ignore comment, or it
exits 2 or 3 and your final report quotes its output. Exit 2 or 3 means rulecast could not
check everything: do not try to fix that.
```

Headless, the same goal runs as `RULECAST_MODE=unattended claude -p --max-turns 20 "/goal …"`.

- **Why an exit code.** `/goal`'s evaluator is a model reading the transcript. Asked "are the conventions followed?", it judges from what it read. Asked "did `rulecast run --from-ref main` exit 0?", it checks a fact the agent printed, and the judgment of the code was made by rules that give the same answer every time. The evaluator still reads the transcript, so the agent has to run the command where the exit shows. In the recorded run the evaluator quoted it: "`rulecast run --from-ref main` returning `checked 1 changed file`, `no findings`, `exit=0`".
- **Exits 2 and 3 belong in the condition.** They mean rulecast could not run, or some rules did not, and no code edit fixes that. Written as a separate instruction ("if it exits 3, stop and report"), the agent stopped and reported, but the evaluator still found the goal unmet and kept the run going until `--max-turns` ended it. Written into the condition as above, the goal was met on the first stop.
- **Rule out the ignore comment.** When a goal contradicts a rule and nothing forbids it, the agent can make `rulecast run` exit 0 with a `rulecast-ignore` comment. In one recorded run it did exactly that. In unattended mode the agent hooks do not honour an ignore on a line changed during the run: its finding still blocks the stop and ends up in the report. But `rulecast run` does honour it, because it is the same check a person's commit gets, so the goal's own command can still be satisfied that way. Say it in the condition.
- **What `--from-ref main` checks:** everything the branch changed since its merge base with `main`, across sessions and commits. The Stop gate checks only this session's edits; the goal is the wider check.
- **The two Stop hooks.** While a goal is active, its evaluator and rulecast both run on every stop. A rulecast block holds the agent even on a stop where the evaluator says the goal is met: the goal judges its own condition, and rulecast enforces the conventions. Two runs from #24 show this in detail, in [`docs/evidence/2026-10-16-unattended-goal-runs.md`](../../docs/evidence/2026-10-16-unattended-goal-runs.md).

Not measured: whether a rulecast block counts as "no progress" for `/goal`. In the runs so far the goal was either met on the first stop, or `--max-turns` ended the run first.

## A convention-drift sweep

A scheduled job (GitHub Actions `on: schedule`, cron, or Claude Code's `/schedule`) takes one rule's new findings as one batch, fixes them, and opens a draft pull request. It needs a committed baseline ([A committed baseline](../../README.md#a-committed-baseline)). Without one, every legacy finding is new and every run fails. It also needs `jq`, `gh` and the fresh-environment steps above.

```sh
#!/bin/sh
# rulecast-sweep.sh: one rule per run, one draft PR per rule.
set -u
out=$(mktemp -d)
npx rulecast run --all-files --format json > "$out/all.json"
case $? in
  0) echo "nothing new since the baseline"; exit 0 ;;
  1) ;;                                        # new findings: sweep one rule
  *) echo "rulecast did not check everything: see $out/all.json"; exit 1 ;;  # 2 or 3: a person looks
esac

# This run's batch: the rule with the most new errors. Warnings never fail the check, so they are not swept.
rule=$(jq -r '[.findings[] | select(.severity == "error")] | group_by(.rule) | max_by(length) | .[0].rule' "$out/all.json")
git switch -c "rulecast/sweep-$(echo "$rule" | tr / -)-$(date +%Y%m%d)" || exit 1

# Deterministic fixes first, where the rule has one.
if jq -e --arg r "$rule" 'any(.findings[]; .rule == $r and .fixable == true)' "$out/all.json" >/dev/null; then
  npx rulecast fix "$rule" --all-files
fi

# An agent takes what is left of this rule.
npx rulecast run "$rule" --all-files --format json > "$out/batch.json"
case $? in
  0) ;;                                        # rulecast fix fixed them all
  1)
    findings=$(jq -r '.findings[] | "\(.file):\(.line)" as $at
      | if (.message | startswith($at)) then "- \(.message)" else "- \($at) \(.message)" end' "$out/batch.json")
    docs=$(jq -r '.references[] | .content // "Read \(.ref)."' "$out/batch.json")
    task="Fix these findings of the rulecast rule $rule:
$findings

They break this convention:
$docs

Change only the files listed. Do not add rulecast-ignore comments, and do not edit
.rulecast-config.yaml or .rulecast/baseline.json. Finish when \`npx rulecast run $rule --all-files\`
exits 0, or list the findings you could not fix and why."
    RULECAST_MODE=unattended claude -p "$task" --max-turns 30 \
      --permission-mode acceptEdits --allowedTools "Bash(npx rulecast run:*)" ;;
  *) echo "rulecast did not check everything: see $out/batch.json"; exit 1 ;;
esac

npx rulecast run "$rule" --all-files || { echo "findings left: the branch is for a person"; exit 1; }
npx rulecast baseline --prune
git add -u && git commit -m "fix: $rule findings (rulecast sweep)" || exit 1
git push -u origin HEAD || exit 1
jq -r --arg r "$rule" '[.findings[] | select(.rule == $r and .severity == "error")]
  | "\(length) new findings of \($r):\n" + (map("- \(.file):\(.line)") | join("\n"))' "$out/all.json" |
  gh pr create --draft --title "rulecast sweep: $rule" --body-file -
```

Not measured: the agent step with `--permission-mode acceptEdits` and `--allowedTools` on a normal path (the recorded sweep ran the agent with `--dangerously-skip-permissions`, because its scratch repository sat under `~/.claude/`), and `git push` and `gh pr create` against a real remote (they ran against a local bare repository and a stub).

- **One rule per pull request** keeps the review to one doc section and one kind of change.
- **`rulecast fix`** applies the fixes of `regex` and `ast-grep` rules that have one ([Fixes](rule-format.md#fixes)). It fixes pre-existing findings in the selected files too, so a sweep also burns down that rule's backlog, and `baseline --prune` then drops the entries that are gone, in the same pull request. It never touches a finding with a `rulecast-ignore`, and a fix that leaves the rule matching is undone and listed as `unresolved`. `rulecast fix "$rule" --all-files --dry-run` prints the diff and writes nothing. Its JSON is in [output.md](output.md#rulecast-fix).
- **The rest goes to an agent.** A finding with no `fixable: true` needs judgment. The findings and the text of the doc sections they cite (`references[].content`) go in the agent's prompt, not in a file: a headless agent may not be allowed to read a file outside the project.
- **Errors only.** A warning never fails `rulecast run`, so a rule of warnings would leave nothing to fix and nothing to commit. If the commit or the push fails, the script stops before it opens a pull request. `git add -u` stages only files git already tracks: the fixed files and `.rulecast/baseline.json`, not whatever else lies in the checkout.
- **Drift or backlog.** `findings` holds what is new since the baseline. To burn down the backlog instead, choose from `preexisting`.
- **A draft pull request is a proposal.** Nothing merges without review.

## Babysitting a pull request

`/loop` re-runs a prompt in an open Claude Code session at an interval. Pointed at a pull request's branch, with `rulecast run --from-ref` as the check:

```text
/loop 15m Check the branch feat/csv-export of PR #123. git fetch origin, then run
`npx rulecast run --from-ref origin/main --format json`. On exit 1, fix the new findings, run it
again until it exits 0, then commit and push. On exit 0, say so in one line. On 2 or 3, post its
output as a PR comment once and stop the loop. When the PR is merged or closed, stop the loop.
```

- `--from-ref origin/main` is what the README's GitHub Actions job runs, so a clean iteration means a clean CI check. Add `--to-ref HEAD` to check the commits only, not the working tree.
- Each finding has an [id](output.md#finding-ids) that stays the same while its code does, so the loop can tell the same finding from a new one between iterations.
- Run it in the pull request's own worktree, not in a tree another agent is editing.
- **`/loop` needs an open session.** Under `claude -p`, `/loop` schedules its job, runs the prompt once, and the job ends with the process. For a schedule nobody watches, run the prompt's body with `claude -p` from cron or CI instead.

Not measured: whether each `/loop` iteration counts as a new prompt for the stop gate's budget. The session is attended unless you set `RULECAST_MODE`, and attended it blocks once per prompt (`stop_gate.max_blocks: 1`).

## Learning from what the agent hits

`rulecast stats` says, per rule, what became of the findings the agent hooks reported: fixed, kept hitting, silenced, or never fired. A rule the agent keeps hitting or silencing may need a clearer message or a tighter pattern. A rule that never ran may have a `files` pattern that matches nothing; one that ran often and never fired may not be worth keeping. A rule whose block rate climbs with the number of files at a stop (`stopBlocks`) is sometimes wrong.

This takes two steps, and only the first runs unattended:

1. **The loop writes a summary.** The findings log is local: agent hooks write it on the machine where they ran, so a cloud routine or a CI job has none. Run this on the developer's machine, from a local cron job:

   ```sh
   npx rulecast stats --since 30d --format json > stats.json
   jq -r '(.rules[] | select((.noisy | length) > 0 or .repeated > 0 or .suppressed > 0)
       | "- \(.rule): fired \(.fired), repeated \(.repeated), suppressed \(.suppressed), fixed \(.fixed)"
         + (if (.noisy | length) > 0 then ", noisy (\(.noisy | join(", ")))" else "" end)),
     (.neverRan[] | "- \(.): never ran"),
     (.neverFired[] as $r | select(.runs[$r] > 0) | "- \($r): ran \(.runs[$r]) times, never fired")' stats.json > rule-review.md
   ```

   The loop stops there. It can put the summary in an issue or a message for the developer. The keys are in [output.md](output.md#rulecast-stats).
2. **The developer and an agent revise the rules.** In a session with the developer present, the agent follows [DRAFT-RULES.md](../DRAFT-RULES.md), reading the stats first, as its last section says. Each changed rule passes `rulecast test <id> --format json` and `rulecast test <id> --against . --max-rate 0.5 --format json`, and the change goes into a pull request the developer reviews. Merging it is the adoption.

A loop never drafts or adopts a rule on its own. Which conventions rulecast enforces is the developer's decision, and DRAFT-RULES.md stops when nobody is there to make it.

What the counts miss: `suppressed` counts a `rulecast-ignore` added after the finding was reported. An ignore written in the same edit as the code it silences never fired, so it is in no count. `rulecast run --all-files --summary` counts every ignore.

## What a loop can rely on

[output.md](output.md#exit-codes) is the contract. In short:

| Exit | The loop |
|---|---|
| `0` | stops: every rule ran, nothing new of error severity |
| `1` | fixes the new findings and runs again |
| `2` | stops and tells a person: rulecast could not run |
| `3` | stops and tells a person: some rules did not run (`complete: false`, and why under `disabled`) |

In the JSON, `schemaVersion` changes only when a field is removed, renamed or changes meaning ([version policy](output.md#version-policy)). `findings[].id` identifies a finding across runs, and `fixable: true` marks the ones `rulecast fix` can apply.
