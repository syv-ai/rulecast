# Claude Code plugin

```text
/plugin install rulecast --marketplace syv-ai/rulecast
```

| Command | Does |
|---|---|
| `/rulecast:setup` | Sets rulecast up with you, as [Getting started](../README.md#getting-started) describes |
| `/rulecast:add-rule` | Looks back over the session for a correction or a mistake that should not happen again |
| `/rulecast:add-rule services never raise HTTPException` | Starts from the convention you name |

`add-rule` recommends the rule it would add and asks you to confirm before it drafts anything. If a catalog rule already checks it, it offers that one. Otherwise it writes the convention into your docs if no section states it, then drafts and measures the rule as [`agents/DRAFT-RULES.md`](../agents/DRAFT-RULES.md) describes. Nothing changes without your approval.

When you correct the agent on how code here should be written, it may ask once whether to add a rule for it.

The plugin's version follows the CLI's, so each release reaches you as a plugin update.
