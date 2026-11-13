# Using it with your agent

## Claude Code

```text
/plugin install rulecast --marketplace syv-ai/rulecast
```

| Command | Does |
|---|---|
| `/rulecast:setup` | Sets rulecast up with you, as [Getting started](../README.md#getting-started) describes |
| `/rulecast:add-rule` | Looks back over the session for a correction or a mistake that should not happen again |
| `/rulecast:add-rule services never raise HTTPException` | Starts from the convention you name |

`add-rule` recommends the rule it would add and asks you to confirm before it drafts anything. If a catalog rule already checks it, it offers that one. Otherwise it writes the convention into your docs if no section states it, then drafts and measures the rule as [`agents/DRAFT-RULES.md`](../agents/DRAFT-RULES.md) describes. Nothing changes without your approval.

When you correct the agent on how code here should be written, it may ask once whether to add a rule for it.

The plugin's version follows the CLI's. Claude Code does not update a third-party marketplace by itself: for a new release, run `claude plugin marketplace update rulecast`, then `claude plugin update rulecast@rulecast`, and restart Claude Code.

## Other agents

rulecast ships docs written for coding agents, not for people. Paste the prompt from [Getting started](../README.md#getting-started) to yours and it sets rulecast up with you.

- [`agents/SETUP.md`](../agents/SETUP.md): your agent shows you a page of defaults from the repository, asks only what it can't tell, and writes it when you approve.
- [`agents/DRAFT-RULES.md`](../agents/DRAFT-RULES.md): give it one convention and it drafts the rule, shows you what it would flag today, and asks you to keep, edit or drop it.
- [`agents/CONVENTIONS.md`](../agents/CONVENTIONS.md): for working out your conventions up front. The agent reads the code, then interviews you one question at a time. Nothing goes into your docs that you didn't choose.

If your agent can't fetch a URL, have it run `npx @syv-ai/rulecast init --dry-run`, go through what it found with you, install rulecast, and run `rulecast init` with the flags you agree on (`rulecast init --help` lists them). Never edit hook settings by hand: `init`, `install` and `uninstall` own them.

## What the agent gets wrong

The hooks keep a local log of the findings they reported: finding ids, rule ids, files and lines, never code. `rulecast stats` reads it: which rules the agent fixes, which it keeps hitting or silencing, which never fire. Its keys are in [`agents/reference/stats.md`](../agents/reference/stats.md).

Once the log spans two weeks, `stats` also shows each rule's weekly rate and the files it keeps firing on. To keep 26 weeks of per-week counts, set `stats.weekly_summary: true` (or `rulecast init --weekly-summary`). `rulecast clean --project` deletes the log, with the rest of this project's cache; `rulecast clean` deletes the whole cache, fetched rule repos included.

### Reading the trend

To decide whether a rule is working, look at:

- **The in-session counts.** A high `fixed`, a `medianTurnsToFix` of 0 or 1 and a low `repeatRate` mean the finding and its doc section get the agent to fix the code. This is the main sign. An agent starts each session with no memory of the last, so a rule that works can keep firing at a flat rate: it catches the mistake each time, and the agent fixes it each time.
- **`firedPer100Runs` over the weeks, for a rule with `enoughFindings`.** A rate that falls while `runs` holds steady means agents make the mistake less often in the files the rule checks. That usually means the codebase has fewer examples of the wrong pattern left to copy, or the convention reached the agent some other way. A rate that falls only because `runs` fell means nothing.
- **`recurringFiles`.** A file where the rule fires in session after session. Either it holds code the agent keeps copying (often an old example of the wrong pattern, which the rule does not count, because findings that were already there are never logged), or the rule is wrong for that file. Open the file. Changing the rule's `exclude` is your call.

What the trend cannot tell you:

- **Why the rate changed.** There is no control group. A change of model, a new section in the agent's instructions, different work (other files, other kinds of task) or an edit to the rule itself all move the rate. The log does not record rule versions: check `git log -p .rulecast-config.yaml` for edits to the rule.
- **More than the log holds, unless the summary is on.** With `stats.weekly_summary` off, the trend reaches back only to the log's first record: about a week for a busy loop.
- **Anything about rules with too few findings:** under 10 in the window (`enoughFindings: false`), or a week with under 20 checks (`firedPer100Runs: null`).
- **Sessions on other machines.** The log is per machine and per checkout. Each worktree has its own; `rulecast stats --worktrees '*'` reads them all together, and a glob such as `--worktrees 'w2-*'` picks some. Worktrees removed since are included while their logs are in rulecast's cache.
- **Exact counts at the edges.** A session that runs past Sunday midnight UTC counts in both weeks, and a finding still open when the log drops old records can be counted as fired twice. A file's recurring count can be off by one for the same reason.
