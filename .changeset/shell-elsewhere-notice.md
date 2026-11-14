---
"@syv-ai/rulecast": minor
---

rulecast now tells an agent when one of its shell commands works in another checkout of the repository (#71). A subagent that made its own worktree and ran `cd ../w1-m && sed …` from the lead's directory was invisible to rulecast. A shell call's hooks arrive with the session's working directory, so rulecast compared that tree and never saw what changed in the other checkout. Those edits were neither checked nor logged, which is why some worktrees had no `rulecast stats` data.

The first time a command names another checkout that has a rulecast config above or below the place it names, and the call's checks didn't cover it, the agent is told once that edits there aren't checked. That holds even when the agent's own directory has no config. A checkout with a detached HEAD, such as a throwaway `git worktree add --detach` copy a gate runs tests in, is left out. The notice tells it to switch into that checkout first (in Claude Code, `EnterWorktree` with its path) or to use Edit and Write. Where a command works is read from `cd`, `pushd`, `git -C` and `make -C`, and from the paths in it: absolute, `~/`, and relative ones with a slash. Paths built from shell variables, paths inside quoted text with spaces such as a commit message, and here-document bodies aren't followed. Which checkout a path is in is read from its `.git`, without running git, so a command that names only places in the current checkout or outside every checkout costs no git call. `guides/advanced.md` describes the pattern.

The Claude Code adapter now passes a Bash call's command text on in its shell events.
