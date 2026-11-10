---
"@syv-ai/rulecast": minor
---

A config can now record the conventions you decided not to check, and why, with a new `not_checked` key.

Some conventions can't be checked by a rule: "every change gets a review" is about how people work, not about the code. When an agent drafts rules from your docs, it used to propose a line such as `Not checked by rulecast: about how to work` under each of these conventions in your own docs. That put rulecast's terms in your convention docs. Now the record goes in `.rulecast-config.yaml` instead, and your docs stay as you wrote them:

```yaml
not_checked:
  - context: "@AGENTS.md#reviews"
    reason: about how to work, not about the code
```

- `rulecast list` prints these entries after the rules. A later agent session sees that the convention was already considered, and why it has no rule, so it doesn't propose one again.
- `rulecast validate` and `rulecast doctor` check each `context` the way they check a rule's: the file and the section must exist. A broken entry is a warning, not an error, because it keeps no rule from running. That includes a malformed one, such as `why:` written for `reason:` or a missing `reason`: `validate`, `doctor` and `list` name what is wrong with it, every other part of the config loads, and hooks and `rulecast run` ignore the entry. `validate` still exits 0, so a doc heading renamed under an entry never blocks a commit or a CI job; the entry is yours to fix when the warning says so.
- The agent docs (`DRAFT-RULES.md`, `CONVENTIONS.md`) and the plugin's `add-rule` skill now propose `not_checked` entries and never write anything into your docs for this. If your docs already have `Not checked by rulecast:` lines, you can move each one into `not_checked` and delete the line.
