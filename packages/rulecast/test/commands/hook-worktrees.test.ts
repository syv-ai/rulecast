import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"

const RULES = [
  {
    id: "py/no-print",
    name: "No print",
    files: "\\.py$",
    detect: { regex: { pattern: "print\\(" } },
    message: "{{file}}:{{line}} prints.",
  },
]

/**
 * A lead session launched in its own worktree, with one subagent in another worktree of its own
 * (#68, #73). `settings` go into the subagent's worktree config.
 */
async function worktrees(settings: Record<string, unknown> = {}) {
  const lead = await createRepo({ ".rulecast-config.yaml": localConfig(RULES), "a.py": "a = 1\n" })
  const sub = await createRepo({ ".rulecast-config.yaml": localConfig(RULES, settings), "b.py": "b = 1\n" })
  const sessionId = randomUUID()
  const env = { ...testEnv, CLAUDE_PROJECT_DIR: lead }
  let calls = 0
  /** One hook call by the main agent (no agentId) or a subagent, working in `cwd`. */
  const hook = (name: string, cwd: string, opts: { agentId?: string; file?: string; toolUseId?: string } = {}) => {
    const payload = claudeCodePayload(name, { root: cwd, file: opts.file, sessionId })
    if (opts.agentId === undefined) delete payload.agent_id
    else payload.agent_id = opts.agentId
    if (opts.toolUseId !== undefined) payload.tool_use_id = opts.toolUseId
    return runCli(cwd, ["hook", "claude-code"], JSON.stringify(payload), env)
  }
  const told = (stdout: string) => (stdout === "" ? "" : JSON.parse(stdout).hookSpecificOutput.additionalContext)
  const stopOf = async (name: string, cwd: string, agentId?: string) => {
    const { stdout } = await hook(name, cwd, { agentId })
    return (stdout === "" ? {} : JSON.parse(stdout)) as { decision?: string; reason?: string }
  }
  /** The subagent edits b.py in its worktree with the edit tool, which records that worktree as its project. */
  const subEdits = async (content: string) => {
    await writeFile(path.join(sub, "b.py"), content)
    return told((await hook("post-tool-use.edit.subagent", sub, { agentId: "sub1", file: "b.py" })).stdout)
  }
  /**
   * `agent` runs a shell command in `cwd` while the other agent's command runs in its own tree, and
   * `write` happens meanwhile: what `agent` is told after its command.
   */
  const shellDuringOther = async (
    agent: { cwd: string; agentId?: string },
    other: { cwd: string; agentId?: string },
    write: () => Promise<void>,
  ) => {
    const mine = `toolu_${++calls}`
    const theirs = `toolu_${++calls}`
    await hook("pre-tool-use.bash", other.cwd, { agentId: other.agentId, toolUseId: theirs })
    await hook("pre-tool-use.bash", agent.cwd, { agentId: agent.agentId, toolUseId: mine })
    await write()
    const { stdout } = await hook("post-tool-use.bash", agent.cwd, { agentId: agent.agentId, toolUseId: mine })
    await hook("post-tool-use.bash", other.cwd, { agentId: other.agentId, toolUseId: theirs })
    return told(stdout)
  }
  return { lead, sub, hook, stopOf, subEdits, shellDuringOther }
}

describe("rulecast hook claude-code: subagents in their own worktrees", () => {
  test("by default the main agent's stop also verifies its subagent's worktree", async () => {
    const { lead, sub, stopOf, subEdits } = await worktrees()
    expect(await subEdits("print(1)\n")).toContain("prints.")
    expect((await stopOf("subagent-stop", sub, "sub1")).decision).toBe("block")
    const main = await stopOf("stop", lead)
    expect(main.decision).toBe("block")
    expect(main.reason).toContain("b.py")
  })

  test("with subagent_projects: exclude, the main agent's stop leaves that worktree to the subagent", async () => {
    const { lead, sub, stopOf, subEdits } = await worktrees({ subagent_projects: "exclude" })
    await subEdits("print(1)\n")
    expect((await stopOf("subagent-stop", sub, "sub1")).decision).toBe("block")
    expect((await stopOf("stop", lead)).decision).toBeUndefined()
  })

  test("a main shell call reaching the subagent's worktree names the setting, not separate worktrees", async () => {
    const { lead, sub, subEdits, shellDuringOther } = await worktrees()
    await subEdits("b = 2\n")
    const told = await shellDuringOther({ cwd: lead }, { cwd: sub, agentId: "sub1" }, () =>
      writeFile(path.join(sub, "b.py"), "print(2)\n"),
    )
    expect(told).toContain("a subagent ran a shell command in its own working tree")
    expect(told).toContain("subagent_projects: exclude")
    expect(told).not.toContain("isolation: worktree")
  })

  test("with exclude, the subagent's writes are not held to the main agent's shell call", async () => {
    const { lead, sub, subEdits, shellDuringOther } = await worktrees({ subagent_projects: "exclude" })
    await subEdits("b = 2\n")
    const told = await shellDuringOther({ cwd: lead }, { cwd: sub, agentId: "sub1" }, () =>
      writeFile(path.join(sub, "b.py"), "print(2)\n"),
    )
    expect(told).toBe("")
  })

  test("a subagent's shell call never reaches the lead's worktree, whatever the setting", async () => {
    const { lead, sub, hook, subEdits, shellDuringOther } = await worktrees()
    await hook("session-start.startup", lead)
    await subEdits("b = 2\n")
    const told = await shellDuringOther({ cwd: sub, agentId: "sub1" }, { cwd: lead }, () =>
      writeFile(path.join(lead, "a.py"), "print(3)\n"),
    )
    expect(told).toBe("")
  })
})
