---
"@syv-ai/rulecast": minor
---

New `rulecast fix` command: rules whose violations have a mechanical fix can now carry that fix, and rulecast applies it for you instead of an agent fixing each one by hand.

- A `regex` rule takes `fix:` in the message's `{{name}}` syntax: `fix: "log.info({{args}})"`. An `ast-grep` rule takes ast-grep's own syntax: `fix: "logger.debug($$$ARGS)"`. No other detector accepts `fix`, and `rulecast validate` says so.
- `rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A)` fixes every finding of those rules in the files, old ones too, then checks the files as `rulecast run` does and exits with `run`'s codes. `--dry-run` prints the diff and writes nothing. A fix that leaves its own finding in place is undone and reported as unresolved, so running the command twice changes nothing the second time (unless fixes were still pending after 10 passes: then it writes what it got and says to run it again). Findings with a `rulecast-ignore` comment are left alone, and a file where a fix would move that comment away from its finding is left unchanged. It never writes through a symlink (the file or a directory in its path), outside the project, to a file that is not UTF-8 or that changed while it was fixing, or to a file whose fixes keep undoing each other; it says which files it left and why, and a file it cannot write does not stop the others.
- A fix has to be proven: a rule with `fix` needs at least one `bad` example, or its fix is dropped with a warning (the rule itself still runs). `rulecast test` applies the fix to every bad example and fails if the rule still fires on the result, or if the result differs from the example's optional `fixed:` text. `rulecast fix` runs the same check before it applies anything.
- Agent hooks never apply a fix. rulecast still never rewrites an agent's file behind its back.
- `--format json` marks a finding `"fixable": true` when `rulecast fix` can fix it, so a loop can send those to `rulecast fix` and the rest to an agent. The key is absent otherwise.
- Plugin API: a detector can declare `fixable(config)` and attach a `fix` (a text edit) to its findings when `DetectorRun.fixes` is set. The detector contract suite has optional cases for it.
