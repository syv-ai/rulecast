import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { Env } from "../../src/core/home"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"

/**
 * Unattended mode (#24) through the hook command, with recorded Claude Code payloads: what a goal
 * loop or a `claude -p` run is told at each of its stops. The first stop is `stop.json`; every
 * later one is `stop.after-block.json`, which Claude Code sends after a block.
 */

const USERS = "app/services/users.py"
const CLIENT = "src/client/api.ts"
const violation = (status: number) => `def get():\n    raise HTTPException(404)\n    raise HTTPException(${status})\n`

const UNATTENDED = "Nobody is watching this run to ask"
const REPORT = "Record each one as unresolved in your final report"

async function session(settings: Record<string, unknown> = {}, env: Env = testEnv) {
  const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(fixtureRules, settings) })
  const hook = (name: string, file?: string) =>
    runCli(root, ["hook", "claude-code"], JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })), env)
  let stops = 0
  /** The agent edits `file` to `content`; the edit hook sees it. */
  const edit = async (file: string, content: string) => {
    await writeFile(path.join(root, file), content)
    await hook("post-tool-use.edit", file)
  }
  /** The agent stops: the parsed hook output, or null when it printed nothing. */
  const stop = async () => {
    const { stdout } = await hook(stops++ === 0 ? "stop" : "stop.after-block")
    return stdout === "" ? null : JSON.parse(stdout)
  }
  return { root, edit, stop }
}

/** What the agent or the user was shown at a stop, by kind. */
const kindOf = (output: { decision?: string; reason?: string; systemMessage?: string } | null) =>
  output === null
    ? "allow"
    : output.decision === "block"
      ? output.reason?.includes(REPORT)
        ? "report"
        : "block"
      : "systemMessage"

describe("hook claude-code: unattended stops", () => {
  test("attended by default: one block per prompt, then only a system message nobody may read", async () => {
    const { edit, stop } = await session()
    await edit(USERS, violation(500))
    const first = await stop()
    expect(kindOf(first)).toBe("block")
    expect(first.reason).toContain("say so to the user")
    const second = await stop()
    expect(second).toEqual({ systemMessage: expect.stringContaining("stop gate limit reached") })
  })

  test("unattended: every stop with a new error blocks up to the budget, then the rest is reported to the agent", async () => {
    const { edit, stop } = await session({ unattended: { max_blocks: 3 } }, { ...testEnv, RULECAST_MODE: "unattended" })
    const kinds: string[] = []
    const outputs = []
    // An agent that keeps getting it wrong in a new way, so no finding is ever a repeat.
    for (const status of [500, 501, 502, 503, 504]) {
      await edit(USERS, violation(status))
      const output = await stop()
      outputs.push(output)
      kinds.push(kindOf(output))
    }
    expect(kinds).toEqual(["block", "block", "block", "report", "systemMessage"])
    expect(outputs[0].reason).toContain(UNATTENDED)
    expect(outputs[0].reason).toContain("raises HTTPException(500)")
    // The capped findings reach the agent as context, with what to do about them.
    expect(outputs[3].reason).toContain("raises HTTPException(503)")
    expect(outputs[3].reason).toContain("stop limit is reached")
    expect(outputs[4].systemMessage).toContain("raises HTTPException(504)")
  })

  test("a finding blocked twice is reported, not blocked again, so a false positive cannot loop", async () => {
    const { edit, stop } = await session({}, { ...testEnv, RULECAST_MODE: "unattended" })
    await edit(USERS, violation(500))
    const kinds = []
    for (let n = 0; n < 4; n++) kinds.push(kindOf(await stop()))
    expect(kinds).toEqual(["block", "block", "report", "systemMessage"])
  })

  test("a fixing turn answers the block, and the next stop is allowed", async () => {
    const { edit, stop } = await session({}, { ...testEnv, RULECAST_MODE: "unattended" })
    await edit(USERS, violation(500))
    expect(kindOf(await stop())).toBe("block")
    await edit(USERS, "def get():\n    raise HTTPException(404)\n    raise NotFound()\n")
    expect(await stop()).toBeNull()
  })

  test("RULECAST_MODE overrides the config, both ways", async () => {
    const forced = await session({ mode: "attended" }, { ...testEnv, RULECAST_MODE: "unattended" })
    await forced.edit(USERS, violation(500))
    expect((await forced.stop()).reason).toContain(UNATTENDED)

    const back = await session({ mode: "unattended" }, { ...testEnv, RULECAST_MODE: "interactive", CI: "true" })
    await back.edit(USERS, violation(500))
    expect((await back.stop()).reason).toContain("say so to the user")
  })

  test("the config's mode, and CI detection when the config says nothing", async () => {
    const configured = await session({ mode: "unattended" })
    await configured.edit(USERS, violation(500))
    expect((await configured.stop()).reason).toContain(UNATTENDED)

    for (const env of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
      const ci = await session({}, { ...testEnv, ...env })
      await ci.edit(USERS, violation(500))
      expect((await ci.stop()).reason).toContain(UNATTENDED)
    }

    const pinned = await session({ mode: "attended" }, { ...testEnv, CI: "true" })
    await pinned.edit(USERS, violation(500))
    expect((await pinned.stop()).reason).toContain("say so to the user")
  })

  test("an escalated warning rule blocks unattended and stays a warning attended", async () => {
    const settings = { unattended: { escalate: ["frontend/no-generated-edits"] } }
    const attended = await session(settings)
    await attended.edit(CLIENT, "export const api = 2\n")
    expect(await attended.stop()).toBeNull()

    const unattended = await session(settings, { ...testEnv, RULECAST_MODE: "unattended" })
    await unattended.edit(CLIENT, "export const api = 2\n")
    const output = await unattended.stop()
    expect(kindOf(output)).toBe("block")
    expect(output.reason).toContain("error frontend/no-generated-edits")
  })

  test("refuse_write: unattended refuses only when nobody is in the loop", async () => {
    const rules = fixtureRules.map((rule) =>
      rule.id === "frontend/no-generated-edits" ? { ...rule, refuse_write: "unattended" } : rule,
    )
    const write = async (env: Env) => {
      const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(rules) })
      const payload = claudeCodePayload("pre-tool-use.write", { root, file: CLIENT, sessionId: "s1" })
      const { stdout } = await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), env)
      return stdout === "" ? null : JSON.parse(stdout).hookSpecificOutput?.permissionDecision
    }
    expect(await write(testEnv)).toBeNull()
    expect(await write({ ...testEnv, RULECAST_MODE: "unattended" })).toBe("deny")
  })
})

