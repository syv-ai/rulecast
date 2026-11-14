import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"
import { stopVerdict } from "../helpers/stop"

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
    return stopVerdict(stdout)
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

/** One hook call in `sessionId`, by the main agent or the subagent `agentId`; a Bash call's `command` when given. */
function hookIn(sessionId: string, launchDir: string) {
  const env = { ...testEnv, CLAUDE_PROJECT_DIR: launchDir }
  return async (
    name: string,
    cwd: string,
    opts: { agentId?: string; file?: string; toolUseId?: string; command?: string } = {},
  ): Promise<string> => {
    const payload = claudeCodePayload(name, { root: cwd, file: opts.file, sessionId })
    if (opts.agentId === undefined) delete payload.agent_id
    else payload.agent_id = opts.agentId
    if (opts.toolUseId !== undefined) payload.tool_use_id = opts.toolUseId
    if (opts.command !== undefined) (payload as { tool_input?: unknown }).tool_input = { command: opts.command }
    const { stdout } = await runCli(cwd, ["hook", "claude-code"], JSON.stringify(payload), env)
    if (stdout === "") return ""
    const output = JSON.parse(stdout)
    return output.hookSpecificOutput?.additionalContext ?? output.reason ?? ""
  }
}

describe("rulecast hook claude-code: which projects a subagent's shell calls and stop reach", () => {
  test("a subagent in a worktree inside the repository is not held to the lead's checkout", async () => {
    const lead = await createRepo({
      ".rulecast-config.yaml": localConfig(RULES),
      ".gitignore": ".claude/\n",
      "a.py": "a = 1\n",
      "b.py": "b = 1\n",
    })
    const sub = path.join(lead, ".claude", "worktrees", "w1")
    await git(lead, "worktree", "add", "-q", "-b", "w1", sub)
    const hook = hookIn(randomUUID(), lead)
    await hook("session-start.startup", lead)
    await writeFile(path.join(sub, "b.py"), "b = 2\n")
    await hook("post-tool-use.edit.subagent", sub, { agentId: "sub1", file: "b.py" })
    await hook("pre-tool-use.bash", sub, { agentId: "sub1", toolUseId: "toolu_s" })
    await writeFile(path.join(lead, "a.py"), "print(3)\n")
    expect(await hook("post-tool-use.bash", sub, { agentId: "sub1", toolUseId: "toolu_s" })).toBe("")
    expect(await hook("subagent-stop", sub, { agentId: "sub1" })).toBe("")
  })

  test("a subagent in the lead's tree is checked in the packages the start found below it", async () => {
    const root = await createRepo({
      "packages/a/.rulecast-config.yaml": localConfig(RULES),
      "packages/b/.rulecast-config.yaml": localConfig(RULES),
      "packages/b/y.py": "y = 1\n",
    })
    const hook = hookIn(randomUUID(), root)
    await hook("session-start.startup", root)
    await hook("pre-tool-use.bash", root, { agentId: "sub1", toolUseId: "toolu_b" })
    await writeFile(path.join(root, "packages/b/y.py"), "print(1)\n")
    expect(await hook("post-tool-use.bash", root, { agentId: "sub1", toolUseId: "toolu_b" })).toContain(
      "packages/b/y.py:1 prints.",
    )
    expect(await hook("subagent-stop", root, { agentId: "sub1" })).toContain("packages/b/y.py:1 prints.")
  })

  test("the lead reading a file in a subagent's worktree does not make that worktree its own", async () => {
    const { lead, sub, hook, stopOf, subEdits } = await worktrees({ subagent_projects: "exclude" })
    await subEdits("print(1)\n")
    await hook("post-tool-use.read.complete", lead, { file: path.relative(lead, path.join(sub, "b.py")) })
    expect((await stopOf("stop", lead)).decision).toBeUndefined()
  })
})

