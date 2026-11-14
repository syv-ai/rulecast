import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { cacheHome } from "../../src/core/home"
import { sessionRoots } from "../../src/core/projects"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { createRepo, git } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { claudeCodePayload, type Payload } from "../helpers/payloads"

/** Hook behaviour pinned with payloads recorded on Claude Code 2.1.325. */

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

function send(root: string, payload: Payload, env: Record<string, string> = {}) {
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload), {
    ...testEnv,
    CLAUDE_PROJECT_DIR: root,
    ...env,
  })
}

describe("internal agents under claude --agent (R2)", () => {
  async function session() {
    const root = await createFixture()
    const sessionId = randomUUID()
    const payload = (name: string, overrides: Record<string, unknown> = {}) => ({
      ...claudeCodePayload(name, { root, file: USERS, sessionId }),
      ...overrides,
    })
    // The subagent edits a violation, so a stop that is checked blocks.
    await writeFile(path.join(root, USERS), VIOLATION)
    await send(root, payload("post-tool-use.edit.subagent", { agent_id: "a1", agent_type: "reviewer" }))
    return { root, payload }
  }

  test("a subagent stop whose type is the session's own is an internal agent's, and not checked", async () => {
    const { root, payload } = await session()
    // A main-thread event of an --agent session names its type, without an agent id.
    await send(root, payload("user-prompt-submit", { agent_type: "reviewer" }))
    const stop = await send(root, payload("subagent-stop", { agent_id: "a1", agent_type: "reviewer" }))
    expect(stop).toMatchObject({ code: 0, stdout: "" })
  })

  test("a subagent of another type is checked as before", async () => {
    const { root, payload } = await session()
    await send(root, payload("user-prompt-submit", { agent_type: "planner" }))
    const stop = await send(root, payload("subagent-stop", { agent_id: "a1", agent_type: "reviewer" }))
    expect(JSON.parse(stop.stdout).hookSpecificOutput.additionalContext).toContain("raises HTTPException(500)")
  })
})

describe("a subagent's hand-back in auto mode (R3)", () => {
  test("its findings refuse the hand-back; the SubagentStop after the hand-back is not checked", async () => {
    const root = await createFixture()
    const sessionId = randomUUID()
    await writeFile(path.join(root, USERS), VIOLATION)
    const agentId = claudeCodePayload("pre-tool-use.subagent-handback").agent_id
    const edit = claudeCodePayload("post-tool-use.edit.subagent", { root, file: USERS, sessionId, agentId: "x" })
    await send(root, { ...edit, agent_id: agentId })
    const handback = await send(root, claudeCodePayload("pre-tool-use.subagent-handback", { root, sessionId }))
    const output = JSON.parse(handback.stdout).hookSpecificOutput
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("raises HTTPException(500)")
    const after = await send(root, claudeCodePayload("subagent-stop.after-handback", { root, sessionId, agentId }))
    expect(after).toMatchObject({ code: 0, stdout: "" })
  })
})

describe("worktrees the agent moves into (R9)", () => {
  test("EnterWorktree records the worktree's projects as the agent's", async () => {
    const main = await createRepo({ ".rulecast-config.yaml": "repos: []\n" })
    const worktree = path.join(main, ".claude", "worktrees", "wt2")
    await git(main, "worktree", "add", "-q", worktree)
    const sessionId = randomUUID()
    const payload = claudeCodePayload("post-tool-use.enter-worktree", { root: worktree, sessionId })
    payload.tool_response = { ...(payload.tool_response as object), worktreePath: worktree }
    expect(await send(worktree, payload, { CLAUDE_PROJECT_DIR: main })).toMatchObject({ code: 0, stdout: "" })
    expect(await sessionRoots(cacheHome(testEnv), sessionId, "main")).toEqual([worktree])
  })

  test("an isolated subagent's start records its worktree as its project", async () => {
    const main = await createRepo({ ".rulecast-config.yaml": "repos: []\n" })
    const worktree = path.join(main, ".claude", "worktrees", "agent-a2bd60c5593ec0e01")
    await git(main, "worktree", "add", "-q", worktree)
    const sessionId = randomUUID()
    const payload = claudeCodePayload("subagent-start.isolated", { root: worktree, sessionId })
    await send(worktree, payload, { CLAUDE_PROJECT_DIR: main })
    expect(await sessionRoots(cacheHome(testEnv), sessionId, payload.agent_id)).toEqual([worktree])
  })
})

