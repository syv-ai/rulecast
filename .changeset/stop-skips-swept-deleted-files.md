---
"@syv-ai/rulecast": patch
---

Stop no longer checks a file changed outside the agent's tool calls that has since been deleted, and a shell call that deletes a file no longer has the deleted file checked as its edit. Both missed a file that git never tracked: once deleted, `git status` doesn't list it, and rulecast read that as "unchanged and still there". So ruff was handed the missing path and reported E902 at every stop. Whether a changed file still exists is now checked on disk, also outside a git repository. A dangling symlink or a loop of links counts as deleted; a file rulecast isn't allowed to look at still counts as there.
