---
"@syv-ai/rulecast": minor
---

rulecast now tells an agent when one of its shell commands works in another checkout of the repository (#71). A subagent that made its own worktree and ran `cd ../w1-m && sed …` from the lead's directory was invisible to rulecast. A shell call's hooks arrive with the session's working directory, so rulecast compared that tree and never saw what changed in the other checkout. Those edits were neither checked nor logged, which is why some worktrees had no `rulecast stats` data.

The first time a command names another checkout that has a rulecast config (through `cd`, `pushd`, `git -C`, or a path inside it), the agent is told once that edits there aren't checked. The notice tells it to switch into that checkout first (in Claude Code, `EnterWorktree` with its path) or to use Edit and Write. Paths built from shell variables aren't followed. `guides/advanced.md` describes the pattern.

The Claude Code adapter now passes a Bash call's command text on in its shell events.
