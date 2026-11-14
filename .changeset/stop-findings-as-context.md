---
"@syv-ai/rulecast": patch
---

Attended, a stop with findings now gives them to the agent as Stop context (`hookSpecificOutput.additionalContext`) instead of a block. The turn continues the same way, but Claude Code no longer frames the findings as a "blocking error", which agents had read as instruction injection. The unattended hold stays a block. Breaking: a tool that read `decision: "block"` from an attended stop's output now finds `hookSpecificOutput.additionalContext`.
