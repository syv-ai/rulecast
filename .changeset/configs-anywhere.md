---
"@syv-ai/rulecast": minor
---

A repository can hold any number of `.rulecast-config.yaml` files: one at the top, one per package, or both. rulecast no longer assumes the config sits at the git top.

- Every config above a file applies to it, each as its own project with its own rules, state and findings. Nothing is merged; `exclude` on a top rule keeps it out of a package.
- Agent hooks route each file to those configs, wherever the session was started, and a stop checks every project the session touched. Paths the agent sees are relative to its working directory.
- `rulecast run` and `fix` route the files under the current directory the same way. With several projects, JSON adds `baselines` and SARIF writes one run per project. Run from a subdirectory, they check that subtree.
- `install` writes the hooks in the directory it runs in, where sessions start, and fetches the rule repos of every config at, above or below it. `init` sets up the project in the current directory, reads git hook configs at the git top and applies lefthook's `root:`.
- Linters run from the nearest directory holding their own config, and find their binary in `node_modules/.bin`, then for ruff in `.venv/bin` or `venv/bin`, up to the git top. `uv run` is used only where a `uv.lock` already exists, so rulecast no longer creates one and a `.venv`. `doctor` checks each tool from every directory it would run in. `command` rules take a `cwd`.
- `init` in a package lists the git hooks it does not offer, with the reason.
- `protected-loop-config` also protects `.rulecast-config.yaml`, `.claude/settings` files and `.husky/` below the top. Replay reads transcripts of sessions started at or above the project.
- The agent preamble says "rulecast rules (.rulecast-config.yaml)" rather than "This project's".
