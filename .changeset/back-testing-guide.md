---
"@syv-ai/rulecast": patch
---

The writing-rules guide has a new section, "Testing a rule on faults you already had" (#74). It describes how to test a rule against mistakes that really happened. Take a commit that introduced a fault and the commit that fixed it. The rule must fire on the first (`rulecast run <id> --from-ref F^ --to-ref F`), stay quiet on the fix, and fire on nothing else in `rulecast test <id> --history`. `DRAFT-RULES.md` has agents run the same three checks when the developer can name faults a rule should have caught.
