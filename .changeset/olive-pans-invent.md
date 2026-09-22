---
"@syv-ai/rulecast": minor
---

First release.

rulecast delivers a project's conventions to a coding agent at the moment the agent is about to break one. A rule pairs a check with a message and a pointer to the doc section that explains it; rulecast runs as an agent hook, so the agent gets both in the same turn as the edit.

- **Rules** in `.rulecast-config.yaml`, in pre-commit's style: local rules, or rules from a git rule repo pinned by tag. `rulecast autoupdate` moves the pins; `rulecast try-repo` runs a repo without configuring it.
- **Six detectors**: `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint) and `llm`. The first four run on every edit; `llm` runs only when the agent stops, names its own model, and speaks to Claude Code, OpenCode, the Anthropic API or any OpenAI-compatible endpoint.
- **Claude Code adapter**, written against recorded hook payloads. The edit hook is budgeted under 500 ms at p95 and measured at p50 188 ms / p95 203 ms on an Apple M3 Pro with all six detectors configured.
- **Only what changed**: a per-session baseline separates findings the agent just introduced from what was already there, so an agent is told about its own work rather than the whole repository's.
- **`rulecast init`** detects the project, offers catalog rules that apply to its files, installs the hooks and prints a prompt for drafting rules from your own docs. **`rulecast doctor`** says why a rule is quiet: what compiled, which binaries, parsers and credentials are actually there, where the hooks and caches live, and what every rule matches today.
- **Rule packages** for general, Python and React projects, and agent-facing docs under `agents/` so an agent can set rulecast up and draft rules itself.
- Published to npm as `@syv-ai/rulecast`, with standalone Linux and macOS binaries on GitHub Releases.
