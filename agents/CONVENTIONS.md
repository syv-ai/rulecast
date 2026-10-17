# Work out a project's conventions with the developer

Use this when the developer wants rulecast to enforce their project's conventions, whether those are written down, partly written down or not at all. You and the developer work them out together. At the end they are in the project's docs, in the developer's words, and [DRAFT-RULES.md](DRAFT-RULES.md) can turn them into rules.

You bring the knowledge: named principles, practices, patterns, anti-patterns and the standards for this kind of project. You likely know more of that than any one developer, and your job is to bring it to bear on this project. The developer brings what the code can't tell you: what the project is for, what matters, which way it should go. **The code shows what the project does, not what it wants.** Never present what the code does as what the project wants, and never write down a convention the developer didn't choose.

Relative links resolve against this file's own URL. Load these when you need them:

- [lenses/INDEX.md](lenses/INDEX.md): every lens in rulecast's catalog, one line each, and the list of kinds of project. `lenses/kinds/<kind>.md` is where to start for one kind; `lenses/entries/<id>.md` is one lens in full, with its counter-view.
- [lenses/THINKING.md](lenses/THINKING.md): how to think during the interview.
- [lenses/METHODOLOGIES.md](lenses/METHODOLOGIES.md): ways to frame a project's conventions.
- [lenses/AXES.md](lenses/AXES.md): the six quality axes and which lenses serve each.
- [conventions-review.html](conventions-review.html): the review page for step 7.

## 1. The developer is there

Every decision in this session is the developer's. Ask, and wait for the answer. If nobody answers, wait. If you were told to work without the developer, stop and say why: rulecast enforces conventions the developer chose, and nobody else can choose them. There is no unattended way through this document.

Ask one question at a time, with your question tool if you have one. Put your recommendation first.

## 2. Skim

Read these yourself, without subagents:

- The docs: `README`, `AGENTS.md` or `CLAUDE.md`, `CONTRIBUTING`, anything under `docs/`, decision records.
- The tree, the languages and their share, the build and package files.
- Recent git activity: `git log --since="6 months ago" --format='%an %ad %s' --date=short | head -200`, and how many people commit.
- `docs/conventions/declined.md`, if an earlier session left one. What it lists was already declined, with a reason. Don't propose it again unless the developer brings it up.
- Lines that begin `Not checked by rulecast:` in the project's docs. Each sits under a convention that was kept but has no rule, with the reason ([DRAFT-RULES.md](DRAFT-RULES.md#4-finish)). Those conventions were already considered. Don't propose a rule for one unless the reason no longer holds.

Then write down what the project **already enforces**: linter and formatter config and the rules it turns on or off, type-checker strictness, CI checks, pre-commit hooks, `.rulecast-config.yaml`, and the suppressions in the code (`# noqa`, `eslint-disable`, `@ts-expect-error`, `#[allow]`) with a count of each. These are conventions already. The interview confirms them; it doesn't rediscover them.

If the docs already state the project's conventions, say which docs and sections, and ask whether they are complete. If the developer says yes, go straight to [DRAFT-RULES.md](DRAFT-RULES.md) with that doc. Otherwise carry on: the interview confirms what is written and works out the rest.

If the repository doesn't show where its conventions live, ask that now, as the first question: a `docs/` folder, a single file, a wiki such as Confluence or Azure DevOps, or another repository. Read what the developer points you to. The team's own written words carry the most weight. What is kept from a wiki is written into the repository, because rules cite files there. Suggest pointing the wiki at the repository so there is one source.

## 3. Recall

Say what kind of project this is, using the kinds in [lenses/INDEX.md](lenses/INDEX.md). A project can be more than one (a CLI that is also a library). Open `lenses/kinds/<kind>.md` for each. It gives the kind's `hinge` (what its conventions usually turn on), the lenses an experienced reviewer raises first, in order, and the probes for the interview.

Write out, by name, the lenses that apply: from the kind pages, and from what the skim showed. Include the language's standards (PEP 8 and PEP 20, Effective Go, the TypeScript handbook's guidance) and the platform's practice (clig.dev for CLIs, the twelve-factor app for services, semver for libraries). Naming them is what brings the knowledge out in depth. "Best practices" brings out platitudes.

Where lenses overlap, the index's "Overlapping lenses" says which to start from. Read a lens's entry before you rely on it: each one has a counter-view, the signs that warrant it, what overdoing it looks like, and notes per language.

This list drives the next two steps: what the subagents look for evidence of, and what you ask about.

## 4. Explore

Asked to "find design problems in X", an agent returns the first few things it sees and stops. So the subagents here **enumerate**: each gets a fixed list of files and fills a fixed checklist for every one of them. **Subagents observe. They never evaluate or propose.** You hold every row in one context, which is the only place the structure is visible, and you apply the lenses.

Below about 15 source files, read them yourself and skip the subagents.

### Files

