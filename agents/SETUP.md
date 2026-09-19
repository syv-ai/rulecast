# Set up rulecast in a project

Use this when the developer asks you to set up rulecast and has not run `rulecast init` themselves. rulecast delivers a project's conventions to coding agents while they work: rules in `.rulecast-config.yaml` pair a check with a message and a pointer to the doc section it enforces.

Relative links in this file resolve against this file's own URL.

## Steps

1. Work from the project's root directory: the git repository root, unless the developer names a subdirectory.
2. Run `init` with `--agent` set to your own adapter name, `claude-code` if you are Claude Code:

   ```sh
   npx @syv-ai/rulecast init --yes --agent claude-code
   ```

   `--agent` installs your hooks even when nothing in the project marks you yet (for Claude Code, a `.claude/` directory or a `CLAUDE.md`); without it, `--yes` installs hooks only for the agents it detects. `init` detects the project, selects the catalog rules that apply to its files, writes `.rulecast-config.yaml`, installs your hooks in your shared settings file, validates the result, and prints every file it created or changed, followed by a drafting prompt.
3. If it fails with `unknown agent`, rulecast has no adapter for you yet (the message lists the ones it has). Run `npx @syv-ai/rulecast init --yes` without `--agent`, and tell the developer that rulecast cannot deliver rules to you yet. If it exits non-zero for any other reason, show the developer its output and stop.
4. Show the developer `.rulecast-config.yaml` and the other files `init` listed. Name the selected rules and say that any of them can be removed from the config.
5. Ask whether to draft rules for the project's own conventions. If yes, follow [DRAFT-RULES.md](DRAFT-RULES.md), using the doc named in the drafting prompt `init` printed.

## Never

- Never edit agent hook settings (such as `.claude/settings.json`) by hand: `rulecast install` and `rulecast uninstall` manage them.
- Never commit. The developer reviews and commits the changes.
