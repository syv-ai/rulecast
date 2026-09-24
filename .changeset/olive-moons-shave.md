---
"@syv-ai/rulecast": minor
---

The stop gate reads what was found, not what fitted the context budget.

A rule the budget dropped was filtered out of the delivery before the stop gate read it, so the agent could stop with an unresolved error and nothing reached it.

Breaking: the package entry point is now the plugin API. `compile`, `runPipeline`, `cacheHome` and the rest of rulecast's own machinery moved to `@syv-ai/rulecast/internal`, and `rulecast run --format json` no longer carries `templates`, `omitted` or `overflowPath`.
