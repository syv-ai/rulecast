# Claude Code hook payloads

Recorded 2026-09-16 from Claude Code 2.1.273 (`claude -p` and one interactive session driven by `expect`), with every hook event piped to a recorder. Paths are rewritten: the project is `/project`, the Claude config directory is `/home/user/.claude`, and a 6,000-char line in the `write.update` fixture is shortened to 20 chars. Everything else is as recorded.

## Files

| File | Event | Notes |
|---|---|---|
| `session-start.startup.json` | `SessionStart` | `-p` run |
| `session-start.startup.interactive.json` | `SessionStart` | interactive run: also carries `scratchpad_dir`, `model` |
| `session-start.resume.json` | `SessionStart` | `--resume`: same `session_id` as the resumed session |
| `session-start.compact.json` | `SessionStart` | after `/compact`: same `session_id` |
| `session-start.clear.json` | `SessionStart` | after `/clear`: **new** `session_id` |
| `session-start.fork.json` | `SessionStart` | `--resume --fork-session`: new `session_id` |
| `pre-compact.manual.json` | `PreCompact` | |
| `user-prompt-submit.json` | `UserPromptSubmit` | |
| `user-prompt-submit.task-notification.json` | `UserPromptSubmit` | a background subagent finished (interactive session); recorded later the same day |
| `post-tool-use.read.complete.json` | `PostToolUse` Read | no offset/limit |
| `post-tool-use.read.partial.json` | `PostToolUse` Read | `offset: 5, limit: 2` |
| `post-tool-use.read.relative-response-path.json` | `PostToolUse` Read | `tool_response.file.filePath` is relative (`src/wide.txt`) |
| `post-tool-use-failure.read.too-large.json` | `PostToolUseFailure` Read | 4.3 MB file; `PostToolUse` does not fire |
| `pre-tool-use.edit.json` | `PreToolUse` Edit | no `tool_response`: the file is unchanged |
| `pre-tool-use.write.json` | `PreToolUse` Write | `tool_input.content` is the whole file |
| `post-tool-use.edit.json` | `PostToolUse` Edit | |
| `post-tool-use.edit.replace-all.json` | `PostToolUse` Edit | `replace_all: true` |
| `post-tool-use.write.create.json` | `PostToolUse` Write | `tool_response.type: "create"` |
| `post-tool-use.write.update.json` | `PostToolUse` Write | `tool_response.type: "update"` |
| `post-tool-use.read.subagent.json` | `PostToolUse` Read | inside a subagent: `agent_id`, `agent_type` |
| `post-tool-use.edit.subagent.json` | `PostToolUse` Edit | inside a subagent |
| `post-tool-use.agent.json` | `PostToolUse` Agent | the parent's view of a finished subagent |
| `stop.json` | `Stop` | |
| `stop.after-block.json` | `Stop` | re-fired after a block: `stop_hook_active: true` |
| `subagent-stop.json` | `SubagentStop` | |
| `subagent-stop.after-block.json` | `SubagentStop` | `stop_hook_active: true` |
| `subagent-stop.compaction.json` | `SubagentStop` | fired by `/compact`'s summariser: `agent_type: ""` |
| `pre-tool-use.bash.json` | `PreToolUse` Bash | `sed -i` edit; recorded 2026-10-10 (see below) |
| `post-tool-use.bash.json` | `PostToolUse` Bash | the same call: same `tool_use_id`, `tool_response` has `stdout`/`stderr` |
| `post-tool-use-failure.bash.json` | `PostToolUseFailure` Bash | `false`: no `tool_response`; `error: "Exit code 1"`, `is_interrupt` |
| `post-tool-use.bash.background.json` | `PostToolUse` Bash | `run_in_background: true`: fires at launch, `tool_response.backgroundTaskId` |
| `post-tool-use.bash.subagent.json` | `PostToolUse` Bash | inside a subagent: `agent_id`, `agent_type` |

Recorded 2026-11-14 on Claude Code 2.1.325 (`claude -p`, `permission_mode: "auto"`), see below:

