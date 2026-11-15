---
"@syv-ai/rulecast": patch
---

`rulecast doctor` says when agents' stops hit `llm.max_files_per_verify`: how many times, how many files were left unchecked, and that raising the setting checks them all. At a stop the cut goes only to the debug log, so on its own it looks like a clean pass. Cuts at an earlier, lower setting are not counted.
