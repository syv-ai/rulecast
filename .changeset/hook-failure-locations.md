---
"@syv-ai/rulecast": patch
---

A failed `hook` rule no longer reports its failure on a file the hook never named.

- **The hook's own locations.** When a hook fails with output its `output` format does not read, rulecast now looks for a `path:line` in it, such as ty's ` --> app/user.py:93:5`, `./a.py:3` or `Dockerfile:12`. A line in one of the rule's files becomes the finding; a line in another rule's files from the same run leaves this rule with nothing. Before, the failure was always reported at line 1 of the rule's first file, so an `always_run` type check that failed over an unstaged file showed up on `.claude/hooks/rulecast.sh:1:1`.
- **Failures about other files, or no file.** A hook given exactly one file that names no file still reports a finding on that file. Whether a pre-commit hook is given its files comes from the config and, for a remote hook, from the manifest in the clone pre-commit or prek already made; with no clone it counts as not given. When the output names only files the run did not give the hook, or no file while the hook got several files or none (`always_run`, `pass_filenames: false`, an hk step), the rule gets an error that says so and quotes the output. `rulecast run` exits 3, as for any rule that could not give an answer.
- **A tool that could not start.** Exit 126 or 127, or output such as uv's "Failed to spawn", a shell's "command not found", pre-commit's "Executable `x` not found" or a stale shebang's "bad interpreter", is now a rule error saying the hook could not run, not a finding on the first file. The words count only when nothing else the hook printed is a finding or a place, so a finding that quotes them stays a finding.