List the source files with `git ls-files`, leaving out generated, vendored and lock files. Split them into batches of about eight, keeping each directory together where you can. Give each batch to a subagent (Claude Code's Agent tool, or your harness's equivalent; without subagents, run the brief in a fresh chat per batch), with this brief and the batch, and nothing else:

```text
You produce an inventory table for a fixed list of files. You do not evaluate them.

One row per file in the batch, no exceptions. A file you could not parse, or that is generated
or vendored, still gets a row saying so. Read other files only to answer what a batch file
reaches into. Do not summarise. Do not evaluate: no findings, no smells, no recommendations,
no principles. If you write "should", "could", "consider" or "violates", delete the sentence.

For each file, terse, a clause per field:

--- <path>
owns: the one job or decision this file is responsible for, in the code's own nouns, or "unclear"
reasons to change: each kind of requirement that would force an edit here; <kind>; <kind>
reaches into: what of another module it depends on by shape rather than by contract (string keys
  into another module's data, another module's types, private names, vendor types crossing a
  boundary), as <symbol> → <owning module>; or "none"
public surface: exported or public names (<count>)
observed: only these, when present, with file:line; or "none observed"
  dispatching conditional · broad catch · silent default · repeated traversal ·
  module-level mutable · single-implementation abstraction · untyped boundary ·
  cleanup obligation · suppression comment · test double (mock, stub, fake)

End with: Rows: <n> of <n> files in batch.
```

Check coverage: every file in every batch has exactly one row. Run a batch again for any file without one. Anything still missing goes on a "not examined" list that you tell the developer about. A tally that looks complete when it isn't is worse than a gap you name.

### Across the files

Three more subagents, with the same rule: report what is there, with references, and evaluate nothing.

```text
Git history. From git log over the last year (or all of it, if shorter), report: the files that
most often change together in one commit (top 15 pairs, with counts); the 15 most-changed files;
how many people committed, and how the commits split between them; commits that revert or
undo earlier ones, with their messages; and commit messages that state a rule or a reason
("always", "never", "because", "so that"), quoted with their hash. No evaluation.
```

```text
Reviews. With gh (or the host's CLI), read the review comments on the last 30 merged pull
requests. Report the comments that ask for a change of approach rather than a typo fix,
quoted, with PR number and file, grouped where several say the same thing. If there is no
CLI or no access, say so and stop. No evaluation.
```

```text
Docs. Read every doc in the repository that isn't generated: README, AGENTS.md, CLAUDE.md,
CONTRIBUTING, docs/, decision records, comments at the top of modules. Report each sentence
that states how code should be written or organised, quoted with file:line, and say whether
it is phrased as a rule ("never", "always", "must") or a description ("we use"). Report where
two docs say different things about the same topic. No evaluation.
```

### Apply the lenses

Now, with every row in front of you, go through the lenses from step 3. For each one, note where the code follows it and where it departs, with file references, which way it has moved over time (the history report), and how much it matters for this kind of project.

**Be ruthless.** A lens without evidence that it matters here doesn't reach the interview. Every one that does completes this sentence: *this is what the code does; this is what it costs or saves here; this is how we'd know I'm wrong.* Dropping a lens costs nothing. Raising a weak one teaches the developer that your questions pad, and the strong ones get skimmed with the rest.

## 5. Interview

In the chat, one question at a time. The questions are about **what matters in this kind of project**, not "here is a rule, do you agree?". For each lens that matters, explain the idea in plain words, show what the code does, recommend a choice for this kind of project, and, when the developer pushes back, argue from evidence and impact. Then accept their answer.

How to ask:

- **Find first.** Never ask what the repository can tell you. Arrive with the evidence and a recommendation, so the developer corrects a finding instead of recalling a fact. When the findings settle a probe, say what you found in one line and ask only whether it should hold going forward. [lenses/THINKING.md](lenses/THINKING.md) has this and the other stances.
- **Order by dependency.** Ask what other answers depend on first.
- **Challenge vague words.** "Clean", "simple", "consistent" and "small" mean something different to everyone. Ask what they'd look like in this code, with an example from it.
- **Offer contested lenses as choices.** Lenses marked contested (mocks or no mocks, DRY or AHA) go in front of the developer with both sides and your recommendation. None is settled practice.
- **Keep the developer's words.** Write down what they said, close to how they said it. Their comments carry more than their yes or no.

The order:

