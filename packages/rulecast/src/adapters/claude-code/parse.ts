import { z } from "zod"

import type { AdapterInput, EventKind, WriteIntent } from "../../core/types"

const common = z.object({
  hook_event_name: z.string(),
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  agent_type: z.string().optional(),
  source: z.string().optional(),
  prompt: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().min(1).optional(),
  permission_mode: z.string().optional(),
  last_assistant_message: z.string().optional(),
})

/** The UserPromptSubmit sources that are someone's prompt; the rest are machine-made turns. */
const PROMPT_SOURCES: ReadonlySet<string> = new Set(["user", "sdk"])

/**
 * What a turn Claude Code makes itself starts with, for a payload without `source` (absent in `-p`
 * runs on 2.1.325): a background task finishing, and in auto mode a subagent's hand-back.
 */
const MACHINE_PROMPTS = ["<task-notification>", "<agent-message "]

/** Whether a UserPromptSubmit is the user's own prompt: `source` when the payload has it, else its text. */
function isUserPrompt(source: string | undefined, prompt: string | undefined): boolean {
  if (source !== undefined) return PROMPT_SOURCES.has(source)
  return !MACHINE_PROMPTS.some((start) => prompt?.startsWith(start) === true)
}

/** Stop's tasks: what the agent started that still runs (a subagent's `id` is its agent id). */
const backgroundTasks = z.object({
  background_tasks: z.array(
    z.object({ id: z.string(), type: z.string().optional(), status: z.string().optional() }).passthrough(),
  ),
})

/** The worktree EnterWorktree or ExitWorktree moved the agent into or out of. */
const worktreeResponse = z.object({ tool_response: z.object({ worktreePath: z.string().min(1) }) })

/** The tools that change a file in place, by the input field that names it. */
const EDIT_TOOLS: ReadonlyMap<string, "file_path" | "notebook_path"> = new Map([
  ["Edit", "file_path"],
  ["Write", "file_path"],
  ["MultiEdit", "file_path"],
  ["NotebookEdit", "notebook_path"],
])
const editedFile = z.object({
  tool_name: z.string(),
  tool_input: z.object({ file_path: z.string().min(1).optional(), notebook_path: z.string().min(1).optional() }),
})

/** A Bash call's command, when the payload carries one. */
const bashInput = z.object({ tool_input: z.object({ command: z.string() }) })

const fileTool = z.object({
  tool_name: z.string(),
  tool_input: z.object({ file_path: z.string().min(1) }),
})

const readResponse = z.object({
  tool_response: z.object({
    file: z.object({ startLine: z.number(), numLines: z.number(), totalLines: z.number() }),
  }),
})

/** What Write and Edit say they are about to do; anything else shaped differently is left alone. */
const writeInput = z.object({
  tool_input: z.object({
    file_path: z.string().min(1),
    content: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    replace_all: z.boolean().optional(),
  }),
})

