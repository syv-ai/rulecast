# Git hooks and CI

The same rule reports the same line the same way in an agent hook, a git hook and CI. A finding is new when it matches a line you changed. One that was already there is backlog: shown, never failing.

| Where | Command | Checks |
|---|---|---|
| pre-commit | `rulecast run` | Staged files, read from the index, judged against `HEAD`. `llm` rules are skipped unless you pass `--llm`: a commit should not cost money |
| pre-push and CI | `rulecast run --from-ref A --to-ref B` | Files changed between the merge base with `A` and `B`, read at `B` (the working tree without `--to-ref`). Runs `llm` rules on changed files |
| a scheduled sweep or agent loop | `rulecast run --all-files` | Everything, against a [committed baseline](advanced.md#a-committed-baseline); exits 0 unless something got worse. Recipes: [`agents/reference/loops.md`](../agents/reference/loops.md) |

`rulecast run --files F...` judges files whole, like `--all-files`. From a hook manager, use the hooks below instead.

rulecast installs no git hooks itself: wire it into the hook manager you use. Git hooks run the same rulecast the agent hooks do: the project's `node_modules/.bin/rulecast`, else `rulecast` on the PATH, else the install script's directory ([Install](../README.md#install)).

## pre-commit

In `.pre-commit-config.yaml`:

```yaml
minimum_pre_commit_version: "3.2.0"
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.11.0
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

Without Node, replace `setup-node` and `npm ci` with the install command from [Install](../README.md#install), which puts `rulecast` on the job's PATH, and run `rulecast` where the example runs `npx rulecast`.

A shallow clone has no merge base; rulecast says so and names `fetch-depth: 0`.
