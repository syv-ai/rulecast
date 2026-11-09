---
"@syv-ai/rulecast": patch
---

The agent docs and the Writing rules guide now cover two more ways to place a convention.

- **A migration's lock.** When something is being replaced, `DRAFT-RULES.md` drafts a rule that flags the old form, because agents copy whatever is still in the code. Its existing uses are backlog, so the `--against` rate gate does not count against it. A lock rule that never fires is working as intended, not a candidate for removal. `CONVENTIONS.md` asks for both the old form and the new one, and for a mistake someone has actually seen.
- **One home for each convention.** Once a rule checks or delivers a section of `AGENTS.md` or `CLAUDE.md`, `DRAFT-RULES.md` proposes moving that section to the conventions docs, never copying it. The agent doc is read in every session; the rule delivers the section only when it is needed.
