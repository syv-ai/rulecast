---
"@syv-ai/rulecast": minor
---

The Claude Code hooks now run a script instead of a long inline command. `rulecast install` writes `.claude/hooks/rulecast.sh`, a short commented script that finds rulecast (the project's `node_modules/.bin`, then the PATH, then install.sh's directory) and hands it the hook's input. Every hook in `.claude/settings.json` is now `sh "$CLAUDE_PROJECT_DIR"/.claude/hooks/rulecast.sh`. What happens when rulecast is not installed is unchanged: no hook errors, a message when the session starts, and one at every stop in an unattended run.

`rulecast doctor` reports a missing script as an error, because every hook would fail without it, and a script that differs from what install writes as out of date. `rulecast uninstall` removes the script.

Breaking: run `rulecast install` again in each project. It replaces the old hook command and writes the script. Commit both `.claude/settings.json` and `.claude/hooks/rulecast.sh`.

Breaking, for anyone writing their own adapter: `AdapterInstall.command` is now a string, not `command(local)`, and `AdapterInstall.files` is required: the files the hooks need next to the settings, which install writes and doctor checks.
