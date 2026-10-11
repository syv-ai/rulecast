---
"@syv-ai/rulecast": patch
---

Hooks fail open when the cache home cannot be created: the hook exited 2 if `RULECAST_HOME` (or `~/.cache`) was unwritable, because it parsed the payload and created its state directory before its error handling. `rulecast run --from-ref` now checks files with non-ASCII names, which git listed quoted and no rule matched. `init` finds the git root through the same scrubbed environment as every other git call, so a `GIT_DIR` inherited from a git hook no longer names another repository.
