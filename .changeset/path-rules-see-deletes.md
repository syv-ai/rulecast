---
"@syv-ai/rulecast": minor
---

A `path` rule now covers a deleted file. Deleting a file changes it as much as writing it, and so does renaming it away (`git mv`, `mv`). Before, `rm .github/workflows/ci.yml` passed `loop-safety/protected-loop-config` silently. Now:
- a shell call that deletes or moves away a file a `path` rule covers is a finding at that call, and again at every stop until the file is back. With `refuse_write`, the agent is told to run `git checkout HEAD -- <file>`, and the stop blocks;
- `rulecast run` in a git hook (staged) and in CI (`--from-ref`) reports a deleted file the same way;
- only a file the base commit has counts: one the run created and deleted again changed nothing. Rules that read a file's content still skip deleted files.

A protected file the agent changed with its shell is now undone with `git checkout HEAD -- <file>`, for any change, not only a delete. `git checkout -- <file>` failed after `git rm` or `git mv`, because the index no longer had the file.
