---
"@syv-ai/rulecast": minor
---

A stop says only what is new since the agent's last stop, and nothing when nothing is new (#90):

- Warnings shown to the user at a stop that lets the agent go are recorded as said, like those at a block, so they are not repeated at every stop.
- "a subagent is still running, so … are checked at a later stop" is said once, when the deferral starts, and again only after a stop that was not deferred.
- The llm file-budget warning is said once per session, whichever files a later stop leaves out.
- "…and N more" names the warnings it cut, and points at `rulecast validate` only when one of them is a compile problem.
- Findings from earlier stops are listed when that list changes. After that, a block gives only a count that names their rules ("3 findings from earlier stops are still there (rule-a, rule-b)"), and a stop that lets the agent go says nothing about them. When some of them are fixed, that is said once ("2 of the 6 earlier findings are fixed").
