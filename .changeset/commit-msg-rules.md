---
"@syv-ai/rulecast": minor
---

Rules can now judge commit messages (#79). A rule with `stages: [commit-msg]` checks the message, not files. `rulecast run --commit-msg FILE` runs these rules on the message in FILE. Git's comment lines and anything below the scissors line are left out, and findings name the message `COMMIT_EDITMSG`. The commit-msg git hook runs it, so every committer is checked, person or agent. An agent sees its commit fail with the finding.

- **Hook entries:** pre-commit gets a new `rulecast-commit-msg` hook id at the `commit-msg` stage. The lefthook and hk snippets in `guides/git-hooks-ci.md` have a `commit-msg` entry. All three are tested against the real tools.
- **Which detectors:** a commit-msg rule needs a detector that judges the text it is given, such as `regex` or `llm`, and `commit-msg` must be its only stage. It has no `files`, `exclude`, `scope` or `refuse_write`, and `rulecast validate` says so when one is set. `rulecast doctor` doesn't try such a rule on project files.
- **A rule that doesn't compile** makes `run --commit-msg` exit 3, as `run` does, instead of reporting "no findings".
- **An example:** the guide has a "Commit messages" section with a rule that keeps AI co-sign trailers (`Co-Authored-By: Claude`, "Generated with Claude Code") out of commits. It is a recipe, not a catalog rule, since it's a project's policy rather than a language or tool standard.