/** Maps a Claude Code hook payload (recorded in test/payloads/claude-code) to an adapter input. */
export function parseClaudeCode(input: unknown): AdapterInput | null {
  const head = common.safeParse(input)
  if (!head.success) return null
  const {
    hook_event_name: hook,
    session_id: id,
    cwd,
    agent_id: agentId,
    agent_type: agentType,
    source,
    prompt,
    tool_name: toolName,
    tool_use_id: toolUseId,
    permission_mode: permissionMode,
    last_assistant_message: lastMessage,
  } = head.data
  const session = agentId === undefined ? { id } : { id, agentId }
  // The type a main-thread event names is the session's (--agent); a subagent's is its own.
  const named = agentType === undefined || (agentId === undefined && agentType === "") ? {} : { agentType }
  const result = (
    kind: Exclude<EventKind, "guard" | "shell-before" | "shell-after" | "touch" | "verify"> | null,
    files: string[] = [],
  ): AdapterInput => ({
    cwd,
    event: kind === null ? null : { kind, files, cwd, session },
    warmup: false,
    ...(agentId === undefined ? named : {}),
  })
  // Before the file tools: a Bash payload has no file_path, which their schema requires. A command
  // that exits non-zero fires PostToolUseFailure instead of PostToolUse, and may have written files
  // before it failed, so both end the call (test/payloads/claude-code/README.md).
  const shell = (kind: "shell-before" | "shell-after", failed = false): AdapterInput => {
    const bash = bashInput.safeParse(input)
    return {
      cwd,
      event: {
        kind,
        files: [],
        cwd,
        session,
        ...(toolUseId === undefined ? {} : { toolUseId }),
        ...(failed ? { failed } : {}),
        ...(bash.success ? { command: bash.data.tool_input.command } : {}),
      },
      warmup: false,
      ...(agentId === undefined ? named : {}),
    }
  }
  const touch = (file: string, completeRead: boolean, failed = false): AdapterInput => ({
    cwd,
    event: { kind: "touch", files: [file], cwd, session, completeRead, ...(failed ? { failed } : {}) },
    warmup: false,
    ...(agentId === undefined ? named : {}),
  })
  const verify = (handback = false): AdapterInput => {
    // A subagent's payload describes the parent session's tasks, the stopping subagent among them.
    const tasks = agentId === undefined ? backgroundTasks.safeParse(input) : null
    const listed = tasks?.success === true ? tasks.data.background_tasks : []
    const running = listed.filter((task) => task.status === "running")
    const agents = running.filter((task) => task.type === "subagent").map((task) => task.id)
    const shells = running.filter((task) => task.type === "shell").length
    return {
      cwd,
      event: {
        kind: "verify",
        files: [],
        cwd,
        session,
        ...(handback ? { handback } : {}),
        ...(running.length > 0 ? { running: { agents, shells } } : {}),
      },
      warmup: false,
      ...(agentId === undefined ? named : {}),
    }
  }
  // Auto mode: a subagent ends by handing its report back, and refusing that is what keeps it working.
  if (toolName === "SubagentHandback" && hook === "PreToolUse" && agentId !== undefined) return verify(true)
  if (toolName === "Bash") {
    if (hook === "PreToolUse") return shell("shell-before")
    if (hook === "PostToolUse") return shell("shell-after")
    // Answered under its own hookEventName, so the event says which one fired.
    if (hook === "PostToolUseFailure") return shell("shell-after", true)
  }

  switch (hook) {
    case "PreToolUse": {
      const tool = fileTool.safeParse(input)
      if (!tool.success) return result(null)
      const { tool_name: name } = tool.data
      if (name !== "Edit" && name !== "Write") return result(null)
      const write = writeInput.safeParse(input)
      if (!write.success) return result(null)
      const {
        file_path: file,
        content,
        old_string: find,
        new_string: replace,
        replace_all: all,
      } = write.data.tool_input
      const intent: WriteIntent | null =
        content !== undefined
          ? { content }
          : find !== undefined && replace !== undefined
            ? { edit: { find, replace, all: all === true } }
            : null
      // A shape rulecast does not recognise is not a shape it may refuse.
      if (intent === null) return result(null)
      return { cwd, event: { kind: "guard", files: [file], cwd, session, intent }, warmup: false }
    }
    case "PostToolUse": {
      // The agent moved into a worktree, or out of one it keeps: its projects are the agent's now.
      if (toolName === "EnterWorktree" || toolName === "ExitWorktree") {
        const moved = worktreeResponse.safeParse(input)
        if (!moved.success) return result(null)
        return { ...result(null), workDirs: { dirs: [moved.data.tool_response.worktreePath], session } }
      }
      const edited = editedFile.safeParse(input)
      const field = edited.success ? EDIT_TOOLS.get(edited.data.tool_name) : undefined
      if (edited.success && field !== undefined) {
        const file = edited.data.tool_input[field]
        return result(file === undefined ? null : "edit", file === undefined ? [] : [file])
      }
      const tool = fileTool.safeParse(input)
      if (!tool.success || tool.data.tool_name !== "Read") return result(null)
      const read = readResponse.safeParse(input)
      const file = read.success ? read.data.tool_response.file : null
      return touch(
        tool.data.tool_input.file_path,
        file !== null && file.startLine === 1 && file.numLines === file.totalLines,
      )
    }
    case "PostToolUseFailure": {
      // A file too large to read fails the read: the agent asked for the file all the same.
      const tool = fileTool.safeParse(input)
      if (!tool.success || tool.data.tool_name !== "Read") return result(null)
      return touch(tool.data.tool_input.file_path, false, true)
    }
    case "Stop":
      return verify()
    case "SubagentStop":
      // /compact's summariser runs as a subagent with an empty agent type (under --agent, the
      // session's type: the hook command tells those apart).
      if (agentType === "") return result(null)
      // Auto mode: the subagent already handed its report back (SubagentHandback, checked there),
      // and a block now is recorded but never resumes it. Its stop then carries no last message.
      if (permissionMode === "auto" && lastMessage === undefined) return result(null)
      return { ...verify(), ...named }
    case "SubagentStart":
      if (agentId === undefined || agentType === "") return result(null)
      return { ...result("agent-start"), ...named }
    case "UserPromptSubmit":
      // Background tasks and subagent hand-backs submit prompts too; only the user's own reset the stop gate.
      return result(isUserPrompt(source, prompt) ? "prompt" : null)
    case "SessionStart":
      if (source === "compact") return result("reset")
      if (source === "startup" || source === "resume") return { ...result("start"), warmup: true }
      // clear and fork arrive with a new session id and empty stores: a session of their own, whose
      // dirty files need their start snapshots like any other. Warm-up already ran at startup.
      if (source === "clear" || source === "fork") return result("start")
      return result(null)
    default:
      return result(null)
  }
}