describe("rulecast hook claude-code: a command that works in another checkout (#71)", () => {
  /** A repository whose config sits in `configDir`, with a second checkout `w1` next to it. */
  async function checkouts(configDir = ".", settings: Record<string, unknown> = {}) {
    const lead = await createRepo({
      [path.join(configDir, ".rulecast-config.yaml")]: localConfig(RULES, settings),
      [path.join(configDir, "a.py")]: "a = 1\n",
    })
    const other = path.join(await realpath(path.dirname(lead)), `${path.basename(lead)}-w1`)
    await git(lead, "worktree", "add", "-q", "-b", "w1", other)
    return { lead, other, hook: hookIn(randomUUID(), lead) }
  }
  const shellIn = (hook: ReturnType<typeof hookIn>, cwd: string, command: string, agentId?: string) => {
    const toolUseId = `toolu_${randomUUID()}`
    return hook("pre-tool-use.bash", cwd, { agentId, toolUseId, command }).then(() =>
      hook("post-tool-use.bash", cwd, { agentId, toolUseId, command }),
    )
  }

  test("told when the checkout's config is in a package below the named directory", async () => {
    const { lead, other, hook } = await checkouts("packages/b")
    expect(await shellIn(hook, lead, `cd ${other} && echo 'x = 1' >> packages/b/a.py`)).toContain(
      "another checkout of this repository",
    )
  })

  test("told even when the agent's own directory has no config", async () => {
    const { lead, other, hook } = await checkouts("packages/b")
    expect(await shellIn(hook, lead, `sed -i.bak s/a/b/ ../${path.basename(other)}/packages/b/a.py`)).toContain(
      "another checkout of this repository",
    )
  })

  test("told when the checkout is a subagent's project its config leaves out of the main agent's calls", async () => {
    const { lead, other, hook } = await checkouts(".", { subagent_projects: "exclude" })
    await writeFile(path.join(other, "a.py"), "a = 2\n")
    await hook("post-tool-use.edit.subagent", other, { agentId: "sub1", file: "a.py" })
    expect(await shellIn(hook, lead, `cd ${other} && echo 'print(1)' >> a.py`)).toContain(
      "another checkout of this repository",
    )
  })

  test("a subagent in a worktree inside the repository is told when it works in the main checkout", async () => {
    const lead = await createRepo({
      ".rulecast-config.yaml": localConfig(RULES),
      ".gitignore": ".claude/\n",
      "a.py": "a = 1\n",
    })
    const sub = path.join(lead, ".claude", "worktrees", "w1")
    await git(lead, "worktree", "add", "-q", "-b", "w1", sub)
    const hook = hookIn(randomUUID(), lead)
    expect(await shellIn(hook, sub, `cd ${lead} && echo 'x = 2' >> a.py`, "sub1")).toContain(
      "another checkout of this repository",
    )
    // And the lead, in turn, when it works in the subagent's worktree by a relative path.
    expect(await shellIn(hook, lead, "echo 'x = 2' >> .claude/worktrees/w1/a.py")).toContain(
      "another checkout of this repository",
    )
  })

  test("the agent is told once per checkout that shell edits there are not checked", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig(RULES), "a.py": "a = 1\n" })
    const builder = path.join(root, ".claude", "worktrees", "w1")
    execFileSync("git", ["worktree", "add", "-q", "-b", "w1", builder], { cwd: root })
    const sessionId = randomUUID()
    const env = { ...testEnv, CLAUDE_PROJECT_DIR: root }
    let calls = 0
    const shell = async (command: string) => {
      const id = `toolu_${++calls}`
      const send = (name: string) => {
        const payload = claudeCodePayload(name, { root, sessionId })
        payload.tool_use_id = id
        ;(payload as { tool_input?: { command?: string } }).tool_input = { command }
        return runCli(root, ["hook", "claude-code"], JSON.stringify(payload), env)
      }
      await send("pre-tool-use.bash")
      const { stdout } = await send("post-tool-use.bash")
      return stdout === "" ? "" : (JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? "")
    }
    const there = await shell(`cd ${builder} && echo 'print(1)' > b.py`)
    expect(there).toContain("this command works in .claude/worktrees/w1, another checkout of this repository")
    expect(there).toContain("EnterWorktree")
    // Once: the next command there says nothing more.
    expect(await shell(`cd ${builder} && echo 'print(2)' >> b.py`)).not.toContain("another checkout")
    // A command in the session's own checkout is no news.
    expect(await shell("echo 'x = 2' >> a.py")).not.toContain("another checkout")
  })
})
