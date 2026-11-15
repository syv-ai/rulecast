---
"@syv-ai/rulecast": minor
---

`rulecast doctor` has a history section, read from the findings log. It lists each rule that ran and never fired, with how many times, on how many files and since when: `ran 40 times on 12 files since 2026-10-01, never fired`. Many runs over many files count for more than a few over one. A new rule key, `expect: quiet`, marks a guard over code that holds today: doctor then says its quiet record is as expected (`ok`), and a finding of it is said as `info`. A rule whose `files` matches no file is still a warning, since a pattern left stale by a rename looks exactly like that.
