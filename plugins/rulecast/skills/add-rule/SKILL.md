---
name: add-rule
description: Turns one convention into a rulecast rule, with the developer approving every change. The convention is the one the developer names, or, with nothing named, the one the session just showed. Use when the developer asks to add a rulecast rule, to make rulecast catch something, or to stop a mistake from recurring.
when_to_use: 'Also when, in a rulecast project with the developer there to answer, they correct you and the correction says how code here should always or never be written. Then do not start this skill. Finish the fix and end that reply with one line: Want me to add a rulecast rule for this? "<the convention, in one sentence about the code>". Offer once per convention per session, never again for that convention after a no, and at most once per reply. Do not offer for a change of mind about this task, a one-off bug, or a mistake a rulecast finding already caught. Start this skill only after a yes, passing that sentence.'
argument-hint: "[the convention, or nothing for what just happened]"
---

# Add a rulecast rule

Turn one convention into a rulecast rule. The developer decides what the convention is, where it is written down, and whether the rule stays. Ask at each step below, and wait for the answer.

The developer asked for: $ARGUMENTS

Commands below say `rulecast`. If `rulecast` is not on the PATH, use `npx @syv-ai/rulecast`.

## If you were not asked

- **The developer said yes to your offer of a rule.** They asked for the convention as you worded it. Take it as confirmed in step 1, unless they reworded it, and go on to step 2. Do not ask again whether they want a rule.
- **You started this yourself, without offering first.** Say so before anything else: name the correction that made you think a rule would help, and ask whether they want one. Stop if they don't.
- **You were told to work without the developer.** Stop and say why: only the developer can choose a convention.

## 1. Name the convention

Never start drafting until the developer has confirmed which rule to add. Always ask with a recommendation.

- **If the developer named one above,** recommend a wording of it.
- **If they named nothing,** look back over this session for what should not happen again: a correction the developer made, an edit they asked you to undo, a review comment, a mistake you or they caught. If the session shows nothing clear, look briefly in your memory of this project, if you keep one, for corrections the developer made before.
  - **One candidate:** recommend it.
  - **Several:** list them, recommend the one you would add first and say why (the most recent, the one most likely to recur, the one code shows most clearly), and ask which.

Write each candidate as one sentence about the code, the way the project's docs would state it: "Services raise domain exceptions, never `HTTPException`", not "don't do what I did in `users.py`". For the one you recommend, add a line on what the rule would catch and where. Then ask the developer to confirm or correct it, and wait.

A convention says what should hold from now on. If what happened was a one-off bug, say so and recommend a test instead of a rule; add a rule only if the developer still wants one.

## 2. Check that rulecast is set up, and find the config

1. Find the `.rulecast-config.yaml` files above the files the convention is about. A repository can have one at the top, one per package, or both, and every config above a file applies to it. If there is none, stop: rulecast is not set up yet. Offer `/rulecast:setup`, which follows [SETUP.md](https://raw.githubusercontent.com/syv-ai/rulecast/v0.10.0/agents/SETUP.md) with the developer.
2. Choose the config with the developer. A convention about one package goes in that package's config; one for the whole repository goes in the top config.
3. In that config's directory, run `rulecast list`. If a rule already enforces the convention and should have caught what happened, the work is to fix that rule rather than add one. Show the developer what it checks and why it missed, and continue from step 4 with that rule.
4. Run `rulecast list --catalog`. If a catalog rule enforces the convention, recommend adopting it over drafting a new one: show what it checks and how many of the project's files it matches (`rulecast list --catalog <id>`), and with the developer's agreement run `rulecast add <id>` in that config's directory. It still cites the convention's section (step 3), as a `context` override on its entry; then go to step 5.

## 3. Find where the convention is written

Every rule cites the doc section that states its convention, so the agent that breaks it reads why.

- Look in the project's docs (`AGENTS.md`, `CLAUDE.md` and the docs they point to) for a section that states the convention. A section about the same area is not enough: it has to state this rule.
- If no section does, propose one: the sentence from step 1, and a line on why if the developer gave a reason. It goes where the first line of `rulecast list` says new conventions go. If that is a folder, propose the file: the existing area it belongs to, or a new one. If nothing is set, propose a place next to related conventions. The developer can name another place and has the final say. Show it, and write it only after the developer agrees to the wording and the place.

## 4. Draft, measure and confirm the rule

Follow [DRAFT-RULES.md](https://raw.githubusercontent.com/syv-ai/rulecast/v0.10.0/agents/DRAFT-RULES.md) for this one convention: section 2 to tell whether code can show a break and to pick the detector, then section 3, steps 1 to 7. Draft in the config chosen in step 2, and run its commands in that config's directory.

- If code cannot show a break, there is no rule. Propose a `Not checked by rulecast: <reason>` line next to the convention instead, as DRAFT-RULES.md describes.
- When the convention came from this session, the code that broke it is the best `bad` example, and the fix is a good `good` one. Shorten both to the lines that matter.
- The gates in DRAFT-RULES.md make a rule ready to show, not to keep. The developer keeps, edits or drops it.

## 5. Finish

Tell the developer, briefly:

- the convention, and the doc section it now cites;
- the rule's id and what it checks, with the `--against` (or `--history`) counts;
- anything you proposed and they turned down.

## Never

- Never change `.rulecast-config.yaml`, a rule or a doc without the developer's approval of that change, shown to them first. This holds whoever started the skill.
- Never weaken another rule, or add a `rulecast-ignore`, to make the new one pass.
- Never commit. The developer reviews and commits.
