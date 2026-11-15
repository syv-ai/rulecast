---
"@syv-ai/rulecast": patch
---

The loop-safety docs now say how to upgrade rulecast: bump its pins (the rule repo's `rev`, the rulecast hook's `rev`) in an attended session or by hand. An unattended run that finds an upgrade due reports it and leaves the pins alone, because a new rev changes the rules that judge the run.