| File | Event | Notes |
|---|---|---|
| `user-prompt-submit.agent-message.json` | `UserPromptSubmit` | auto mode: a subagent's hand-back, `prompt` starting `<agent-message from="<agent_id>">` |
| `user-prompt-submit.task-notification.isolated.json` | `UserPromptSubmit` | an isolated (worktree) subagent finished in the background |
| `user-prompt-submit.task-notification.shell.json` | `UserPromptSubmit` | a `run_in_background` shell command finished |
| `subagent-start.json` | `SubagentStart` | `agent_id`, `agent_type`; no `permission_mode` |
| `subagent-start.isolated.json` | `SubagentStart` | `isolation: worktree`: `cwd` is the subagent's worktree |
| `post-tool-use.write.isolated-subagent.json` | `PostToolUse` Write | inside that subagent: `cwd` and the file in its worktree |
| `pre-tool-use.subagent-handback.json` | `PreToolUse` SubagentHandback | auto mode: the subagent's report in `tool_input.message` |
| `pre-tool-use.subagent-handback.denied-retry.json` | `PreToolUse` SubagentHandback | the next attempt after a refused hand-back |
| `post-tool-use.subagent-handback.json` | `PostToolUse` SubagentHandback | `tool_response: {success, message}` |
| `subagent-stop.after-handback.json` | `SubagentStop` | after a hand-back: no `last_assistant_message` |
| `subagent-stop.handback-denied.json` | `SubagentStop` | after two refused hand-backs: an ordinary stop, with `last_assistant_message` |
| `stop.background-task.json` | `Stop` | a background subagent still running: `background_tasks[{id, type: "subagent", status: "running"}]` |
| `stop.background-shell.json` | `Stop` | a background shell command still running: `type: "shell"`, `command` |
| `pre-tool-use.enter-worktree.json` | `PreToolUse` EnterWorktree | `cwd` is still the main checkout |
| `post-tool-use.enter-worktree.json` | `PostToolUse` EnterWorktree | `cwd` is the worktree; `tool_response.worktreePath` |
| `post-tool-use.exit-worktree.json` | `PostToolUse` ExitWorktree | `tool_response`: `worktreePath`, `restoredCwd`, `action` |
| `session-start.worktree.json` | `SessionStart` | `claude --worktree wt1`: `cwd` is the worktree |
| `pre-tool-use.notebook-edit.json` | `PreToolUse` NotebookEdit | `tool_input`: `notebook_path`, `cell_id`, `new_source` |
| `post-tool-use.notebook-edit.json` | `PostToolUse` NotebookEdit | `tool_response` has the whole old and new file |
| `post-tool-batch.json` | `PostToolBatch` | once per batch of tool calls; not used by rulecast |
| `instructions-loaded.json` | `InstructionsLoaded` | the first hook of a run; not used by rulecast |

## Findings

