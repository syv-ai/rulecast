# rulecast Plan 14 — Conventions come from the developer

> **For agentic workers:** Use the executing-plans skill. The presentation page is designed with the developer before Task 2.

**Goal:** rulecast is never set up without the developer. Where a project's conventions are not written down, setting it up is an exercise the developer drives: the agent explores the code and brings candidate conventions to the developer's attention, and the developer picks, contributes and spars with it. Nothing is enforced that the developer did not choose.

**Evidence.** On 2026-10-11 an agent set up rulecast on this repository (`docs/evidence/2026-10-11-self-conventions.md`). It wrote 80 conventions mined from the code and git history, put them in one file, turned them into 75 enforced rules, and committed — without the developer deciding a single convention. Three things in rulecast's docs let it:

| Where | What it said | What it licensed |
|---|---|---|
| `DRAFT-RULES.md` line 12 | "If no developer is there to answer (you were told to work unattended, or nobody replies), don't wait: take the default" | The agent called itself unattended without asking anything |
| `DRAFT-RULES.md` step 7 | "Unattended, keep every rule that passes step 5" | Enforcing every rule nobody agreed to |
| `DRAFT-RULES.md`, `SETUP.md`, `init` | All assume a doc that already states the conventions | With none, the agent wrote its own, from the code |

The code says what the project does, not what it wants. A fix commit says a mistake happened once, not that the developer wants a rule against it. Mined conventions are candidates.

## Settled (2026-10-11, with the developer)

1. **No unattended mode.** There is no scenario where rulecast is set up without the developer present. The docs name no defaults to take when nobody answers; an agent without a developer stops.
2. **Layout.** rulecast recommends one — principles in `AGENTS.md`, one short section per area — and the agent asks before departing from it.
3. **Exploration by subagents** (Claude Code's subagents, or the vendor's equivalent). They work from a written brief that is generic enough not to impose opinions. What the main agent has learned from the developer about the state of the codebase goes into every brief.
4. **Presentation as an HTML document** (an Artifact in Claude Code). In it the developer can pick from the suggestions, contribute ideas of their own, and spar with the agent: have it check whether an idea holds, or look at a proposal from other angles. The template is designed with the developer.
5. **The interview method is part of the main agent's task**, written into the doc: one question at a time, ordered by dependency, a recommended answer with each, and a challenge to vague terms. It does not depend on a grill-me skill being installed.

Out of scope, for a later plan: the catalog. Ready-made rules should be mined from PEPs and similar standards and treated as a starting point, the way Black's defaults are mostly what is already considered standard and only a little opinion.

## Settled in the grill session (2026-10-11)

6. **Any project, gaps included.** The exercise is not only for an empty start: the agent asks what the docs already cover and runs the exercise for the gaps, building on what is written.
7. **One door.** `init`'s prompt and `SETUP.md` step 5 both point at the conventions doc. It opens by asking what the docs cover, runs the exercise, and ends by handing over to `DRAFT-RULES.md`, which stays the step from a doc to rules.
8. **Skim, then ask.** The main agent first reads the docs, the tree, the languages and recent git activity itself, without subagents, so its questions are concrete.
9. **The opening interview covers:** existing conventions and where they live (a `docs/` folder, a single file, a wiki such as Azure DevOps or Confluence, a separate repository); how much weight the existing code carries, and which areas are reference and which legacy; what is changing; what goes wrong (reviews, agents, production); who works in it, and which sources may be mined.

10. **Conventions outside the repo** (wiki, Confluence, another repository) are candidates, read through whatever access the agent has or pasted by the developer. They are the team's own words, so they carry the most weight. What the developer keeps is written into the repo's layout, because rules cite files; the agent suggests pointing the wiki at the repo, so there is one source.
11. **Subagents observe, the main agent distills, the developer concludes.** Subagents split by area, plus one per cross-cutting source (git history, PR reviews, existing docs) that maps what it finds to the areas. Subagents never propose conventions: separate agents for separate areas each find some, and the result is noise. They return observations. The main agent, holding the interview and every report, distills them into a consolidated, zoomed-out set of candidates. Nobody but the developer concludes.

12. **An observation carries:** the pattern in neutral words and its spread (how many places follow it and how many depart, with two or three file references each); its direction over time, from git dates (adopted or being left); which part of the interview it bears on, or none; and the subagent's own judgement, in a separate labelled field the main agent may weigh or set aside.
13. **The presentation document mirrors the target layout:** principles first, then one section per area. Each candidate sits where it would land, so what the developer keeps is what gets written, and gaps show (an area with nothing, a candidate that serves no principle).
14. **The page records, the agent acts.** Per candidate: keep, edit, drop, "check whether this holds", "other angles", and a note; plus a place for the developer's own ideas. In Claude Code the page saves these as rows (the Artifact `db` capability); the developer says so in the chat, and the agent reads them, does the checking with the repo and subagents, and updates the page. With other agents the page is a local HTML file whose "copy decisions" button produces a block to paste into the chat.

