# Agents

rulecast ships docs written for coding agents, not for people. Paste the prompt from [Getting started](../README.md#getting-started) to yours and it sets rulecast up with you.

- [`agents/SETUP.md`](../agents/SETUP.md): your agent shows you a page of defaults from the repository, asks only what it can't tell, and writes it when you approve.
- [`agents/DRAFT-RULES.md`](../agents/DRAFT-RULES.md): give it one convention and it drafts the rule, shows you what it would flag today, and asks you to keep, edit or drop it.
- [`agents/CONVENTIONS.md`](../agents/CONVENTIONS.md): for working out your conventions up front. The agent reads the code, then interviews you one question at a time. Nothing goes into your docs that you didn't choose.

If your agent can't fetch a URL, have it run `npx @syv-ai/rulecast init --dry-run`, go through what it found with you, install rulecast, and run `rulecast init` with the flags you agree on (`rulecast init --help` lists them). Never edit hook settings by hand: `init`, `install` and `uninstall` own them.

## What the agent gets wrong, over time

The hooks keep a local log of the findings they reported: finding ids, rule ids, files and lines, never code. `rulecast stats` reads it: which rules the agent fixes, which it keeps hitting or silencing, which never fire.

Once the log spans two weeks, `stats` also shows each rule's weekly rate and the files it keeps firing on. The log holds about 8 MiB; to keep 26 weeks of per-week counts, set `stats.weekly_summary: true` (or `rulecast init --weekly-summary`). `rulecast clean --project` deletes it, with the rest of this project's cache; `rulecast clean` deletes the whole cache, fetched rule repos included.

## Which agents

Claude Code is supported today. Codex, Cursor and OpenCode are next: only the adapter knows about a specific agent.

Several agents in one working tree, git operations during a turn and agents with nobody watching are under [Advanced](advanced.md).
