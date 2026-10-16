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

async function session(settings: Record<string, unknown> = {}, env: Env = testEnv, files: Record<string, string> = {}) {
  const root = await createRepo({
    ...fixtureFiles,
    ...files,
    ".rulecast-config.yaml": localConfig(fixtureRules, settings),
  })
  const hook = (name: string, file?: string) =>
    runCli(root, ["hook", "claude-code"], JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })), env)
  let stops = 0
  /** The agent edits `file` to `content`; the edit hook sees it. What the agent was told, or "". */
  const edit = async (file: string, content: string): Promise<string> => {
    await writeFile(path.join(root, file), content)
    const { stdout } = await hook("post-tool-use.edit", file)
    return stdout === "" ? "" : (JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? "")
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

describe("hook claude-code: rulecast-ignore in unattended mode", () => {
  const UNATTENDED_ENV = { ...testEnv, RULECAST_MODE: "unattended" }
  const IGNORED = "    raise HTTPException(500)  # rulecast-ignore: backend/no-httpexception the caller expects it\n"
  const ADDED_NOTICE = "the agent added a rulecast-ignore comment this session"

  test("an ignore added this session does not silence its finding: delivered, blocked twice, then reported", async () => {
    const { edit, stop } = await session({}, UNATTENDED_ENV)
    expect(await edit(USERS, `def get():\n    raise HTTPException(404)\n${IGNORED}`)).toContain(
      "raises HTTPException(500)",
    )
    const outputs = []
    for (let n = 0; n < 4; n++) outputs.push(await stop())
    expect(outputs.map(kindOf)).toEqual(["block", "block", "report", "systemMessage"])
    expect(outputs[0].reason).toContain("raises HTTPException(500)")
    expect(outputs[0].reason).toContain("does not silence a finding")
    // The developer reading the run's log still learns the agent tried.
    expect(outputs[0].systemMessage).toContain(ADDED_NOTICE)
  })

  test("an ignore that was already in the code still silences its finding", async () => {
    const committed = `def get():\n${IGNORED}`
    const { edit, stop } = await session({}, UNATTENDED_ENV, { [USERS]: committed })
    // Not even counted among the file's pre-existing findings.
    expect(await edit(USERS, `${committed}    return None\n`)).not.toMatch(/HTTPException|no-httpexception/)
    expect(await stop()).toBeNull()
  })

  test("attended, an added ignore silences its finding as before, and the user is told", async () => {
    const { edit, stop } = await session()
    expect(await edit(USERS, `def get():\n    raise HTTPException(404)\n${IGNORED}`)).not.toContain(
      "raises HTTPException(500)",
    )
    expect(await stop()).toEqual({ systemMessage: expect.stringContaining(ADDED_NOTICE) })
  })
})

describe("hook claude-code: a removed assertion in unattended mode", () => {
  const TEST = "tests/test_pricing.py"
  const rule = {
    id: "tests/keep-assertions",
    name: "Assertions are not removed",
    files: "^tests/",
    severity: "warning",
    escalate: true,
    scope: "removed",
    detect: { "ast-grep": { language: "python", rule: { kind: "assert_statement" } } },
    message: "{{file}}:{{line}} removes assertions ({{text}}). Make the test pass instead.",
  }

  test("a deleted assert blocks the stop, escalated to an error; attended it is a warning that lets the stop through", async () => {
    const files = { [TEST]: "def test_total():\n    assert total([1, 2]) == 3\n    assert total([]) == 0\n" }
    const weakened = "def test_total():\n    assert total([1, 2]) == 3\n"
    const run = async (env: Env) => {
      const root = await createRepo({ ...files, ".rulecast-config.yaml": localConfig([rule]) })
      const hook = (name: string, file?: string) =>
        runCli(
          root,
          ["hook", "claude-code"],
          JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })),
          env,
        )
      await writeFile(path.join(root, TEST), weakened)
      await hook("post-tool-use.edit", TEST)
      const { stdout } = await hook("stop")
      return stdout === "" ? null : JSON.parse(stdout)
    }

    const unattended = await run({ ...testEnv, RULECAST_MODE: "unattended" })
    expect(kindOf(unattended)).toBe("block")
    expect(unattended.reason).toContain("error tests/keep-assertions")
    expect(unattended.reason).toContain("removes assertions (1 of 2 removed)")

    expect(kindOf(await run(testEnv))).not.toBe("block")
  })
})
