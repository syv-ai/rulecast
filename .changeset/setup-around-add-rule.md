---
"@syv-ai/rulecast": minor
---

Setup is now done by your coding agent, with you, and most rules come later through `/rulecast:add-rule`.

- `/rulecast:setup` in the Claude Code plugin, or `agents/SETUP.md` for other agents: the agent reads the repository, asks what it can't tell (who it's for and where it runs, where configs go, where conventions live, whether llm rules are OK and with which model, which of your git hooks to run as rules, up front or as you go), shows the agreed setup on one page (`agents/setup-page.html`) and writes it only when you approve. Then it offers a few first rules.
- `rulecast init` no longer prompts, selects catalog rules or prints a prompt. It takes the answers as flags: `--hooks`, `--llm-model`, `--llm-provider`, `--conventions`, plus `--agent` and `--scope`. `--dry-run --format json` reports what it found and every file it would write. `--rules`, `--no-rules`, `--no-hooks` and `--yes` are gone, and so is the `@clack/prompts` dependency.
- `rulecast add <id|pack>...` adopts catalog rules or packs (`rulecast add loop-safety`). `rulecast list --catalog` lists the catalog's rules and marks those already configured.
- `llm.model` in the config is the model for llm rules that name none, and says the developer agreed to llm rules. A rule's own `model` still wins. A rule with neither fails `rulecast validate`.
- `conventions` in the config names the file or folder where new conventions are written. A config without one uses the nearest config above that names one. `rulecast list` shows it on its first line.
- `agents/CONVENTIONS.md`, the up-front path, is shorter: no lens catalog and no subagent pass, and its review uses the setup page. `agents/conventions-review.html` is gone. `agents/DRAFT-RULES.md` and add-rule check the catalog first and ask before drafting an llm rule.