describe("a subagent's start (R13)", () => {
  test("is handed the project's convention docs as paths", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(fixtureRules),
      "conventions/backend.md": "# Backend\n## Errors\n## Services\n",
    })
    const result = await send(root, claudeCodePayload("subagent-start", { root, sessionId: randomUUID() }))
    const output = JSON.parse(result.stdout).hookSpecificOutput
    expect(output.hookEventName).toBe("SubagentStart")
    expect(output.additionalContext).toContain("- conventions/backend.md")
    expect(output.additionalContext).not.toContain("## Errors")
  })
})

describe("work still running at a stop (R10)", () => {
  test("a background subagent's own stop, listing itself as running, still delivers its finding", async () => {
    const root = await createFixture()
    const sessionId = randomUUID()
    const agentId = claudeCodePayload("subagent-stop.background-self").agent_id!
    await writeFile(path.join(root, USERS), VIOLATION)
    const edit = claudeCodePayload("post-tool-use.edit.subagent", { root, file: USERS, sessionId })
    await send(root, { ...edit, agent_id: agentId })
    const stop = await send(root, claudeCodePayload("subagent-stop.background-self", { root, sessionId }))
    const output = JSON.parse(stop.stdout).hookSpecificOutput
    expect(output.hookEventName).toBe("SubagentStop")
    expect(output.additionalContext).toContain("raises HTTPException(500)")
  })

  async function sweepScenario(subagentCwd: (root: string) => Promise<string>) {
    const root = await createFixture()
    const sessionId = randomUUID()
    const payload = claudeCodePayload("stop.background-task", { root, sessionId })
    const agentId = (payload.background_tasks as { id: string }[])[0]!.id
    await send(root, claudeCodePayload("session-start.startup", { root, sessionId }))
    const cwd = await subagentCwd(root)
    const start = claudeCodePayload("subagent-start", { root: cwd, sessionId })
    await send(cwd, { ...start, agent_id: agentId }, { CLAUDE_PROJECT_DIR: root })
    // Nobody's tool call: the user's own edit, found only by the sweep.
    await writeFile(path.join(root, USERS), VIOLATION)
    return JSON.parse((await send(root, payload)).stdout || "{}") as { systemMessage?: string }
  }

  test("a subagent starting at a config-less top records the packages the session start found", async () => {
    const top = await createRepo({ "pkg/.rulecast-config.yaml": "repos: []\n", "pkg/a.py": "" })
    const sessionId = randomUUID()
    await send(top, claudeCodePayload("session-start.startup", { root: top, sessionId }))
    const start = claudeCodePayload("subagent-start", { root: top, sessionId })
    await send(top, start)
    const roots = await sessionRoots(cacheHome(testEnv), sessionId, start.agent_id)
    expect(roots).toEqual([path.join(top, "pkg")])
  })

  test("a subagent running in the same checkout defers the sweep, and says so", async () => {
    const output = await sweepScenario(async (root) => root)
    expect(output.systemMessage).toContain("a subagent is still running")
    expect(output.systemMessage).not.toContain("changed outside the agent's tool calls this session have findings")
  })

  test("a subagent running in its own worktree does not defer this checkout's sweep", async () => {
    const output = await sweepScenario(async (root) => {
      const worktree = path.join(root, ".claude", "worktrees", "iso")
      await git(root, "worktree", "add", "-q", worktree)
      return worktree
    })
    expect(output.systemMessage).toContain("changed outside the agent's tool calls this session have findings")
    // Deferred only in the worktree's own project, where the subagent writes.
    expect(output.systemMessage).not.toMatch(/^\.rulecast-config\.yaml: rulecast: a subagent is still running/m)
    expect(output.systemMessage).toMatch(/^\.claude\/worktrees\/iso\/\.rulecast-config\.yaml: rulecast: a subagent/m)
  })
})
