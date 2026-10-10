---
"@syv-ai/rulecast": minor
---

**Files the agent changes with Bash are now checked during the session.** Until now only `Edit` and `Write` were watched, so a rule broken with `sed -i`, a Python one-liner or a `>` redirect went unseen until a git hook or CI caught it. rulecast now records the working tree before and after each Bash call, and what changed during the call goes through the same check as an `Edit`: the finding arrives right after the call, titled "changed by your Bash command", and Stop is blocked until it is fixed. Run `rulecast install` again to add the Bash hooks to an existing install; `rulecast doctor` says when they are missing.

**`refuse_write` catches shell writes.** A command cannot be refused before it runs, because nothing knows what it will write, so a protected file changed with Bash is caught right after: the agent is told the file is protected and how to revert it (`git checkout -- <file>`, or "undo only your change" when the file had your uncommitted work), Stop is blocked until it does, whatever the rule's severity, and you get a notice naming the file.

**Changes nobody's tool call explains are reported, and never block.** Your own edits in another editor, a formatter, a job the agent left running: rulecast finds them by comparing the tree between calls and at Stop, reports them under "changed outside your tool calls", and never lets them stop the agent from finishing. On an allowed Stop they are shown to you.

**Your uncommitted work stays yours.** At session start rulecast snapshots the files that are already dirty, so an agent that reads a file with `cat` and rewrites it with `sed` is judged only on the lines it added, not on yours. A `git stash && git stash pop`, a commit or a checkout during a call is not counted as an edit.

The hook before each Bash call only records the tree. On a 20,000-file repository it adds 135–150 ms at p95; on an ordinary one, a few milliseconds. Outside a git repository rulecast says once that it cannot see the tree, and Bash edits are left to git hooks and CI as before.
