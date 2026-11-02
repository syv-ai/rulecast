# Work out a project's conventions with the developer

Use this when the developer chose to review their conventions up front during setup ([SETUP.md](SETUP.md), step 6), or asks for it later. You and the developer work them out together. At the end they are in the project's docs, in the developer's words, and [DRAFT-RULES.md](DRAFT-RULES.md) can turn them into rules.

You bring the knowledge: named principles, practices and the standards for this kind of project. The developer brings what the code can't tell you: what the project is for, what matters, which way it should go. **The code shows what the project does, not what it wants.** Never present what the code does as what the project wants, and never write down a convention the developer didn't choose.

Relative links resolve against this file's own URL. Commands below say `rulecast`. If it is not on the PATH, use `npx @syv-ai/rulecast`.

## 1. The developer is there

Every decision in this session is the developer's. Ask, and wait for the answer. If you were told to work without the developer, stop and say why: rulecast enforces conventions the developer chose, and nobody else can choose them.

Ask one question at a time, with your question tool if you have one. Put your recommendation first.

## 2. Skim

Read these yourself:

- The docs: `README`, `AGENTS.md` or `CLAUDE.md`, `CONTRIBUTING`, anything under `docs/`, decision records.
- The tree, the languages and their share, the build and package files.
- Recent git activity: `git log --since="6 months ago" --format='%an %ad %s' --date=short | head -200`, and how many people commit.
- `rulecast list`: its first line says where new conventions go (the config's `conventions`).
- `docs/conventions/declined.md`, or a `declined.md` next to the conventions, if an earlier session left one. What it lists was already declined, with a reason. Don't propose it again unless the developer brings it up.
- Lines that begin `Not checked by rulecast:` in the project's docs. Each sits under a convention that was kept but has no rule, with the reason ([DRAFT-RULES.md](DRAFT-RULES.md#4-finish)). Don't propose a rule for one unless the reason no longer holds.

Then write down what the project **already enforces**: linter and formatter config and the rules it turns on or off, type-checker strictness, CI checks, pre-commit hooks, `.rulecast-config.yaml`, and the suppressions in the code (`# noqa`, `eslint-disable`, `@ts-expect-error`, `#[allow]`) with a count of each. These are conventions already. The interview confirms them; it doesn't rediscover them.

If the docs already state the project's conventions, say which docs and sections, and ask whether they are complete. If the developer says yes, go straight to [DRAFT-RULES.md](DRAFT-RULES.md) with that doc. Otherwise carry on.

If the repository doesn't show where its conventions live and the config names no `conventions`, ask that first: a folder of files by area, a single file, a wiki such as Confluence or Azure DevOps, or another repository. What is kept from a wiki is written into the repository, because rules cite files there.

## 3. Interview

In the chat, one question at a time. The questions are about **what matters in this kind of project**, not "here is a rule, do you agree?". For each topic that matters, explain the idea in plain words, show what the code does, recommend a choice for this kind of project, and, when the developer pushes back, argue from evidence and impact. Then accept their answer.

How to ask:

- **Find first.** Never ask what the repository can tell you. Arrive with the evidence and a recommendation, so the developer corrects a finding instead of recalling a fact.
- **Order by dependency.** Ask what other answers depend on first.
- **Challenge vague words.** "Clean", "simple", "consistent" and "small" mean something different to everyone. Ask what they'd look like in this code, with an example from it.
- **Offer contested practices as choices.** Mocks or no mocks, DRY or duplication until the third time: put both sides in front of the developer with your recommendation. None is settled.
- **Keep the developer's words.** Write down what they said, close to how they said it.

The order:

1. **What kind of project this is, and what good practice for it usually includes.** "From the code, this looks like a [kind]. Good practice for these includes [three or four practices, in plain words]. Which of these matter here?" Ask what scale it runs at, who uses it, and whether the developer values freedom of implementation or strict standards.
2. **What is already enforced.** Confirm the list from step 2 in one question: keep all of it, or does something there no longer hold? Ask about suppressions that cluster in one place.
3. **The named standards** that apply (PEP 8, a style guide, twelve-factor): how strictly to follow each. An adopted standard becomes one convention that cites it, plus the project's departures from it, not a restatement rule by rule.
4. **What the code does, where it matters.** "You use singletons for [X] in [files]. Should agents keep doing that, or move away from it? I'd [recommendation] because [evidence]."
5. **Reference and legacy.** Which areas are the example to follow and which are legacy, what is changing, and what goes wrong: in reviews, with agents, in production.

When the developer says no to something, note their reason. It goes in `declined.md` in step 6.

## 4. Write it down

From the answers, draft the principles and conventions in plain language: short sentences a developer would say to a colleague, with no rulecast terms. Each one traces to an answer. Nothing goes in that the developer didn't say or choose.

- **Principles** are the few things true of the whole project, the ones a newcomer most needs. They go in the project's agent doc, `AGENTS.md` (or `CLAUDE.md` if that's the one it uses).
- **Conventions** go where the config's `conventions` points (`rulecast list` shows it). For a folder, one file per area (core, adapters, tests, the API); propose the files and let the developer choose. For a single file, one section per convention.
- **Declined** items are what the developer said no to, each with their reason in their words. They go in `declined.md`, next to the conventions.

## 5. Review

Show the whole list on one page. Fill [setup-page.html](setup-page.html) as its head comment describes, with:

- `decisionsTitle`: `"Conventions"`, and `columns`: `["Convention", "Found", "You said", "Goes in"]`;
- one row per principle, convention and declined item: `decision` is the text, `found` the evidence from the code or null, `said` what the developer said, `lands` the file, `why` what it means here, and `detail` the section as it will be written (`label`: `"As written"`);
- no `tree`, `rules` or `candidates`.

In Claude Code, publish it as a private artifact. Otherwise write it outside the repository and tell the developer to open it. Ask in the chat what to change, apply it, and show the page again until the developer is satisfied.

## 6. Leave

Write the files the developer approved:

- The principles in the agent doc, in a section of their own, followed by a link to the conventions.
- The conventions where the config's `conventions` points.
- `declined.md`: one line per declined item, with the developer's reason. Later sessions read it so they don't ask again.

Show the developer the diff. Don't commit; the developer reviews and commits.

Then offer to continue with [DRAFT-RULES.md](DRAFT-RULES.md), which turns the conventions into rules.

## Never

- Never take a decision this document gives to the developer, and never work through it without them.
- Never ask the developer what the repository can tell you.
- Never present what the code does as what the project wants.
- Never write down a convention the developer didn't choose, or leave out a reason they gave.
- Never present a contested practice as settled.
- Never commit.
