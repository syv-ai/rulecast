---
"@syv-ai/rulecast": minor
---

`rulecast stats` shows a per-week trend for each rule: how often it fired per 100 checks that ran it, and the files it keeps firing on across sessions. The JSON gains a `weekly` key (`schemaVersion` stays 1), and the text output a weekly table once the trend spans two weeks.

- The new config key `stats.weekly_summary` (off by default; `rulecast init --weekly-summary`) keeps 26 weeks of per-week counts in `findings-weekly.jsonl`, beside the config's findings log. A hook writes it when the log rotates and drops its oldest file. It holds rule ids, file paths, weeks and counts only. Without it, the trend covers what the log holds: about 8 MiB.
- The key applies to its own config's log only, and is not inherited by configs below it.
- The JSON is added to, so nothing breaks.