1. **What kind of project this is, and what good practice for it usually includes.** "From the code, this looks like a [kind]. For these, conventions usually turn on [the kind's hinge]. Good practice includes [three or four lenses, in plain words]. Which of these matter here?" Several questions follow from this one. Ask what scale it runs at, who uses it, and whether the developer values freedom of implementation or rigorous standards.
2. **Which qualities matter most.** Name the six axes in plain words: security, reliability, the cost of the next change (testability included), how fast the team ships now, speed and resources at runtime, and what it takes to run and debug it. Recommend two or three for this project, from its kind and what you found, and ask which matter most. For the axes the developer picks, bring up the lenses whose primary effect is on them ([lenses/AXES.md](lenses/AXES.md)), and name each one's costs from its other signs and when a sign flips. Most lenses serve the cost of change, so within that axis the kind of project and the evidence decide which come first. The axes are one input: they don't override what the repository shows.
3. **The primary methodology**, from [lenses/METHODOLOGIES.md](lenses/METHODOLOGIES.md): how the project's surfaces and structure are worked out (framework idiom, contract-led, led by quality attributes, DDD-led, decision-led, exemplar code, a migration in progress), and usually a secondary one for internal code (often Refactoring to Patterns). It frames the rest. For DDD, ask which subdomains are core before any pattern.
4. **What is already enforced.** Confirm the list from step 2 in one question: keep all of it, or does something there no longer hold? Ask about suppressions that cluster in one place.
5. **The named standards** that apply (PEP 8, a style guide, SOLID, twelve-factor): how strictly to follow each. An adopted standard becomes one convention that cites it, plus the project's departures from it, not a restatement rule by rule.
6. **The lenses with evidence**, from step 4, and the kind's probes. "You use singletons for [X] in [files]. Should agents keep doing that, or move away from it? I'd [recommendation] because [evidence]." "SOLID is followed unevenly: [examples]. For a project like this it matters most for [area]."
7. **Reference and legacy.** Which areas are the example to follow and which are legacy, what is changing, and what goes wrong: in reviews, with agents, in production.

When the developer says no to something, note their reason. It goes in `declined.md` in step 8.

## 6. Write it down

From the answers, draft the principles and conventions in plain language: short sentences a developer would say to a colleague, with no rulecast terms. Each one traces to an answer. Nothing goes in that the developer didn't say or choose. Where a convention follows a lens, it can name it ("see the Law of Demeter") but must not depend on the reader knowing it.

- **Principles** are the few things true of the whole project, the ones a newcomer most needs. They go in the project's agent doc, `AGENTS.md` (or `CLAUDE.md` if that's the one it uses).
- **Conventions** belong to an area (core, adapters, tests, the API, the release) and go in `docs/conventions/<area>.md`, one file per area.
- **Declined** items are what the developer said no to, each with their reason in their words. They go in `docs/conventions/declined.md`.

If the project already keeps conventions somewhere in the repository, propose writing them there instead, and let the developer choose.

## 7. Review

Show the whole list on one page. Fill the template [conventions-review.html](conventions-review.html): replace `/*DATA*/null` with this object, as JSON:

```json
{
  "repository": "<repository name>",
  "answers": [{ "id": "q1", "question": "<what you asked>", "answer": "<what they said, in their words>" }],
  "items": [
    { "id": "p1", "file": "AGENTS.md", "text": "<the principle>", "from": ["q1"], "lenses": ["<lens id>"] },
    { "id": "c1", "file": "docs/conventions/<area>.md", "text": "<the convention>", "from": ["q2"], "lenses": [] },
    { "id": "d1", "file": "docs/conventions/declined.md", "text": "<what was declined>", "reason": "<their reason>", "from": ["q3"] }
  ]
}
```

Every item has at least one `from`. `lenses` are catalog ids, linked to their entries on the page. Keep ids stable if you build the page again.

- **In Claude Code**, write the filled page to a local file and publish it as an Artifact with `capabilities: {db: {}}`. The developer's choices save as they go, in the `db` collection `review`, one document per item id, with any of `removed`, `restored` (a declined item brought back), `text` (their wording) and `comment`. When the developer says in the chat that they're done, read the collection (`ArtifactData`, action `list`).
- **With any other agent**, write the filled page to a file outside the repository, tell the developer to open it in a browser, and wait. Its "Copy for the chat" button gives them a block to paste back.

Apply the choices: remove what was removed, use their wording where they gave one, and bring back what they brought back. A comment may need a conversation; have it, one question at a time. Then show the changed items again, in the chat or on the page, until the developer is satisfied.

## 8. Leave

Write the files the developer approved:

- The principles in the agent doc, in a section of their own, followed by a link to each `docs/conventions/<area>.md`.
- One `docs/conventions/<area>.md` per area.
- `docs/conventions/declined.md`: one line per declined item, with the developer's reason. Later sessions read it so they don't ask again.

Show the developer the diff. Don't commit; the developer reviews and commits.

Then offer to continue with [DRAFT-RULES.md](DRAFT-RULES.md), which turns the conventions into rules, starting from the agent doc you just wrote. If the developer runs agents with nobody watching, you can mention the `loop-safety` catalog pack, which `rulecast init --rules loop-safety` adds. Offer it; never add it as a default.

## Never

- Never take a decision this document gives to the developer, and never work through it without them.
- Never ask the developer what the repository can tell you.
- Never present what the code does as what the project wants.
- Never write down a convention the developer didn't choose, or leave out a reason they gave.
- Never let a subagent evaluate or propose. They observe.
- Never present a contested lens as settled.
- Never commit.
