---
"@syv-ai/rulecast": minor
---

Conventions review now scales past a few dozen candidates (#82). `CONVENTIONS.md` has a new step, "Many candidates", for when the developer asks for conventions from many sources and a one-question-at-a-time chat would take days.

1. **Mine** each source into candidates of one shape: the text, every source with its exact words, what the code does today, what could check it, what should enforce it, and where it would be written.
2. **Merge** them into one candidate per convention, keeping every quote. Where sources disagree, the disagreement becomes a conflict with options and a recommendation.
3. **Group** them into topics in dependency order, and recommend keep, reword or decline for each.
4. **Review** them on a new interactive page, `agents/conventions-review.html`. Conflicts come first, then one step per topic. Each candidate is a card the developer keeps, keeps in their own words, or declines with a reason. A decided card closes and the next one opens. There is a progress bar, a "show undecided only" switch, and a Finish step with the tally.
5. **Read back** the decisions. Published as an artifact with the `db` capability, they are saved with the page and the agent reads them back. As a local file (`conventions-review.local.html`), they stay in the browser, and Finish copies them as JSON to paste into the chat.

Declines carry their reason into `declined.md`. The page follows the viewer's light or dark theme.
