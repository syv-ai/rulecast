---
"@syv-ai/rulecast": patch
---

Stop no longer checks a file the agent edited and then deleted. Such a file stayed in the session's list of edited files, so a linter was handed a path that no longer exists and reported it as a finding (ruff's E902) at every stop. Nothing the agent did could fix it, and it used up the stop's blocks.
