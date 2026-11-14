---
"@syv-ai/rulecast": patch
---

`rulecast install` and `rulecast init` now add the hook that runs before every Edit and Write only when a config a session there reaches has a `refuse_write` rule (`true` or `unattended`, catalog rules included). Without one, that hook cost every edit a process start and a config compile for nothing. Re-running either removes it from an older install that doesn't need it. `rulecast doctor` reports an error, and exits non-zero, when a config has a `refuse_write` rule but no such hook is installed, naming `rulecast install` as the fix. Install now fetches missing rule repos before it writes the hooks, so a catalog rule's `refuse_write` is known. `init` judges its own config as it is about to write it.
