---
"@syv-ai/rulecast": minor
---

Three changes drawn from measurements of where rulecast was weak, and a `doctor` fix.

**`scope: instance | container` on a rule.** A rule can say whether its convention belongs to the token the detector matched or to the node around it. `instance` is the default and is what every rule did before. `container` classifies a finding as new only when the node it spans was not already violating the rule at the baseline, which is what a `slim-routes`-shaped rule needs: measured over 1,377 agent-written sites, line overlap scored precision 0.62 there and the container comparison 0.76. The baseline records what a container rule matched when it snapshots a file, so the edit path still runs each detector exactly once and no file content is stored.

**`rulecast run --all-files` prints an adoption backlog**, and `--summary` prints it alone; `--format json` gains a `backlog` object. Counts, never a percentage: one codebase went from 61 violations in 80 files to 57 in 194 over eight months — the rate fell from 76% to 29% while the count stood still, because new code complied and the old violations were only diluted. Pre-existing findings in a hook delivery are now headed as a backlog and name the command that shows all of it, instead of reading as "not blocking, ignore this".

**`rulecast test`**, with an `examples` rule key holding `good` and `bad` cases. It runs them and scores each rule; `rulecast test <id> --against <paths>` fires the rule over real files and reports how much it would flag, so a rule that nobody breaks or that everybody breaks is visible before adoption rather than after. Every catalog rule now ships examples. `agents/DRAFT-RULES.md` no longer asks an agent to pick a detector tier up front: the same convention scored P 0.99 as a pattern under one wording and P 0.70 under a stricter one, so the flow is now attempt a pattern, measure it, and fall back to `llm` only on failure.

**Fixed:** `rulecast doctor` reported hooks as `ok` when the command they run is on neither the PATH nor `node_modules/.bin` — installed, and silently doing nothing on every event. It now warns and names the lever.