/**
 * #29: configured rules that cannot run. A fresh clone that never ran `rulecast install` (a pinned
 * repo missing from the cache: hooks never fetch), and a detector whose tool is not installed.
 */
describe("hook claude-code: rules that did not run", () => {
  const MISSING_TOOL = {
    id: "shell",
    name: "Shell",
    files: "\\.py$",
    detect: { command: { run: ["definitely-not-a-real-binary-9x7", "{{files}}"] } },
    message: "{{file}}:{{line}} bad.",
  }

  async function fresh(config: string, env: Env) {
    const root = await createRepo({ "a.py": "x = 1\n", ".rulecast-config.yaml": config })
    const hook = async (name: string, file?: string) => {
      const payload = JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" }))
      const { stdout } = await runCli(root, ["hook", "claude-code"], payload, env)
      return stdout === "" ? null : JSON.parse(stdout)
    }
    let stops = 0
    const stop = () => hook(stops++ === 0 ? "stop" : "stop.after-block")
    const edit = async () => {
      await writeFile(path.join(root, "a.py"), "x = 2\n")
      return hook("post-tool-use.edit", "a.py")
    }
    return { root, hook, stop, edit }
  }

  const uncachedRepo = async () => {
    const url = path.join(await createRepo({}), "never-installed.git")
    return {
      url,
      config: `repos:\n  - repo: ${url}\n    rev: v1.0.0\n    rules:\n      - id: py/a\n      - id: py/b\n`,
    }
  }
  const UNATTENDED_ENV = { ...testEnv, RULECAST_MODE: "unattended" }

  test("unattended, a repo never installed holds the main agent once per prompt, then says it at every stop", async () => {
    const { url, config } = await uncachedRepo()
    const { hook, stop, edit } = await fresh(config, UNATTENDED_ENV)
    await edit()
    const line = `2 rules disabled: ${url}@v1.0.0: not in the cache (run rulecast install)`
    const first = await stop()
    expect(first.decision).toBe("block")
    expect(first.reason).toContain("State in your final report")
    expect(first.reason).toContain(line)
    for (let n = 0; n < 2; n++) {
      const later = await stop()
      expect(later.decision).toBeUndefined()
      expect(later.systemMessage).toContain(line)
    }
    // A subagent is told, never held: its report goes to its parent, which is held.
    const subagent = await hook("subagent-stop")
    expect(subagent.decision).toBeUndefined()
    expect(subagent.systemMessage).toContain(line)
    // A new prompt is a new report: the agent is held once more.
    await hook("user-prompt-submit")
    expect((await stop()).decision).toBe("block")
  })

  test("unattended, a detector whose tool is missing is named at every stop, not only the first time", async () => {
    const { stop, edit } = await fresh(localConfig([MISSING_TOOL]), UNATTENDED_ENV)
    await edit()
    const first = await stop()
    expect(first.decision).toBe("block")
    expect(first.reason).toMatch(/1 rule disabled: command detector: .*definitely-not-a-real-binary-9x7/)
    for (let n = 0; n < 2; n++) {
      expect((await stop()).systemMessage).toMatch(
        /1 rule disabled: command detector: .*definitely-not-a-real-binary-9x7/,
      )
    }
  })

  test("CI implies it, as it implies unattended", async () => {
    const { config } = await uncachedRepo()
    const { stop, edit } = await fresh(config, { ...testEnv, CI: "true" })
    await edit()
    expect((await stop()).reason).toContain("2 rules disabled")
  })

  test("attended, unchanged: said once to the user, never a block, and later stops say nothing", async () => {
    const { config } = await uncachedRepo()
    const { stop, edit } = await fresh(config, testEnv)
    const warned = await edit()
    expect(warned.systemMessage).toContain("rulecast install")
    for (let n = 0; n < 3; n++) expect(await stop()).toBeNull()
  })
})
