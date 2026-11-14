---
"@syv-ai/rulecast": minor
---

**Breaking:** at an agent's Stop (and in any other agent hook), a formatter hook rule no longer puts the file back after its hook changes it. The change stays in the file, as a commit would leave it, and is still reported as "<hook> would change this file". Putting files back raced with other agents: a subagent's edit made while the hook ran was taken for the hook's change and reverted. `rulecast run`, `rulecast doctor` and git hooks still put files back.

With pre-commit or prek, a changed file counts as the hook's only when the runner says the hook modified files. A file someone else changed while a hook that modified nothing ran is no longer reported as that hook's change, and is never put back.
