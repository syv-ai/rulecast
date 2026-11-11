# Git hooks and CI

The same rule reports the same line the same way in an agent hook, a git hook and CI. A finding is new when it matches a line you changed. One that was already there is [backlog](adopting-rules.md).

| Where | Command | Checks |
|---|---|---|
| pre-commit | `rulecast run` | Staged files, read from the index, judged against `HEAD`. `llm` rules are skipped unless you pass `--llm`: a commit should not cost money |
| pre-push and CI | `rulecast run --from-ref A --to-ref B` | Files changed between the merge base with `A` and `B`, read at `B` (the working tree without `--to-ref`). Runs `llm` rules on changed files |
| a scheduled sweep or agent loop | `rulecast run --all-files` | Everything, against a [committed baseline](adopting-rules.md#a-committed-baseline); exits 0 unless something got worse. Recipes: [`agents/reference/loops.md`](../agents/reference/loops.md) |

rulecast doesn't install git hooks. Add it to the hook manager you already use. Both entries below look for rulecast in the same order as the agent hooks ([What gets written](https://syv-ai.github.io/rulecast/how-it-works/#what-gets-written)).

## pre-commit

In `.pre-commit-config.yaml`:

```yaml
minimum_pre_commit_version: "3.2.0"
default_install_hook_types: [pre-commit, pre-push]
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.13.0
    hooks:
      - id: rulecast
      - id: rulecast-push
```

## lefthook

In `lefthook.yml`:

```yaml
pre-commit:
  jobs:
    - name: rulecast
      run: sh -c '[ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast run; if command -v rulecast >/dev/null 2>&1; then rulecast run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; exec "${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast" run' --
pre-push:
  jobs:
    - name: rulecast
      run: sh -c '[ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; if command -v rulecast >/dev/null 2>&1; then rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; exec "${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast" run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD' --
```

## GitHub Actions

```yaml
on: pull_request
jobs:
  rulecast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # rulecast needs the merge base with the target branch
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx rulecast run --from-ref origin/${{ github.base_ref }} --format sarif > rulecast.sarif
      - uses: github/codeql-action/upload-sarif@v4
        if: always() # rulecast exits 1 on findings and 3 when a rule could not run, which is when the upload matters
        with:
          sarif_file: rulecast.sarif
```

The example has rulecast as a devDependency. Without one, put the install command from [Install](../README.md#install) in place of `setup-node` and `npm ci` (or after them, if the job needs Node), which puts `rulecast` on the job's PATH, and run `rulecast` where the example runs `npx rulecast`.

## CI jobs and cloud agents

A CI job, a cloud agent session or a new container starts with nothing installed. In unattended mode every stop says which rules did not run and why ("2 rules disabled: …: not in the cache"), and `rulecast run` reports `incomplete`. To have nothing to report, in the order the job runs:

1. Check out with `fetch-depth: 0` if you use `--from-ref`: a shallow clone has no merge base.
2. Install rulecast where the hooks find it, before the agent starts: `npm ci` for a devDependency, or the command under [Install](../README.md#install).
3. Run `rulecast install` (`npx rulecast install` for a devDependency). It fetches the pinned rule repos; hooks never fetch.
4. Set the mode. Unattended mode is on under `CI` or `GITHUB_ACTIONS`; elsewhere set `RULECAST_MODE=unattended`.
5. Run `rulecast doctor --ci` (`npx rulecast doctor --ci` for a devDependency). It fetches nothing, and exits 2 if a rule repo is missing from the cache, a rule's tool isn't installed, or the hooks can't run. Add `--from-ref origin/main` when the job also runs `rulecast run --from-ref`.
6. Run the agent.
7. End with `rulecast run --from-ref …`. It is the gate that counts.

To save a clone per job, cache `~/.cache/rulecast/repos` between jobs, keyed on `.rulecast-config.yaml`.

A new git worktree on the same machine needs only step 2: rule repos are cached per user, not per checkout. On macOS, the first edit in a new worktree is slower: macOS checks each executable the first time it runs from a new path, such as a `command` script or a `node_modules/.bin` shim. Run them once beforehand.
