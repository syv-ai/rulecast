---
"@syv-ai/rulecast": minor
---

`rulecast test <id> --runs N` runs a rule's examples N times and reports how many runs passed (#72). An `llm` rule can pass its examples once and fail them the next time, and a single run doesn't show that. The output says `passed in 3 of 5 runs` and lists each example that failed in some runs, such as `good[0] a.py — passed in 3 of 5 runs`. The rule fails if any run failed. `N` goes up to 20, since every run of an `llm` rule costs money. `--format json` has the counts under `rules[].runs`. `--runs` doesn't combine with `--against` or `--history`.

The agent docs now leave the model for `llm` rules to the developer. They no longer suggest Haiku as the default. Instead they say what each model can do: Haiku is reliable only for simple, clear questions, and a rule that takes judgement needs Sonnet or stronger. On Haiku, one such rule failed its own examples every time, which looks the same as "no findings". `DRAFT-RULES.md` now has agents test a drafted `llm` rule with `--runs 5`.
