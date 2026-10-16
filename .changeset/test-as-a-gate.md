---
"@syv-ai/rulecast": minor
---

`rulecast test` can gate a rule an agent drafted, so a loop can check one without reading terminal text:

- **`--format json`** prints one document: per rule a `status`, and per example what it expected, what the rule found and, when it failed, why. It has its own `schemaVersion: 1`. The fields are in `agents/reference/output.md`.
- **A `bad` example can pin what it finds** with `expect: { count: 2 }` or `expect: { lines: [3, 7] }`. `lines` is compared as a set. Without `expect`, a `bad` example still passes on at least one finding.
- **A new `baseline` list** holds edits: `{ path, before, after, expect: { new: [...], preexisting: [...] } }`. `rulecast test` sorts the rule's findings in `after` into new and pre-existing by the rule's `scope`, the way an agent session would. This catches a rule that reports code an edit did not touch as new.
- **`--against PATH --max-rate 0.5`** exits 1 when a rule flags more than that share of the files it matches. It is not applied under 25 matching files.

`rulecast validate` rejects an `expect` on a `good` example, an empty `expect`, and an expected line past the end of its example. `agents/DRAFT-RULES.md` now asks for these expectations and gates on `--against . --max-rate 0.5`.

Terminal output without the new flags is unchanged.

**Breaking, for plugin code only:** the exported `RuleExamples` type has a required `baseline` list, and `bad` examples are `BadRuleExample` (exported, with the optional `expect`). Code that builds a `RuleExamples` value itself must add `baseline: []`.
