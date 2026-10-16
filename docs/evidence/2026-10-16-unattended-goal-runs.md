# Unattended mode under `/goal`, 2026-10-16

Issue #24. Two headless `claude -p` runs with an active `/goal` and `RULECAST_MODE=unattended`, to
see what an agent loop gets from the stop gate when nobody answers it: how many stops are blocked,
whether a block is answered by a fixing turn, what happens at the cap, and how rulecast's Stop hook
sits beside `/goal`'s.

**What this shows and does not.** Two runs with one small model task each, on Claude Code 2.1.301
with `--model sonnet`. They show the mechanics: blocks, a fix, the repeat limit, the report and the
cap, and what the transcript records. They say nothing about how often agents dispute findings, or
about cost at scale. In both runs `/goal`'s condition held at the first stop, so **`/goal`'s
no-progress guard was never exercised**. Whether a rulecast block counts against it is still
unmeasured (see the last section).

## Setup

A throwaway git repository with `docs/conventions.md` and two local regex rules, both `error`:
`py/no-print` ("use logging") and `py/no-main-function` ("entry points are named `run()`"). The
Claude Code hooks were the seven `rulecast install` writes, but each one ran rulecast **from
source** (`tsx packages/rulecast/src/cli.ts hook claude-code`), not `dist/`. The cache home was a
scratch `RULECAST_HOME`. `.rulecast-config.yaml` set `unattended.max_blocks: 3`.

`/goal` works headless. `claude -p "/goal"` alone answers ``No goal set. Usage: `/goal <condition>` ``.
With a condition, the transcript shows that `/goal` installs a **session-scoped Stop hook** whose
evaluator is a prompt over the transcript:

> A session-scoped Stop hook is now active with condition: "…". … The hook will block stopping until
> the condition holds. It auto-clears once the condition is met

## Run 1: a goal that contradicts both rules

```
RULECAST_MODE=unattended claude -p --model sonnet --max-turns 10 --dangerously-skip-permissions \
  "/goal app.py exists and defines a function main() that prints hello to stdout, called under
   if __name__ == '__main__'. Write a short final report when done."
```

The goal needs `main()` and stdout, so both findings are ones the agent should dispute. That is a
false positive as far as the run can tell, which is the case the repeat limit exists for.

| Stop | rulecast | `/goal` | What the agent did |
|---|---|---|---|
| 1 | **block**: both findings, unattended wording | met (1 iteration), cleared | kept the code; final report lists both findings and why |
| 2 | **block**: same two findings, second time | gone | "leaving `app.py` unchanged and recording both findings here, as the hook allows" |
| 3 | **report**: the findings have blocked twice | — | "**Unresolved rulecast findings (2):** …" with a reason for each |
| 4 | **capReached**: system message only | — | run ends, `num_turns: 6`, `subtype: success` |

The session store recorded the same thing:

```
{"t":"stopBlock","agent":"main","findings":["c2226779cc9ef5bf","1c30bff1b115d826"]}
{"t":"stopBlock","agent":"main","findings":["c2226779cc9ef5bf","1c30bff1b115d826"]}
{"t":"stopReport","agent":"main"}
```

The budget was 3 and only two blocks were spent. The repeat limit stopped the false positive first.
Before this change the run would have had one block (`stop_gate.max_blocks: 1`, and `/goal` sends
no `UserPromptSubmit`, so there was only ever one prompt). After that block, the findings would
have gone to a `systemMessage` that nobody reads.

The report stop (3) reached the model as `Stop hook feedback:`, starting:

> This project's rulecast rules (.rulecast-config.yaml) still find these problems, and rulecast will
> not block this run for them again (its stop limit is reached, or they have already blocked twice).
> Do not keep retrying them. Record each one as unresolved in your final report …

The agent's last message, which is what `claude -p` prints as its result:

> **Unresolved rulecast findings (2):**
> 1. `py/no-main-function` (app.py:1): the rule wants the entry point named `run()`. Unresolved
>    because the goal requires a function named `main()`.
> 2. `py/no-print` (app.py:2): the rule wants `logging` instead of `print()`. Unresolved because
>    the goal requires printing `hello` to stdout, and `logging` writes to stderr by default.
>
> No decisions file exists for this run, so the findings are recorded only here. I didn't change
> `.rulecast-config.yaml` or add any `rulecast-ignore` comments.

The cap is visible in the stream-json transcript in three places. Each `stop_hook_summary` carries
the block reason in `hookErrors`. After the first block Claude Code also showed a `stop-hook-error`
notification ("Stop hook error occurred"), although the hook exited 0. Stop 4's `systemMessage` arrives
as `informational`: "Stop says: rulecast: the agent stopped with these findings unresolved (stop
gate limit reached)."

## Run 2: a finding the agent can fix

The same repository with one rule, `py/no-print` with `stages: [verify]`. It is checked only at a
stop, so the edit hook says nothing and the stop gate is the only place it can show up.

```
RULECAST_MODE=unattended claude -p --model sonnet --max-turns 8 --dangerously-skip-permissions \
  "/goal app.py exists and defines run() that outputs hello, called under
   if __name__ == '__main__'. Write a short final report when done."
```

| Stop | rulecast | `/goal` | What the agent did |
|---|---|---|---|
| 1 | **block**: `app.py:2 calls print()` | met (1 iteration), cleared | **fixing turn**: rewrote `run()` to `log.info("hello")` with `basicConfig` under the guard, ran it, got `hello` |
| 2 | allow (nothing printed) | — | run ends, `num_turns: 6` |

The agent answered the block with a fix, not an argument. Its final report starts "I fixed the
`py/no-print` finding in `app.py`."

## rulecast and `/goal` on the same stop

- **Both are Stop hooks, and both run on every stop while the goal is active.** Stop 1 of each run
  has a `stop_hook_summary` with `hookCount: 2`: rulecast's command and the goal's prompt. Once the
  goal is met it removes itself, and later summaries show `hookCount: 1`.
- **A rulecast block holds the agent even when the goal is met.** In both runs the evaluator said
  "met" on the same stop that rulecast blocked, and the agent still took the next turn. In run 1 the
  evaluator even read the rulecast feedback and set it aside: "The rulecast lint warnings about
  main() naming and print() usage are advisory and do not change whether the stated condition
  holds." The goal judges its own condition, and rulecast enforces the conventions.
- **`/goal` sends no `UserPromptSubmit`.** The store has one `prompt` record per run, the `/goal`
  command itself. So the unattended budget is a per-run budget in a goal loop, which is why it is
  larger than the attended one.
- **`stop_hook_active` is not used.** It is `true` after any Stop hook's block, `/goal`'s included,
  so it cannot say whether rulecast was the hook that blocked. The count in the session store can,
  and the gate reads that.
- `hookAdditionalContext` appears, empty, in every `stop_hook_summary`. Context on a stop that is
  allowed was not tried. It would not help: a stop that is let through ends a headless run, so
  nobody would read it. That is why the report is a block.

## Not measured

Whether a rulecast block counts as "no progress" for `/goal`. Neither goal was still open after a
block. Measuring it needs a goal that is not met at the first blocked stop, and one cheap run did
not produce that. The fixture tests in `packages/rulecast/test/commands/hook-unattended.test.ts`
cover rulecast's side: blocks up to the budget, the report, the repeat limit, a fix answering a
block, and the precedence between the environment, config and CI.
