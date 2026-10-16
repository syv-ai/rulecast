---
"@syv-ai/rulecast": minor
---

New `rulecast fix` command: rules whose violations have a mechanical fix can now carry that fix, and rulecast applies it for you instead of an agent fixing each one by hand.

- A `regex` rule takes `fix:` in the message's `{{name}}` syntax: `fix: "log.info({{args}})"`. An `ast-grep` rule takes ast-grep's own syntax: `fix: "logger.debug($$$ARGS)"`. No other detector accepts `fix`, and `rulecast validate` says so.
- `rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A)` fixes every finding of those rules in the files, old ones too, then checks the files as `rulecast run` does and exits with `run`'s codes. `--dry-run` prints the diff and writes nothing. A fix that leaves its own finding in place is undone and reported as unresolved, so running the command twice changes nothing the second time. Findings with a `rulecast-ignore` comment are left alone.
- A fix has to be proven: a rule with `fix` needs at least one `bad` example, or its fix is dropped with a warning (the rule itself still runs). `rulecast test` applies the fix to every bad example and fails if the rule still fires on the result, or if the result differs from the example's optional `fixed:` text. `rulecast fix` runs the same check before it applies anything.
- Agent hooks never apply a fix. rulecast still never rewrites an agent's file behind its back.
- `--format json` marks a finding `"fixable": true` when `rulecast fix` can fix it, so a loop can send those to `rulecast fix` and the rest to an agent. The key is absent otherwise.
- Plugin API: a detector can declare `fixable(config)` and attach a `fix` (a text edit) to its findings when `DetectorRun.fixes` is set. The detector contract suite has optional cases for it.
