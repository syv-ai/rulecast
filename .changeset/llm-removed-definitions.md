---
"@syv-ai/rulecast": minor
---

An `llm` rule can now see what the change removed from its other files, so a moved class no longer looks like a new one (#72). The model judges one file at a time. A rule that asks "is this a second model of an existing concept?" used to flag a class moved into a new file, because nothing in that file showed it had existed before. With `removed_definitions: true` under `detect.llm`, the prompt for each file also lists the definitions the change removed from its other files, deleted and moved files included: `class Order:`, `def total():`, `export interface Cart`, `public class Order {`, `data class Order(`, and the like. A moved definition then reads as moved.

The old text comes from a commit: the session's start commit at an agent's stop, the merge base with `--from-ref`, or HEAD in a staged run. It is read only when such a rule runs, and at most 60 lines from other files are sent. A rule with this key gets its own model call per file, so the other rules' prompts and cached answers don't change.
