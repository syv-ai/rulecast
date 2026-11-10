# Advanced

Most projects need none of this. The commands for it are under [Advanced commands](commands.md#advanced-commands).

## Several agents at once

- Each subagent's stop checks only the files it edited, so it is never asked to fix another agent's code.
- The main agent's stop checks everything the session changed, so a problem that only shows when two subagents' changes meet is caught there. A file two subagents both edit can block either.
- A change no agent's tool call made, such as your own edit, is reported at the main agent's stop.

With agents in parallel in one working tree, a file one agent changed with Edit or Write stays that agent's even while another's shell command runs. What two agents' shell commands change at the same time can't be told apart: both are held to it, and neither is told to `git checkout` a protected file the other may have written. Give parallel agents their own worktrees (in Claude Code, a subagent with `isolation: worktree`).

## Git operations during a turn

A commit, pull, merge or checkout is not an edit. Lines a pull or merge brings into a file the agent edited are not counted as the agent's, as long as their commits predate the operation. The agent's own commits stay its own.

One gap: a command that edits files and commits them in one go (`fmt && git commit`) counts only as a git operation, so files it alone changed are not checked.

## Fresh environments

A CI job, a cloud agent session or a new container starts with nothing installed. In unattended mode every stop says which rules did not run and why ("2 rules disabled: …: not in the cache"), and `rulecast run` reports `incomplete`. To have nothing to report:

1. Install rulecast where the hooks find it before the agent starts: `npm ci` for a devDependency, or the command under [Install](../README.md#install).
2. Run `rulecast install` (`npx rulecast install` for a devDependency). It fetches the pinned rule repos; hooks never fetch.
3. Run `rulecast doctor --ci` (`npx rulecast doctor --ci` for a devDependency) before the agent step. It fetches nothing, and exits 2 if a rule repo is missing from the cache, a rule's tool isn't installed, or the hooks can't run. Add `--from-ref origin/main` when the job also runs `rulecast run --from-ref`.
4. Check out with `fetch-depth: 0` if you use `--from-ref`.
5. Unattended mode is on under `CI` or `GITHUB_ACTIONS`. Elsewhere set `RULECAST_MODE=unattended`.
6. End the loop with `rulecast run --from-ref …`. It is the gate that counts.
7. Optionally cache `~/.cache/rulecast/repos` between jobs (keyed on `.rulecast-config.yaml`) to save a clone per job.

A new git worktree on the same machine needs only step 1: rule repos are cached per user, not per checkout. On macOS, the first edit in a new worktree is slower: macOS checks each executable the first time it runs from a new path, such as a `command` script or a `node_modules/.bin` shim. Run them once beforehand.

## A committed baseline

A scheduled full-repository run, such as a nightly sweep or an agent loop told to keep `main` clean, has no ref to diff against, so every [backlog](adopting-rules.md) violation is new. Record what is there today:

```sh
rulecast baseline            # writes .rulecast/baseline.json
git add .rulecast/baseline.json && git commit -m "rulecast baseline"
rulecast run --all-files     # exits 0 unless something got worse
```

- `run --all-files` and `run --files` treat the listed findings as pre-existing. Sessions, `--from-ref` and staged commits keep their own baseline; hooks never read the file.
- Entries are [finding ids](../agents/reference/output.md#finding-ids): editing a baselined line's offending text, or moving its file, makes the finding new.
- When an entry is no longer found, the run says so. `rulecast baseline --prune` drops those entries, never adds any, and keeps the entries of rules that did not run. Run it in the pull request that fixes them.
- `rulecast baseline --force` rewrites the file with today's findings. That is an amnesty, and it shows in review as one.
- `llm` rules are included unless you pass `--no-llm`; expect their entries to churn.
- `rulecast doctor` reports the baseline's size, when it was added and when it last changed.

Where a ref exists, `--from-ref` is the better baseline: it never needs maintaining.
