---
"@syv-ai/rulecast": minor
---

Plugin detectors can declare three new optional things: `wholeProject(config)` (the tool needs the real project, so a staged run uses the working tree when the rule's files match it, and skips the rule otherwise), `changesFiles` (the tool may change files while it runs; it runs after every other kind, alone), and `validate({ rules, cwd })` (static checks against the project's files, reported by `rulecast validate`).
