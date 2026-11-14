import { describe, expect, test } from "vitest"

import { parseClaudeCode } from "../../../src/adapters/claude-code/parse"
import type { Event, EventKind } from "../../../src/core/types"
import { claudeCodePayload } from "../../helpers/payloads"

const parse = (name: string) => {
  const payload = claudeCodePayload(name)
  return { payload, parsed: parseClaudeCode(payload) }
}

describe("Claude Code adapter: parse", () => {
  test.each<[string, EventKind, string[], boolean | undefined]>([
    ["post-tool-use.read.complete", "touch", ["/project/src/math.ts"], true],
    ["post-tool-use.read.partial", "touch", ["/project/src/math.ts"], false],
    ["post-tool-use.read.relative-response-path", "touch", ["/project/src/wide.txt"], true],
    ["post-tool-use.edit", "edit", ["/project/src/math.ts"], undefined],
    ["post-tool-use.edit.replace-all", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.create", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.update", "edit", ["/project/src/wide.txt"], undefined],
    ["stop", "verify", [], undefined],
    ["stop.after-block", "verify", [], undefined],
    ["user-prompt-submit", "prompt", [], undefined],
    ["session-start.compact", "reset", [], undefined],
  ])("%s → %s", (name, kind, files, completeRead) => {
    const { payload, parsed } = parse(name)
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: { kind, files, completeRead, cwd: "/project", session: { id: payload.session_id } },
    })
  })

  test("pre-tool-use.edit → guard carrying the replacement the tool will make", () => {
    const { payload, parsed } = parse("pre-tool-use.edit")
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: {
        kind: "guard",
        files: ["/project/src/math.ts"],
        cwd: "/project",
        session: { id: payload.session_id },
        intent: {
          edit: {
            find: "export function sub(a: number, b: number) {",
            replace: "export function subtract(a: number, b: number) {",
            all: false,
          },
        },
      },
    })
  })

  test("pre-tool-use.write → guard carrying the whole file", () => {
    const { parsed } = parse("pre-tool-use.write")
    expect(parsed?.event?.kind).toBe("guard")
    const event = parsed?.event
    expect(event?.kind === "guard" ? event.intent : null).toEqual({ content: "export const added = 1\n" })
  })

  test("a PreToolUse for a tool that is neither a write nor the shell has no event", () => {
    const payload = { ...claudeCodePayload("pre-tool-use.edit"), tool_name: "Grep" }
    expect(parseClaudeCode(payload)?.event).toBeNull()
  })

  test.each<[string, EventKind]>([
    ["pre-tool-use.bash", "shell-before"],
    ["post-tool-use.bash", "shell-after"],
    // Fires at launch; the job's writes are swept later.
    ["post-tool-use.bash.background", "shell-after"],
  ])("%s → %s, carrying the tool use id and command, and no files", (name, kind) => {
    const { payload, parsed } = parse(name)
    const command = (payload.tool_input as unknown as { command: string }).command
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: {
        kind,
        files: [],
        cwd: "/project",
        session: { id: payload.session_id },
        toolUseId: payload.tool_use_id,
        command,
      },
    })
  })

  test("post-tool-use-failure.bash → shell-after, marked failed", () => {
    // A command that exits non-zero fires only the Failure hook, and may have written files first.
    const { payload, parsed } = parse("post-tool-use-failure.bash")
    expect(parsed?.event).toEqual({
      kind: "shell-after",
      files: [],
      cwd: "/project",
      session: { id: payload.session_id },
      toolUseId: payload.tool_use_id,
      failed: true,
      command: (payload.tool_input as unknown as { command: string }).command,
    })
  })

  test("Pre and Post of one Bash call carry the same tool use id", () => {
    const toolUseId = (event: Event | null | undefined) => (event && "toolUseId" in event ? event.toolUseId : undefined)
    const before = toolUseId(parse("pre-tool-use.bash").parsed?.event)
    expect(before).toBeDefined()
    expect(before).toBe(toolUseId(parse("post-tool-use.bash").parsed?.event))
  })

  test("post-tool-use.bash.subagent carries the subagent's agent id", () => {
    const { payload, parsed } = parse("post-tool-use.bash.subagent")
    expect(parsed?.event?.kind).toBe("shell-after")
    expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
  })

  test("a Bash payload without a tool use id still maps, without one", () => {
    const { tool_use_id: _, ...payload } = claudeCodePayload("post-tool-use.bash")
    const event = parseClaudeCode(payload)?.event
    expect(event?.kind).toBe("shell-after")
    expect(event && "toolUseId" in event).toBe(false)
  })

  test("a write whose shape rulecast does not recognise has no event, so it cannot be refused", () => {
    const payload = claudeCodePayload("pre-tool-use.edit")
    payload.tool_input = { file_path: "/project/src/math.ts" }
    expect(parseClaudeCode(payload)?.event).toBeNull()
  })

  test.each<[string, EventKind]>([
    ["post-tool-use.read.subagent", "touch"],
    ["post-tool-use.edit.subagent", "edit"],
    ["subagent-stop", "verify"],
    ["subagent-stop.after-block", "verify"],
  ])("%s carries the subagent's agent id", (name, kind) => {
    const { payload, parsed } = parse(name)
    expect(parsed?.event?.kind).toBe(kind)
    expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
  })

  test.each([
    "post-tool-use.agent",
    "subagent-stop.compaction",
    "pre-compact.manual",
    "user-prompt-submit.task-notification",
    // Recorded on 2.1.325: a background shell job and an isolated subagent finishing.
    "user-prompt-submit.task-notification.shell",
    "user-prompt-submit.task-notification.isolated",
    // Auto mode: a subagent's report reaches the parent as a prompt of its own.
    "user-prompt-submit.agent-message",
    // Neither changes anything rulecast judges; the worktree is the PostToolUse's to report.
    "pre-tool-use.enter-worktree",
    "post-tool-batch",
    "instructions-loaded",
  ])("%s has no event", (name) => {
    expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: false })
  })

  describe("prompts: only the user's own reset the stop gate", () => {
    const prompt = (fields: Record<string, unknown>) =>
      parseClaudeCode({ ...claudeCodePayload("user-prompt-submit"), ...fields })?.event?.kind ?? null

    test.each([
      ["user", "prompt"],
      ["sdk", "prompt"],
      ["system", null],
      ["loop_wakeup", null],
      ["schedule_wakeup", null],
      ["poll_event", null],
    ])("source %s → %s", (source, kind) => {
      expect(prompt({ source })).toBe(kind)
    })

    test("source, when the payload has it, decides over the prompt's text", () => {
      expect(prompt({ source: "user", prompt: '<agent-message from="a1">\nquoted by the user' })).toBe("prompt")
      expect(prompt({ source: "system", prompt: "fix the tests" })).toBeNull()
    })

    test("without source, a hand-back or a task notification is not a prompt", () => {
      expect(prompt({ prompt: '<agent-message from="a65b7cea55f00760c">\n[Subagent hand-back]' })).toBeNull()
      expect(prompt({ prompt: "<task-notification>\n<task-id>b1</task-id>" })).toBeNull()
      expect(prompt({ prompt: "what does <agent-message mean?" })).toBe("prompt")
    })
  })

  describe("agent types (--agent sessions)", () => {
    test("a main-thread event names the type the session runs as; one without names none", () => {
      const payload = { ...claudeCodePayload("stop"), agent_type: "reviewer" }
      expect(parseClaudeCode(payload)?.agentType).toBe("reviewer")
      expect(parseClaudeCode(claudeCodePayload("stop"))).not.toHaveProperty("agentType")
    })

    test("a subagent's stop carries its type, so the hook can tell an internal agent from a real one", () => {
      const { payload, parsed } = parse("subagent-stop")
      expect(parsed?.event?.kind).toBe("verify")
      expect(parsed?.agentType).toBe(payload.agent_type)
    })
  })

  describe("subagent hand-back (auto mode, 2.1.325)", () => {
    test("pre-tool-use.subagent-handback → the subagent's stop, marked a hand-back", () => {
      const { payload, parsed } = parse("pre-tool-use.subagent-handback")
      expect(parsed?.event).toEqual({
        kind: "verify",
        files: [],
        cwd: "/project",
        session: { id: payload.session_id, agentId: payload.agent_id },
        handback: true,
      })
    })

    test("a SubagentStop after the hand-back has no event: its block would be lost, and the hand-back was checked", () => {
      expect(parse("subagent-stop.after-handback").parsed?.event).toBeNull()
      expect(parse("post-tool-use.subagent-handback").parsed?.event).toBeNull()
    })

    test("a SubagentStop after a refused hand-back is an ordinary stop", () => {
      const { payload, parsed } = parse("subagent-stop.handback-denied")
      expect(parsed?.event?.kind).toBe("verify")
      expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
    })

    test("a SubagentStop without the last message outside auto mode is still checked", () => {
      const payload = { ...claudeCodePayload("subagent-stop.after-handback"), permission_mode: "acceptEdits" }
      expect(parseClaudeCode(payload)?.event?.kind).toBe("verify")
    })
  })

  describe("work still running at a stop", () => {
    test("stop.background-task names the running subagent", () => {
      const event = parse("stop.background-task").parsed?.event
      expect(event?.kind === "verify" ? event.running : null).toEqual({ agents: ["a65251da8a4fb4436"], shells: 0 })
    })

    test("stop.background-shell counts the running shell job", () => {
      const event = parse("stop.background-shell").parsed?.event
      expect(event?.kind === "verify" ? event.running : null).toEqual({ agents: [], shells: 1 })
    })

    test("a SubagentStop's tasks are the parent session's, the stopping subagent among them: ignored", () => {
      const { payload, parsed } = parse("subagent-stop.background-self")
      expect((payload.background_tasks as { id: string }[])[0]?.id).toBe(payload.agent_id)
      expect(parsed?.event?.kind).toBe("verify")
      expect(parsed?.event).not.toHaveProperty("running")
    })

    test("finished tasks are not running", () => {
      const payload = claudeCodePayload("stop.background-task")
      payload.background_tasks = [{ id: "a1", type: "subagent", status: "completed" }]
      expect(parseClaudeCode(payload)?.event).not.toHaveProperty("running")
    })
  })

  describe("worktrees the agent moves into", () => {
    test.each([
      ["post-tool-use.enter-worktree", "/project/.claude/worktrees/wt2"],
      ["post-tool-use.exit-worktree", "/project/.claude/worktrees/wt2"],
    ])("%s → the worktree, as a directory the agent works in", (name, dir) => {
      const { payload, parsed } = parse(name)
      expect(parsed?.event).toBeNull()
      expect(parsed?.workDirs).toEqual({ dirs: [dir], session: { id: payload.session_id } })
    })
  })

  describe("subagent start", () => {
    test.each([
      ["subagent-start", "/project"],
      ["subagent-start.isolated", "/project/.claude/worktrees/agent-a2bd60c5593ec0e01"],
    ])("%s → agent-start in the subagent's cwd", (name, cwd) => {
      const { payload, parsed } = parse(name)
      expect(parsed).toEqual({
        cwd,
        warmup: false,
        agentType: payload.agent_type,
        event: { kind: "agent-start", files: [], cwd, session: { id: payload.session_id, agentId: payload.agent_id } },
      })
    })

    test("an internal agent's start (empty type) has no event", () => {
      const payload = { ...claudeCodePayload("subagent-start"), agent_type: "" }
      expect(parseClaudeCode(payload)?.event).toBeNull()
    })
  })

  describe("other edit tools", () => {
    test("post-tool-use.notebook-edit → edit of the notebook", () => {
      const { payload, parsed } = parse("post-tool-use.notebook-edit")
      expect(parsed?.event).toEqual({
        kind: "edit",
        files: ["/project/n.ipynb"],
        cwd: "/project",
        session: { id: payload.session_id },
      })
    })

    test("a MultiEdit's PostToolUse → edit of its file", () => {
      const payload = {
        ...claudeCodePayload("post-tool-use.edit"),
        tool_name: "MultiEdit",
        tool_input: { file_path: "/project/src/math.ts", edits: [{ old_string: "a", new_string: "b" }] },
      }
      expect(parseClaudeCode(payload)?.event?.files).toEqual(["/project/src/math.ts"])
    })

    test("before a NotebookEdit or a MultiEdit there is no guard: what they would write is not known exactly", () => {
      expect(parse("pre-tool-use.notebook-edit").parsed?.event).toBeNull()
      const multi = {
        ...claudeCodePayload("pre-tool-use.edit"),
        tool_name: "MultiEdit",
        tool_input: { file_path: "/project/src/math.ts", edits: [{ old_string: "a", new_string: "b" }] },
      }
      expect(parseClaudeCode(multi)?.event).toBeNull()
    })

    test("post-tool-use-failure.read.too-large → touch, not complete, marked failed", () => {
      const { payload, parsed } = parse("post-tool-use-failure.read.too-large")
      expect(parsed?.event).toEqual({
        kind: "touch",
        files: [(payload.tool_input as { file_path: string }).file_path],
        cwd: "/project",
        session: { id: payload.session_id },
        completeRead: false,
        failed: true,
      })
    })
  })

  test.each(["session-start.clear", "session-start.fork"])(
    "%s → start, without warm-up: a new session id, whose dirty files need their snapshots",
    (name) => {
      const { payload, parsed } = parse(name)
      expect(parsed).toEqual({
        cwd: "/project",
        event: { kind: "start", files: [], cwd: "/project", session: { id: payload.session_id } },
        warmup: false,
      })
    },
  )

  test.each(["session-start.startup", "session-start.startup.interactive", "session-start.resume"])(
    "%s → start, and starts warm-up",
    (name) => {
      const { payload, parsed } = parse(name)
      expect(parsed).toEqual({
        cwd: "/project",
        event: { kind: "start", files: [], cwd: "/project", session: { id: payload.session_id } },
        warmup: true,
      })
    },
  )

  test.each([
    null,
    "text",
    {},
    { hook_event_name: "Stop", cwd: "/project" },
    { hook_event_name: "Stop", session_id: "", cwd: "/project" },
  ])("rejects malformed input %j", (input) => {
    expect(parseClaudeCode(input)).toBeNull()
  })
})
