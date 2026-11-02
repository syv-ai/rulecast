---
name: add-rule
description: Turns one convention into a rulecast rule, with the developer approving every change. The convention is the one the developer names, or, with nothing named, the one the session just showed: a correction they made, or a mistake that should not happen again. Use when the developer asks to add a rulecast rule, to make rulecast catch something, or to stop a mistake from recurring, and in a rulecast project when the developer corrects a mistake that code could show and that should not happen again.
argument-hint: "[the convention, or nothing for what just happened]"
---

# Add a rulecast rule

Turn one convention into a rulecast rule. The developer decides what the convention is, where it is written down, and whether the rule stays. Ask at each step below, and wait for the answer.

The developer asked for: $ARGUMENTS

If you started this yourself, without the developer asking, say so before anything else: name the mistake or correction that made you think a rule would help, and ask whether they want one. Stop if they don't.

Commands below say `rulecast`. If it is not on the PATH, use `npx @syv-ai/rulecast`.

## 1. Name the convention

- **If the developer named one above,** that is the convention.
- **If they named nothing,** look back over this session for what should not happen again: a correction the developer made, an edit they asked you to undo, a review comment, a mistake you or they caught. Take the most recent one. If there are several, list them and let the developer pick.

Write it as one sentence about the code, the way the project's docs would state it: "Services raise domain exceptions, never `HTTPException`", not "don't do what I did in `users.py`". Ask the developer whether that sentence is right, and wait.

A convention says what should hold from now on. If what happened was a one-off bug, say so and stop: a test is the right fix, not a rule.

## 2. Check that rulecast is set up, and find the config

1. Find the `.rulecast-config.yaml` files above the files the convention is about. A repository can have one at the top, one per package, or both, and every config above a file applies to it. If there is none, stop and follow [SETUP.md](https://raw.githubusercontent.com/syv-ai/rulecast/v0.6.0/agents/SETUP.md) with the developer first.
2. Choose the config with the developer. A convention about one package goes in that package's config; one for the whole repository goes in the top config.
3. In that config's directory, run `rulecast list`. If a rule already enforces the convention and should have caught what happened, the work is to fix that rule rather than add one. Show the developer what it checks and why it missed, and continue from step 4 with that rule.

## 3. Find where the convention is written

Every rule cites the doc section that states its convention, so the agent that breaks it reads why.

- Look in the project's docs (`AGENTS.md`, `CLAUDE.md` and the docs they point to) for a section that states the convention. A section about the same area is not enough: it has to state this rule.
- If no section does, propose one: the sentence from step 1, a line on why if the developer gave a reason, and where it goes, next to related conventions. Show it, and write it only after the developer agrees to the wording and the place.

## 4. Draft, measure and confirm the rule

Follow [DRAFT-RULES.md](https://raw.githubusercontent.com/syv-ai/rulecast/v0.6.0/agents/DRAFT-RULES.md) for this one convention: section 2 to tell whether code can show a break and to pick the detector, then section 3, steps 1 to 7. Draft in the config chosen in step 2, and run its commands in that config's directory.

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
