# Git hooks and CI

The same rule reports the same line the same way in an agent hook, a git hook and CI. A finding is new when it matches a line you changed. One that was already there is backlog: shown, never failing.

| Where | Command | Checks |
|---|---|---|
| pre-commit | `rulecast run` | Staged files, read from the index, judged against `HEAD`. `llm` rules are skipped unless you pass `--llm`: a commit should not cost money |
| pre-push and CI | `rulecast run --from-ref A --to-ref B` | Files changed between the merge base with `A` and `B`, read at `B` (the working tree without `--to-ref`). Runs `llm` rules on changed files |
| a scheduled sweep or agent loop | `rulecast run --all-files` | Everything, against a [committed baseline](advanced.md#a-committed-baseline); exits 0 unless something got worse. Recipes: [`agents/reference/loops.md`](../agents/reference/loops.md) |

`rulecast run --files F...` judges files whole, like `--all-files`. From a hook manager, use the hooks below instead.

rulecast installs no git hooks itself: wire it into the hook manager you use. Git hooks run the same rulecast the agent hooks do: the project's `node_modules/.bin/rulecast`, else the installed binary, else one on the PATH ([Install](../README.md#install)).

## pre-commit

In `.pre-commit-config.yaml`:

```yaml
minimum_pre_commit_version: "3.2.0"
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.9.0
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
      run: sh -c 'H=${RULECAST_HOME:-${XDG_CACHE_HOME:+$XDG_CACHE_HOME/rulecast}}; H=${H:-${HOME:+$HOME/.cache/rulecast}}; [ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast run; T=; [ -n "$H" ] && case "$(uname -sm)" in "Linux x86_64") T=linux-x64;; "Linux aarch64"|"Linux arm64") T=linux-arm64;; "Darwin arm64") T=darwin-arm64;; "Darwin x86_64") T=darwin-x64;; *) T=;; esac; if [ -n "$T" ] && [ -x "$H/bin/rulecast-$T" ]; then "$H/bin/rulecast-$T" run; S=$?; [ "$S" -ne 126 ] && [ "$S" -ne 127 ] && exit "$S"; fi; exec rulecast run' --
pre-push:
  jobs:
    - name: rulecast
      run: sh -c 'H=${RULECAST_HOME:-${XDG_CACHE_HOME:+$XDG_CACHE_HOME/rulecast}}; H=${H:-${HOME:+$HOME/.cache/rulecast}}; [ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; T=; [ -n "$H" ] && case "$(uname -sm)" in "Linux x86_64") T=linux-x64;; "Linux aarch64"|"Linux arm64") T=linux-arm64;; "Darwin arm64") T=darwin-arm64;; "Darwin x86_64") T=darwin-x64;; *) T=;; esac; if [ -n "$T" ] && [ -x "$H/bin/rulecast-$T" ]; then "$H/bin/rulecast-$T" run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; S=$?; [ "$S" -ne 126 ] && [ "$S" -ne 127 ] && exit "$S"; fi; exec rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD' --
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

Without Node, replace `setup-node` and `npm ci` with the install command from [Install](../README.md#install), and run `~/.cache/rulecast/bin/rulecast-linux-x64` where the example runs `npx rulecast`.

A shallow clone has no merge base; rulecast says so and names `fetch-depth: 0`.
