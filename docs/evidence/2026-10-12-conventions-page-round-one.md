# The conventions page, round one, 2026-10-12

Plan 14's prototype page (`docs/plans/prototype-14-conventions-page.html`) was filled with 4 principles and 11 suggestions an agent distilled about rulecast's own code, written in plain language. The developer went through all of them. Their choices, as the page copied them:

```text
Conventions for rulecast, round 1: my choices
- Principle P1: reworded → "rulecast should never slow the agent down or get in its way." — In a sense, rulecast exists exactly to get in the agent's way. What we are trying to do with the time budgets is to try to measure how much we slow down the process. Consider it like this: The future of agentic coding is loop engineering: Coding agents run in long running loops, spinning up subagents to do different tasks either sequentially or in parallel. Rulecast makes it possible to trust that agents do not compromise on conventions.
- Principle P2: reworded → "Adding a new agent or checker should never mean changing the core."
- Principle P3: reworded → "The same input should always give the same output." — with the exception of llm-based rules, yes, output should be deterministic.
- Principle P4: reworded → "Tests should prove the code works, not that it's wired up." — This is strictly true - but also true of any tests?
- c1 (core): reworded → "If rulecast itself breaks, let the agent keep working and tell the developer." — Agreed but it should be surfaced to the agent first and the agent informs the developer. Remember that rulecast is supposed to (also) be used in long-running loops. If this scenario, an orchestrator agent - the main session - should/could be able to hotfix but obviously not turn off rules.
- c2 (core): kept — We are not in principal against designing rulecast hooks that fetch something online. It would make sense to institute some clear guidelines, like "dangerously-allow-fetch: true" needs to be set or similar.
- c3 (core): kept
- c4 (core): kept · answer: We aren't principally against letting clock or the user's language settings change what rulecast prints, it just have to be a clear setting. I don't see this as being a rule. What would matter in this case would be that we always do the same thing and don't have stray duplication
- c5 (detectors): kept
- c6 (detectors): kept — For this, I think we should rely on whats common practice for, e.g., ty or mypy or similar. Or pre-commits in general.
- c7 (adapters): kept — It might be worthwhile to flag it?
- c8 (tests): kept · answer: I think it is pretty common practice to use mocks. In fact it's good practice.
- c9 (tests): kept — This is a weird type of thing to have a rule about. In rulecast we are not principally against skipping tests but it makes sense that this is not the agent's call. So yeah, maybe this works?
- c10 (style): kept · answer: This is neither, just what happened to evolve.
- c11 (release): kept
```

("reworded" on the principles is the page's labelling: the wording was left as it was, and the comments carry the developer's view.)

## What it shows

- **Mined suggestions take liberties.** Most of them were "kept" while the comments disagreed with them. The first principle had rulecast's purpose backwards. A no-mocks rule contradicted what the developer considers good practice. A rule against locale-dependent output turned out to be about a setting and duplication, not a rule. And a style rule described something that had just happened to evolve. A suggestion reads as a conclusion even when it is only an observation, and agreeing to its general direction is not the same as choosing it.
- **The developer's knowledge came out in the comments, not in the suggestions.** rulecast exists to get in the agent's way when a convention is at stake. It targets long-running agent loops, where an orchestrating agent should hear about a broken rule first and may hotfix but never turn rules off. Network access should be an explicit, dangerous opt-in. Timing should follow what tools like mypy, ty and pre-commit do. Skipping a test is not the agent's call.
- **So the process becomes an interview.** It opens with what kind of project this is and what is good practice for that kind of project, then asks about the design principles and patterns the code shows. The page is for reviewing the result, not for deciding.
