---
"@syv-ai/rulecast": minor
---

Touch context is smaller and more predictable when several touch rules match one file, and `rulecast doctor` says when a file's touch context is too long (#69).

- **Each text is sent once.** When a touch rule cites a whole file and another cites a section of it, the agent used to get both, so the section arrived twice. Now the whole file is sent and the section isn't. If the whole file doesn't fit, the sections still go on their own.
- **The most specific sections go first.** When a file's touch context is more than one message holds, the rules that cite the least text go first (on a tie, the fewest items, then config order), so a rule citing a whole file usually goes after one citing a few sections. What doesn't fit is named for the agent to read, as before. That is now usually a broad rule's whole file, the one the agent most likely read at the start, and not the narrow sections listed last.
- **A section left out for room is sent once room frees up.** When a later part of the message turns out to cost less than planned, sections named earlier for lack of room are tried again. And when findings are shown, the budget no longer holds back room for the longer title that prints only when no finding fits, so a section or finding that fits is no longer cut by up to about 20 characters.
- **`rulecast doctor` has a `touch context` section.** For each set of touch rules a file can match, it runs the same budget the hook uses and warns when something would be cut, naming the file, the rules and the sections:

  ```text
  touch context
    warning  src/run/x.ts — the first open sends the context of 2 touch rules, more than one message holds: docs/a.md#three would be named, not sent. Narrow these rules to the one or two sections that area gets wrong (broad, narrow)
  ```

- `DRAFT-RULES.md` no longer tells agents to list every section that applies to an area in its touch rule. A touch rule now lists the one or two sections agents most often get wrong there, and principles that hold across the codebase stay in the agent doc. `guides/writing-rules.md` and the rule format reference say the same.
