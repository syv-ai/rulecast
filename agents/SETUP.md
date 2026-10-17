# Set up rulecast in a project

Use this when the developer asks you to set up rulecast and has not run `rulecast init` themselves. rulecast delivers a project's conventions to coding agents while they work: rules in `.rulecast-config.yaml` pair a check with a message and a pointer to the doc section it enforces.

Relative links in this file resolve against this file's own URL.

## Steps

1. Work from the project's root directory: the git repository root, unless the developer names a subdirectory.
2. Run `init` with `--agent` set to your own adapter name, `claude-code` if you are Claude Code:

   ```sh
   npx @syv-ai/rulecast init --agent claude-code
   ```

   `init` detects the project, selects the catalog rules that apply to its files, and prints a review: every file it would create or change. Without a terminal it writes nothing and exits 2. `--agent` installs your hooks and only yours; without it, `init` installs hooks for the agents it detects, or for every agent rulecast supports when nothing in the project marks one yet.
3. If it fails with `unknown agent`, rulecast has no adapter for you yet (the message lists the ones it has). Run it again without `--agent`, and tell the developer that rulecast cannot deliver rules to you yet. If it fails for any other reason than exit 2 with a review, show the developer its output and stop.
4. Show the developer the review. Name the selected rules and say that any of them can be removed from the config afterwards. Ask whether to write it, and wait for the answer. If yes, run the same command with `--yes`: it writes the files, validates them, and prints a drafting prompt. If it exits non-zero, show the developer its output and stop.
5. If this project runs agents in CI or in cloud sessions, tell the developer to add `npx rulecast install` and then `npx rulecast doctor --ci` before the agent step: the hooks never fetch rule repos, and `doctor --ci` fails the job when rulecast would run degraded. Do not edit CI workflows yourself.
6. Ask whether to work out the project's own conventions and draft rules for them, and wait for the answer. If yes, follow [CONVENTIONS.md](CONVENTIONS.md), starting from the doc named in the prompt `init` printed. It confirms the conventions the docs already state, works out the rest with the developer, and then hands over to [DRAFT-RULES.md](DRAFT-RULES.md).

## Never

- Never add a `rulecast-ignore` comment or set `enabled: false` on a rule without the developer's agreement. Ignores added during a session are reported to the developer when you stop.
- Never edit agent hook settings (such as `.claude/settings.json`) by hand: `rulecast install` and `rulecast uninstall` manage them.
- Never set rulecast up without the developer. If you were told to work without them, stop before step 2 and say why: rulecast enforces conventions the developer chose.
- Never commit. The developer reviews and commits the changes.
