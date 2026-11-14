# Git hooks and CI

The same rule reports the same line the same way in an agent hook, a git hook and CI. A finding is new when it matches a line you changed. One that was already there is [backlog](adopting-rules.md).

| Where | Command | Checks |
|---|---|---|
| pre-commit | `rulecast run` | Staged files, read from the index, judged against `HEAD`. `llm` rules are skipped unless you pass `--llm`: a commit should not cost money |
| pre-push and CI | `rulecast run --from-ref A --to-ref B` | Files changed between the merge base with `A` and `B`, read at `B` (the working tree without `--to-ref`). Runs `llm` rules on changed files |
| a scheduled sweep or agent loop | `rulecast run --all-files` | Everything, against a [committed baseline](adopting-rules.md#a-committed-baseline); exits 0 unless something got worse. Recipes: [`agents/reference/loops.md`](../agents/reference/loops.md) |

rulecast doesn't install git hooks. Add it to the hook manager you already use. The entries below look for rulecast in the same order as the agent hooks ([What gets written](https://syv-ai.github.io/rulecast/how-it-works/#what-gets-written)).

## pre-commit

In `.pre-commit-config.yaml`:

```yaml
minimum_pre_commit_version: "3.2.0"
default_install_hook_types: [pre-commit, pre-push, commit-msg]
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.13.0
    hooks:
      - id: rulecast
      - id: rulecast-push
      - id: rulecast-commit-msg
```

The entries are `verbose`: pre-commit shows what rulecast says even when the hook passes, so a teammate without rulecast sees the warning ([A team](#a-team)). After changing `default_install_hook_types`, run `pre-commit install` again.

## lefthook

In `lefthook.yml`:

```yaml
pre-commit:
  jobs:
    - name: rulecast
      run: sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --
pre-push:
  jobs:
    - name: rulecast
      run: sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --
commit-msg:
  jobs:
    - name: rulecast
      run: sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run --commit-msg "{1}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run --commit-msg "{1}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run --commit-msg "{1}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --
```

## hk

In `hk.pkl`, add a step to your hooks. Here it sits beside the steps in a `linters` mapping:

```pkl
hooks {
  ["pre-commit"] {
    steps = (linters) {
      ["rulecast"] {
        check = #"sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --"#
      }
    }
  }
  ["pre-push"] {
    steps {
      ["rulecast"] {
        check = #"sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --"#
      }
    }
  }
  ["commit-msg"] {
    steps {
      ["rulecast"] {
        check = #"sh -c 'skipped=; if [ -x ./node_modules/.bin/rulecast ]; then ./node_modules/.bin/rulecast run --commit-msg "{{commit_msg_file}}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; skipped="exit $status"; fi; if command -v rulecast >/dev/null 2>&1; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $(command -v rulecast) instead" >&2; rulecast run --commit-msg "{{commit_msg_file}}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; installed="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"; if [ -x "$installed" ]; then [ -n "$skipped" ] && echo "./node_modules/.bin/rulecast could not run ($skipped), so this hook runs $installed instead" >&2; "$installed" run --commit-msg "{{commit_msg_file}}"; status=$?; [ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; echo "rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh" >&2; exit 0' --"#
      }
    }
  }
}
```

The `#"…"#` raw strings take the command as it is.

## Commit messages

A rule with `stages: [commit-msg]` judges the commit message instead of files. Each hook manager above has an entry for the `commit-msg` hook (pre-commit's `rulecast-commit-msg`, installed by the `commit-msg` in `default_install_hook_types`). It runs `rulecast run --commit-msg` on the message, so every committer is checked, person or agent. An agent that commits sees the commit fail with the finding, and fixes the message.

The message is judged with the commit-msg rules of every config in the repository, at its top or in a package: a message belongs to the commit, not to a package. A commit-msg rule uses a detector that reads the text it is given, such as `regex` or `ast-grep`. It can't use `llm`: the hook runs on every commit, and a commit should not cost money. If a commit-msg rule doesn't compile, the hook fails (exit 3) rather than pass a message it didn't check. A broken rule that judges files doesn't block the commit-msg hook; the pre-commit hook reports it.

The message is judged as git will record it. Everything from the scissors line down (the diff that `git commit -v` shows) is left out, and so are comment lines, which start with `#` or with your `core.commentChar` or `core.commentString`. With `commit.cleanup` set to `whitespace`, `verbatim` or `scissors`, git keeps comment lines, and so does rulecast. A finding's line is the line in the message file. The hook can't see how the message was written, so in three cases rulecast still drops lines that start with the comment character, though git keeps them:

- the message came from `-m` or `-F` with no editor;
- a `--cleanup` was given on the command line;
- `core.commentChar` is `auto` and the message has no scissors line, so git's choice is unknown and rulecast assumes `#`.

For example, to keep AI co-sign trailers out of commits:

```yaml
- id: commits/no-ai-trailers
  name: No AI co-sign trailers
  stages: [commit-msg]
  detect:
    regex:
      pattern: '^(co-authored-by:.*\b(claude|copilot|anthropic|openai)\b.*|.*generated with \[?claude code.*)$'
      flags: im
  message: "{{file}}:{{line}}: an AI co-sign trailer. Commits name their human author only."
```

## A team

The agent hooks and git hooks you commit run for everyone who works in the project. A teammate who hasn't installed rulecast isn't blocked:

- **Claude Code:** the hooks find no rulecast and do nothing. The start of each session says so; an unattended run hears it at every stop.
- **pre-commit, lefthook and hk:** the hook prints that rulecast isn't installed and lets the commit or push through. The same goes for a rulecast that can't start, such as the project's own when a GUI git client's `PATH` has no `node`.
- **CI:** `rulecast doctor --ci` fails when rulecast is missing, so CI is where a missing install shows up.

So everyone is checked only once everyone has installed it. A line for the project's README:

```sh
curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
```

With rulecast as a devDependency (`pnpm add -D @syv-ai/rulecast`), the project's own install covers it, and everyone runs the same version.

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