15. **Principles are distilled, and the developer settles them first.** The main agent distills a handful from the interview, the existing docs and the observations. They head the document; the developer keeps, edits, drops or adds, and candidates are regrouped under what survives. Candidates that fit no principle are shown together: a missing principle, or not a convention.
16. **Each candidate shows:** its wording as it would be written (one imperative sentence) and the principle it serves; its evidence (spread with file links, direction over time, and its sources, so mined and stated conventions are told apart); the question for the developer, if any; and its enforceability (a pattern rule could catch a break, a touch rule could only deliver it, or neither).
17. **Layout:** principles in `AGENTS.md`; each area in its own `docs/conventions/<area>.md` from the start, linked from `AGENTS.md`.
18. **What the session leaves:** the kept conventions, written into the layout; `docs/conventions/declined.md`, one line per dropped candidate with the developer's reason, read by later runs so it is not proposed again; then the agent offers to continue with `DRAFT-RULES.md` in the same session. The presentation page is not kept as a record.
19. **The doc is `agents/CONVENTIONS.md`.** Its first round shows a handful of principles and the strongest candidates, about 20 at most; more on request.

20. **`SETUP.md` reviews before it writes.** The agent runs `init` without `--yes` (it prints the review and writes nothing), shows it to the developer, and reruns with `--yes` only when they agree.
21. **This repository starts clean.** Its 75 local rules and `docs/conventions.md` were deleted; its conventions are redone through `agents/CONVENTIONS.md` as that doc's first trial.

## Open — work out with the developer

- **The presentation page itself.** Decisions 13–16 fix what it holds; how it looks and reads is designed together, as a prototype, before Task 2 writes the template into the doc.

## Task 1 — Remove the unattended mode

- [x] `DRAFT-RULES.md`: remove line 12 and every "Unattended" clause (lines 55, 64, 115, 140). In its place: every decision is the developer's; with no answer, wait; with no developer, stop.
- [x] `SETUP.md` step 5: asking is required, and the developer answers.
- [x] Both "Never" lists: never take a decision the steps give to the developer.
- [x] `SETUP.md` steps 2–4: review, ask, then `--yes` (decision 20).

## Task 2 — `agents/CONVENTIONS.md`

After the presentation page is designed.

- [ ] Write it, in the order the session runs: the developer must be present; skim; interview (decision 9); confirm areas; subagent briefs (decisions 11–12), with the interview in each; distill principles and candidates (decisions 15, 16, 19), reading `docs/conventions/declined.md` first; the page and the round trip (decisions 13, 14); write what was kept into the layout (decision 17) and the declined list (decision 18); offer `DRAFT-RULES.md`.
- [ ] The interview method, written in (decision 5): one question at a time, ordered by dependency, a recommended answer with each, vague terms challenged, and the repo explored instead of asking what it can answer.
- [ ] The subagent brief as a template: the generic part, and the slot for the interview.
- [ ] The page as a template: the Claude Code Artifact (with `db`) and the local HTML file with "copy decisions".
- [ ] Register it: `DOCS` in `test/agents-docs.test.ts`, a page in `packages/site/scripts/sources.ts`, the README's Agents list and its "Once it is set up" line.

## Task 3 — Point to it (decision 7)

- [ ] `SETUP.md` step 5 and `draftPrompt` (`src/init/draft-prompt.ts`) point at `CONVENTIONS.md`, not `DRAFT-RULES.md`.
- [ ] Update the prompt's tests and `PROMPT` in `test/commands/init.test.ts`.
- [ ] `DRAFT-RULES.md` step 1: a doc that points elsewhere, follow the pointer (done 2026-10-11). A doc with no conventions, only commands and architecture: stop, and go to `CONVENTIONS.md` with the developer first.
- [ ] `DRAFT-RULES.md` Never: "Never draft a rule for a convention the doc does not state."

## Task 4 — Correct the record

- [x] `docs/evidence/2026-10-11-self-conventions.md` says the rules "were reviewed with the developer". They were not: four rule-tuning questions were asked, and no convention was. Say so, and add the table above as the cause.
- [x] Delete this repository's 75 local rules and `docs/conventions.md`; `AGENTS.md` says the conventions are being redone (decision 21).
- [ ] Redo them through `CONVENTIONS.md` with the developer: the doc's first trial.

## Verification

- [ ] `pnpm test` (agent-docs links, site build, init prompt).
- [ ] A trial with the developer present: a fresh agent runs the README's paste-this prompt on a repository whose `AGENTS.md` has commands but no conventions. Pass: it skims, then interviews before any subagent runs; each subagent brief carries the interview; subagents return observations, not conventions; the first round has principles and at most about 20 candidates in the page; nothing the developer did not keep is written to the docs or the config.
- [ ] A fresh agent told to set rulecast up without the developer stops and says why.