- **No `MultiEdit` tool.** 2.1.273 offers `Read`, `Edit`, `Write`; the model reported `MultiEdit` unavailable. 2.1.325's bundle still lists it among the file-edit tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`), so its `PostToolUse` is handled (`tool_input.file_path`) though no payload of it was recorded.
- **Paths.** `tool_input.file_path` is absolute. `tool_response.file.filePath` on Read is sometimes relative, so use `tool_input`.
- **Complete read.** No 2,000-line cap: a 2,600-line file came back whole (`startLine: 1`, `numLines: 2601`, `totalLines: 2601`). A read is complete when `startLine === 1 && numLines === totalLines`. A file over 256 KB fails the read (`PostToolUseFailure`) instead of truncating.
- **Subagents.** Subagent events share the parent's `session_id` and add `agent_id` and `agent_type`. Main-agent events have neither.
- **Compaction runs a subagent.** `/compact` fires `PreCompact`, then `SubagentStop` with `agent_type: ""`, then `SessionStart` `compact`. It sends no `UserPromptSubmit` and no `Stop`. A `SubagentStop` block must skip `agent_type: ""`.
- **Background tasks submit prompts.** When a background subagent finishes, Claude Code fires `UserPromptSubmit` with a `prompt` starting `<task-notification>`. In auto mode (2.1.325) a subagent's report arrives as one starting `<agent-message from="<agent_id>">` instead. Claude Code's docs name a `source` field for this (`user`, `sdk`, `system`, `loop_wakeup`, `schedule_wakeup`, `poll_event`), still rolling out: it was in none of the 2.1.325 `-p` payloads. On 2.1.273 `claude -p` ran a subagent in the foreground; on 2.1.325 subagents start in the background in `-p` too (`PostToolUse` Agent at launch, `Stop` listing it in `background_tasks`, then a last `Stop` once it finished).
- **Session ids.** `resume` and `compact` keep the `session_id`; `clear` and `fork` start a new one.
- **Stop block.** `{"decision":"block","reason":"…"}` on stdout, exit 0, works for both `Stop` and `SubagentStop`. The agent sees a user message `Stop hook feedback:\n<reason>` and continues; the next stop has `stop_hook_active: true`. The model complied but called the reason "instruction injection via tooling", so the reason should say it comes from the project's rulecast conventions.
- **Stop context.** Checked on 2.1.325: `Stop` and `SubagentStop` also take `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"…"}}`, which continues the turn the same way, under the same `stop_hook_active` and the same cap, and reaches the model as `Stop hook additional context: …` with no error framing. It is capped at 10,000 chars like any additionalContext; a block's `reason` is not capped (50,000 chars arrived whole). rulecast gives attended findings this way, and keeps the unattended hold a block.
- **Stop continuation cap.** Claude Code lets a stop hook continue a turn at most 8 times in a row without a tool call in between (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`); past that the stop goes through with a warning. From the 2.1.325 bundle, not recorded.
- **`PreToolUse` denies.** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` on stdout, exit 0, refuses the tool call; the reason reaches the model in place of the tool's result. `PostToolUse` cannot block — it fires after the call succeeded — so refusing a write is only possible here. Recorded 2026-09-23 with the Edit and Write payloads above.
- **`additionalContext` limit: 10,000 chars.** `hookSpecificOutput.additionalContext` of up to 10,000 chars (JS string length; 9,990 two-byte chars still inline) is injected whole. At 10,001 chars it is replaced by a `<persisted-output>` block: "Output too large (9.8KB). Full output saved to: <path>" plus a 2 KB preview. Nothing is truncated in between, so `maxContextChars` is 10,000.
- **Non-interactive runs.** `claude -p` waits 3 s for stdin unless it is redirected (`< /dev/null`).
- **Compaction re-attaches files.** Recorded on 2026-09-19 with Claude Code 2.1.278 (`claude -p --resume <session-id> "/compact" < /dev/null` compacts without an interactive session; hooks fire `SessionStart` resume, `PreCompact`, `SubagentStop`, `SessionStart` compact). After `/compact`, the main agent's 5 most recently read, edited or written files come back as `attachment` entries of type `file`, newest first, with no Read call. A partial read comes back whole; an edited file with its current content; a very large file (38,000 chars in the recording) becomes a pointer telling the agent to Read it, while an 11,400-char file came back whole. A second `/compact` with no reads in between re-attached nothing.
- **`SessionStart` `compact` output.** `hookSpecificOutput.additionalContext` reaches the model as a system reminder ("SessionStart hook additional context: …"); plain stdout is injected too. 12,040 chars were replaced by a `<persisted-output>` pointer with a 2 KB preview, as for `PostToolUse`. The recorded `SessionStart` compact payload has the same keys as `session-start.compact.json`.
- **`systemMessage` reaches the user on every event rulecast uses.** Checked against the hooks reference (code.claude.com/docs/en/hooks) on 2026-10-09: `systemMessage` is a common output field, "Warning message shown to the user", accepted by every event; the events that discard it are listed per event (Setup, InstructionsLoaded, Notification, ConfigChange, PreCompact, PostCompact, SessionEnd, WorktreeRemove, Elicitation, ElicitationResult), and `Stop`, `SubagentStop`, `PostToolUse` and `SessionStart` are not among them. `Stop` and `SubagentStop` take it beside `decision: "block"` ("in addition to the JSON output fields available to all hooks"). An async hook's `systemMessage` goes to the model instead; rulecast's hooks are synchronous. Plan 10 relies on this for user notices (config changed, ignores added) and for rule warnings.
- **A non-zero exit other than 2** is a non-blocking error: the action goes ahead and the transcript shows a `<hook name> hook error` notice with the first line of stderr. This is what a committed hook command shows on every event in a clone without `node_modules` — the reason plan 10's hook command exits 0 when the binary is missing.
- **Bash payloads.** Recorded 2026-10-10 from Claude Code 2.1.296 (`claude -p`, logging hook on `PreToolUse`, `PostToolUse` and `PostToolUseFailure` with matcher `Bash`). A command that exits non-zero fires `PostToolUseFailure` only, never `PostToolUse`; it carries `error` and `is_interrupt` and no `tool_response`, so a command that edits a file and then fails is seen only there. Every Bash payload carries `tool_use_id`, the same on `PreToolUse` and on its `PostToolUse`/`PostToolUseFailure`. A `run_in_background` call's `PostToolUse` fires as soon as the job is launched (5 ms in the recording, the job ran 3 s), with empty `stdout` and `tool_response.backgroundTaskId`; no hook event fires when the job finishes, so its writes are only seen by a later tree comparison. A subagent's Bash payloads carry `agent_id` and `agent_type`, as its Edit payloads do. `tool_input` has `command`, `description` and, when set, `run_in_background`; no file path.

- **A Stop hook's `systemMessage` in a headless run.** Recorded 2026-10-16 with Claude Code 2.1.301 (`claude -p --output-format stream-json --verbose`, rulecast unattended, one pinned rule repo missing from the cache; docs/evidence/2026-10-16-fresh-environment.md). An allowed stop's `systemMessage` is in the stream as a `system` entry with `subtype: "informational"` and `level: "notice"`, each line prefixed `Stop says: `. It is in the output, for whoever reads the log; it is never sent to the model. A block's `reason` reaches the model as a user message starting `Stop hook feedback:`. So the once-per-prompt `incomplete` block is what gets "rules did not run" into the agent's final report, and the `systemMessage` at every stop is for the log.

- **Plugins, and a missing hook command, on 2.1.319.** Recorded 2026-11-09 (`claude -p`, plus one interactive session driven by `expect` for the trust dialog), for plan 30.
  - A command that is not found (exit 127) is still a non-blocking error on every matching call. The transcript gets a `hook_non_blocking_error` attachment: `Failed with non-blocking status code: /bin/sh: <command>: command not found`. Commands run under `/bin/sh`.
  - Hooks in a plugin's `hooks/hooks.json` fire on `SessionStart`, `PostToolUse` and `Stop` like settings hooks, with `CLAUDE_PLUGIN_ROOT` (the cached plugin directory), `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_DATA` (`~/.claude/plugins/data/<plugin>-<marketplace>`) set, and the project directory as the working directory.
  - A committed `.claude/settings.json` with `extraKnownMarketplaces` (a git source) and `enabledPlugins` registers the marketplace once the folder is trusted, but does not load the plugin. The next session logs `Plugin "<name>" not cached … — run /plugin to refresh` and runs none of its hooks, and nothing is shown in the session. The hooks run only after `claude plugin install <name>@<marketplace> --scope project`, once per clone. That command rewrites `settings.json` (reformatted, same keys). This is why rulecast's hooks stay in the project's settings and run a committed script (plan 30).

- **Claude Code 2.1.325.** Recorded 2026-11-14 with `claude -p --model haiku`, a logging hook on every event, and the user's default `permission_mode: "auto"`. Paths are rewritten as above; the project is `/project` and a worktree `/project/.claude/worktrees/<name>`.
  - **Subagent hand-back (auto mode).** A subagent ends by calling the `SubagentHandback` tool (`PreToolUse`/`PostToolUse`, `tool_input.message` = its report). The parent then gets a `UserPromptSubmit` starting `<agent-message from="<agent_id>">`, and `SubagentStop` fires without `last_assistant_message`. A `SubagentStop` block at that point is recorded but never resumes the subagent.
  - **A refused hand-back.** A `PreToolUse` deny on `SubagentHandback` with findings as `permissionDecisionReason` reaches the subagent as a hook error, and it keeps working: in the recorded run it revised its report to carry the finding (it chose to report a conflict with its task rather than change the file). After two refusals in a row the subagent stopped the ordinary way (`SubagentStop` with `last_assistant_message`, `stop_hook_active` true on the next) and tried the hand-back again. Four refusals in a row lost the report: the parent got a `<task-notification>` and no `<agent-message>`. So rulecast refuses a hand-back at most once (twice unattended, the second to report).
  - **Work still running.** `Stop` carries `background_tasks`: each `{id, type, status, description}`, `type` `subagent` (with `agent_type`, `id` = its `agent_id`) or `shell` (with `command`). The main `Stop` can fire while a background subagent is still writing.
  - **Worktrees.** `cwd` follows the agent: after `EnterWorktree` (from its `PostToolUse` on), inside an `isolation: worktree` subagent (from `SubagentStart` on), and in a `claude --worktree` session. `CLAUDE_PROJECT_DIR` stays the main checkout after `EnterWorktree` and in isolated subagents, and is the worktree under `--worktree`. No payload field names a worktree; `EnterWorktree`'s and `ExitWorktree`'s `tool_response` carry `worktreePath`. `CwdChanged` does not fire for any of these. A `--worktree` session reads the worktree's committed `.claude/settings.json` and runs its hook script, and its fresh checkout has no `node_modules`.
  - **Settings and the start directory.** `.claude/settings.json` is read only in the directory a session starts in. `.claude/settings.local.json` is read at the git top, and from the main checkout in a worktree, while `CLAUDE_PROJECT_DIR` is the start directory: a command relative to it fails with 127.
  - **Edit tools.** `NotebookEdit` names its file `tool_input.notebook_path`; its `PreToolUse` has only the cell's new source, not the file it would leave.

