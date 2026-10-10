---
"@syv-ai/rulecast": minor
---

rulecast reports the same line the same way in an agent hook, a git hook and CI. A team gets from `init` to a firing hook without a trap. The agent is told what to do with what it receives, and cannot quietly edit its way past the gate.

**Changed: `rulecast run` with no file flags judges what is being committed.** It checks the staged files, reads their content from the index rather than the working tree, and classifies findings against `HEAD`. A line the commit did not change is backlog: shown, and never failing the commit. Before, a docstring added above an existing violation failed the commit, and a violation staged and then fixed only in the working tree passed. With nothing staged it says so and points at `--all-files`, and every run says how many files it checked. `llm` rules are skipped in this mode unless you pass `--llm`, and one line says so: a commit should not cost money.

**`--to-ref B` reads content at `B`.** Pre-push and CI judge what is pushed, not whatever is uncommitted. `--from-ref` alone still reads the working tree. In a shallow clone, the error names `fetch-depth: 0`. `ruff` and `eslint` are handed the staged or committed content on stdin under the file's real path, so path-keyed configuration still applies; `command` scripts and `oxlint` get a scratch copy inside the project.

**Git hooks and CI.** The repository ships a `.pre-commit-hooks.yaml` with `rulecast` (pre-commit) and `rulecast-push` (the pushed range), and the README has lefthook and GitHub Actions recipes, including SARIF upload. rulecast installs no git hooks itself.

**Turning things off.** `enabled: false` switches a rule off, catalog rules included. `# rulecast-ignore: <rule-id> <reason>` on the matched line or the line above drops one finding; the reason is required. `run --all-files --summary` counts ignores.

**The developer hears what the agent should not be the only one to see.** When an agent session changes `.rulecast-config.yaml` or adds an ignore, the developer is told at Stop through a `systemMessage`. Rule and detector warnings go there too, instead of into the model's context. The block reason tells the agent to say so when it thinks a finding is wrong rather than edit the config, and the backlog heading says to leave old violations alone unless asked. Overflow files and `read`-mode references now live in `<project>/.rulecast/`, which ignores itself: Claude Code blocks reads under `~/.cache` by default.

**`init` installs hooks.** When no agent is detected, every supported adapter is preselected, interactively and under `--yes`; `--no-agents` installs none. The convention prompt defaults to the project's own doc heading when one matches the rule's doc.

**A hook whose rulecast is not installed yet stays quiet.** The hook command exits 0 when `node_modules/.bin/rulecast` is missing (a fresh clone before `npm install`) and says so once, at session start. `rulecast install` upgrades rulecast's own stale hook entries, and `doctor` warns about them.

**Commands that say what they did.** `rulecast list` shows every configured rule, catalog rules included: source, files, what its detector looks for (a regex's pattern, an llm rule's question), the doc sections it cites; `--format json` too. `--version`, `help <command>` and `<command> --help` work. Validation errors say what to do (`unknown key "prompt" (did you mean "question"?)`). `test --against` prints one note chosen by the count. `doctor`'s dry run names the one file it tried out of how many. `validate` takes any file name and tells a config from a manifest by content.

**The agent docs.** `DRAFT-RULES.md` starts from `rulecast list`. A convention a catalog rule already enforces gets a `context` override pointing at the project's doc. Examples with nothing real to quote are invented and labelled as invented. It says what to do when the project's doc covers more files than a catalog rule, or contradicts one.

**Catalog: `python/layering` reaches route modules.** It matched only `routes/`, `services/` and `crud/` directories, so a project with `app/api/routes.py` or `app/crud.py` never got the layering section. It now matches those layers as a directory or a single module, `api/` and `routers/` included, and leaves out tests.
