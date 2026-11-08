---
"@syv-ai/rulecast": patch
---

The plugin's add-rule skill now offers a rule instead of starting itself. When the developer corrects the agent in a way that says how code here should always or never be written, the agent finishes the fix and ends that reply with one line: `Want me to add a rulecast rule for this? "<the convention>"`. Nothing changes without a yes.

- It offers once per convention per session, never again after a no, and at most once per reply. It does not offer for a change of mind about the task, a one-off bug, a mistake a rulecast finding already caught, or a run with nobody there to answer.
- After a yes, the skill takes the convention as offered and does not ask again whether you want a rule. If the agent starts the skill without offering first, it still says why and asks before anything else.
- The plugin has an eval suite in `plugins/rulecast/evals/`, run by hand with `claude plugin eval plugins/rulecast --scaffold --allow-tools Edit Write --judge-model sonnet`. `yes-starts-skill` also needs Bash, and a grant applies to every case in a run, so run it on its own with `--case yes-starts-skill --allow-tools Bash Edit Write`.

The plugin's version follows the CLI's, so this reaches you with the release.
