---
"@syv-ai/rulecast": minor
---

**Breaking:** at an agent's Stop (and in any other agent hook), a formatter hook rule no longer puts the file back after its hook changes it. The change stays in the file, as a commit would leave it, and is still reported as "<hook> would change this file". Putting files back raced with other agents: a subagent's edit made while the hook ran was taken for the hook's change and reverted. `rulecast run`, `rulecast doctor` and git hooks still put files back.

With pre-commit or prek, a changed file counts as the hook's only when the runner says the hook modified files. A file someone else changed while a hook that modified nothing ran is no longer reported as that hook's change, and is never put back.

In an agent's hook the finding says "<hook> changed this file; check the change and keep or undo it". An untracked file a formatter changed still counts as the hook's change, since pre-commit only reports changes to tracked files. An always_run hook whose filter takes none of the selected files is still run on them, never with an empty file list (which would make pre-commit stash the tree).
