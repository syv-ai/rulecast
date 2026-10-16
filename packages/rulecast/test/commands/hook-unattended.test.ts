import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { Env } from "../../src/core/home"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { stateDirFor, testEnv } from "../helpers/home"
import { claudeCodePayload, type Payload } from "../helpers/payloads"
import { pipelineAt } from "../helpers/pipeline"

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
  /** `rulecast run --session s1` as the agent runs it from its shell: the findings' lines, by rule. */
  const runSession = async (runEnv: Env = testEnv) => {
    const { stdout } = await runCli(root, ["run", "--session", "s1", "--format", "json"], "", runEnv)
    const { findings, ignored } = JSON.parse(stdout)
    const line = (finding: { rule: string; line: number }) => `${finding.rule}:${finding.line}`
    return [
      ...findings.map(line),
      ...ignored.map((finding: { rule: string; line: number }) => `ignored ${line(finding)}`),
    ]
  }
  return { root, edit, stop, runSession }
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

  test("a refuse_write finding in a file changed with the shell blocks until reverted, past the repeat limit", async () => {
    const rules = fixtureRules.map((rule) =>
      rule.id === "frontend/no-generated-edits" ? { ...rule, refuse_write: true } : rule,
    )
    const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(rules) })
    const hook = (name: string) =>
      runCli(root, ["hook", "claude-code"], JSON.stringify(claudeCodePayload(name, { root, sessionId: "s1" })), {
        ...testEnv,
        RULECAST_MODE: "unattended",
      })
    await hook("pre-tool-use.bash")
    await writeFile(path.join(root, CLIENT), "export const api = 2\n")
    await hook("post-tool-use.bash")
    const kinds = []
    for (let n = 0; n < 4; n++) {
      const { stdout } = await hook(n === 0 ? "stop" : "stop.after-block")
      kinds.push(kindOf(stdout === "" ? null : JSON.parse(stdout)))
    }
    expect(kinds).toEqual(["block", "block", "block", "block"])
  })

  test("an unknown RULECAST_MODE is attended, and the debug log says why", async () => {
    const { root, edit, stop } = await session({}, { ...testEnv, RULECAST_MODE: "headless" })
    await edit(USERS, violation(500))
    expect((await stop()).reason).toContain("say so to the user")
    expect(await readFile(path.join(stateDirFor(root), "debug.log"), "utf8")).toContain(
      "RULECAST_MODE=headless is ignored",
    )
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

describe("hook claude-code: rulecast-ignore in unattended mode", () => {
  const UNATTENDED_ENV = { ...testEnv, RULECAST_MODE: "unattended" }
  const IGNORED = "    raise HTTPException(500)  # rulecast-ignore: backend/no-httpexception the caller expects it\n"
  const ADDED_NOTICE = "the agent added a rulecast-ignore comment this session"

  /** A repo whose no-httpexception rule refuses writes unattended, and a pre-tool-use call against it. */
  const guarded = async (files: Record<string, string>) => {
    const rules = fixtureRules.map((rule) =>
      rule.id === "backend/no-httpexception" ? { ...rule, refuse_write: "unattended" } : rule,
    )
    const root = await createRepo({ ...fixtureFiles, ...files, ".rulecast-config.yaml": localConfig(rules) })
    const pre = async (input: Record<string, string>, name = "pre-tool-use.edit") => {
      const payload = claudeCodePayload(name, { root, file: USERS, sessionId: "s1" })
      payload.tool_input = { ...payload.tool_input, ...input } as Payload["tool_input"]
      const { stdout } = await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), UNATTENDED_ENV)
      return stdout === "" ? null : (JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? null)
    }
    return { root, pre }
  }

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

  test("an agent edit to the code under an ignore already in the code is reported: the ignore does not cover it", async () => {
    // Intended (D49): the comment was agreed to for the code it covered then, not for what the agent
    // writes under it. The finding blocks up to the repeat limit, then goes into the report.
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const committed = `def get():\n${above}    raise HTTPException(500)\n`
    const { edit, stop } = await session({}, UNATTENDED_ENV, { [USERS]: committed })
    expect(await edit(USERS, `def get():\n${above}    raise HTTPException(501)\n`)).toContain("HTTPException(501)")
    const outputs = []
    for (let n = 0; n < 4; n++) outputs.push(await stop())
    expect(outputs.map(kindOf)).toEqual(["block", "block", "report", "systemMessage"])
  })

  test("new code inserted under an ignore already in the code is not silenced unattended", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const committed = `def get():\n${above}    return None\n`
    const { edit, stop } = await session({}, UNATTENDED_ENV, { [USERS]: committed })
    expect(await edit(USERS, `def get():\n${above}    raise HTTPException(500)\n    return None\n`)).toContain(
      "raises HTTPException(500)",
    )
    expect(kindOf(await stop())).toBe("block")
  })

  test("attended, new code inserted under an ignore already in the code is silenced, and the user is told", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const committed = `def get():\n${above}    return None\n`
    const { edit, stop } = await session({}, testEnv, { [USERS]: committed })
    expect(await edit(USERS, `def get():\n${above}    raise HTTPException(500)\n    return None\n`)).not.toContain(
      "raises HTTPException(500)",
    )
    expect(await stop()).toEqual({ systemMessage: expect.stringContaining(ADDED_NOTICE) })
  })

  test("an ignore added above code the run did not touch is judged by that code: it holds, as attended", async () => {
    // D49 judges by the finding's line. The code was there before the run and is unchanged, so the
    // finding was the backlog's, never blocking; the ignore silences it as it would on main.
    const committed = "def get():\n    raise HTTPException(500)\n"
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const { edit, stop } = await session({}, UNATTENDED_ENV, { [USERS]: committed })
    await edit(USERS, `def get():\n${above}    raise HTTPException(500)\n`)
    expect(await stop()).toBeNull()
  })

  test("the guard does not honour an ignore the proposed write adds", async () => {
    const rules = fixtureRules.map((rule) =>
      rule.id === "backend/no-httpexception" ? { ...rule, refuse_write: "unattended" } : rule,
    )
    const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(rules) })
    const write = async (content: string) => {
      const payload = claudeCodePayload("pre-tool-use.write", { root, file: USERS, sessionId: "s1" })
      ;(payload.tool_input as { content: string }).content = content
      const { stdout } = await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), UNATTENDED_ENV)
      return stdout === "" ? null : JSON.parse(stdout).hookSpecificOutput?.permissionDecision
    }
    expect(await write(`def get():\n${IGNORED}`)).toBe("deny")
  })

  test("the guard refuses an edit to the code under an ignore already in the file", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const { pre } = await guarded({ [USERS]: `def get():\n${above}    raise HTTPException(500)\n` })
    expect(await pre({ old_string: "raise HTTPException(500)", new_string: "raise HTTPException(501)" })).toBe("deny")
  })

  test("the guard refuses a violation written under an ignore an earlier edit added", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const { root, pre } = await guarded({ [USERS]: "def get():\n    return None\n" })
    // Edit 1 adds only the comment: nothing to refuse.
    const first = { old_string: "def get():\n", new_string: `def get():\n${above}` }
    expect(await pre(first)).toBeNull()
    await writeFile(path.join(root, USERS), `def get():\n${above}    return None\n`)
    // Edit 2 writes the violation under it.
    const second = { old_string: "    return None\n", new_string: "    raise HTTPException(500)\n    return None\n" }
    expect(await pre(second)).toBe("deny")
  })

  test("the guard allows a Write that restates a file whose agreed ignore covers untouched code", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const committed = `def get():\n${above}    raise HTTPException(500)\n`
    const { pre } = await guarded({ [USERS]: committed })
    expect(await pre({ content: `${committed}\n\ndef put():\n    return None\n` }, "pre-tool-use.write")).toBeNull()
  })

  test("the guard allows an Edit that carries an agreed ignore and its code as context", async () => {
    const above = "    # rulecast-ignore: backend/no-httpexception the caller expects it\n"
    const { pre } = await guarded({ [USERS]: `def get():\n${above}    raise HTTPException(500)\n` })
    const context = `${above}    raise HTTPException(500)\n`
    expect(await pre({ old_string: context, new_string: `${context}    return None\n` })).toBeNull()
  })

  test("attended, an added ignore silences its finding as before, and the user is told", async () => {
    const { edit, stop } = await session()
    expect(await edit(USERS, `def get():\n    raise HTTPException(404)\n${IGNORED}`)).not.toContain(
      "raises HTTPException(500)",
    )
    expect(await stop()).toEqual({ systemMessage: expect.stringContaining(ADDED_NOTICE) })
  })

  describe("rulecast run --session judges in the mode the session ran in", () => {
    const added = `def get():\n    raise HTTPException(404)\n${IGNORED}`

    test("unattended: the finding the stop blocks on is listed, whatever the shell's environment", async () => {
      const { edit, stop, runSession } = await session({}, UNATTENDED_ENV)
      await edit(USERS, added)
      expect(kindOf(await stop())).toBe("block")
      // The overflow message sends the agent here "for the full list": it must hold what blocked.
      expect(await runSession()).toEqual(["backend/no-httpexception:3"])
    })

    test("attended: the added ignore silences the finding here too", async () => {
      const { edit, stop, runSession } = await session()
      await edit(USERS, added)
      expect(kindOf(await stop())).toBe("systemMessage")
      expect(await runSession()).toEqual(["ignored backend/no-httpexception:3"])
      // A shell that says unattended does not change what an attended session was judged by.
      expect(await runSession(UNATTENDED_ENV)).toEqual(["ignored backend/no-httpexception:3"])
    })

    test("a session recorded before the mode was: resolved from the environment", async () => {
      const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(fixtureRules) })
      await writeFile(path.join(root, USERS), added)
      await pipelineAt(root, { kind: "edit", files: [USERS], cwd: root, session: { id: "s1" } })
      const listed = async (env: Env) => {
        const { stdout } = await runCli(root, ["run", "--session", "s1", "--format", "json"], "", env)
        return JSON.parse(stdout).findings.map((finding: { line: number }) => finding.line)
      }
      expect(await listed(UNATTENDED_ENV)).toContain(3)
      expect(await listed(testEnv)).not.toContain(3)
    })
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
    message: "{{file}}:{{line}} removes assertions ({{removed}} of {{baseline}} removed). Make the test pass instead.",
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

  test("one more assert deleted at each stop is the same finding: block, block, then report; the message counts", async () => {
    const asserts = ["total([1, 2]) == 3", "total([]) == 0", "total([5]) == 5", "total([1]) == 1"]
    const content = (kept: number) =>
      `def test_total():\n${asserts
        .slice(0, kept)
        .map((a) => `    assert ${a}\n`)
        .join("")}`
    const error = {
      ...rule,
      severity: "error",
      message:
        "{{file}}:{{line}} removes assertions ({{removed}} of {{baseline}} removed). Make the test pass instead.",
    }
    const root = await createRepo({ [TEST]: content(4), ".rulecast-config.yaml": localConfig([error]) })
    const env = { ...testEnv, RULECAST_MODE: "unattended" }
    const hook = (name: string, file?: string) =>
      runCli(
        root,
        ["hook", "claude-code"],
        JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })),
        env,
      )
    const seen: { kind: string; reason: string }[] = []
    for (const [index, kept] of [3, 2, 1].entries()) {
      await writeFile(path.join(root, TEST), content(kept))
      await hook("post-tool-use.edit", TEST)
      const { stdout } = await hook(index === 0 ? "stop" : "stop.after-block")
      const output = stdout === "" ? null : JSON.parse(stdout)
      seen.push({ kind: kindOf(output), reason: output?.reason ?? "" })
    }
    expect(seen.map(({ kind }) => kind)).toEqual(["block", "block", "report"])
    expect(seen[0]!.reason).toContain("removes assertions (1 of 4 removed)")
    expect(seen[1]!.reason).toContain("removes assertions (2 of 4 removed)")
    expect(seen[2]!.reason).toContain("removes assertions (3 of 4 removed)")
  })
})
