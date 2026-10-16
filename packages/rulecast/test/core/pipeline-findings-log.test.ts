import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { FINDINGS_LOG, readFindingsLog } from "../../src/core/stats/log"
import type { Event } from "../../src/core/types"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

/**
 * The findings log the hooks write and `rulecast stats` reads (core/stats/log.ts): what an agent's
 * own events put in it, what they leave out, and that no code ever reaches it.
 */
const USERS = "app/services/users.py"
const API = "src/client/api.ts"
const VIOLATION = `${fixtureFiles[USERS]}    raise HTTPException(500)\n`

type Send = Omit<Event, "cwd" | "session"> & { agentId?: string }

function sessionAt(root: string, id = "s1", env?: Record<string, string>) {
  const send = async (event: Send) => {
    const { agentId, ...rest } = event
    const options = { stopGate: true, ...(env === undefined ? {} : { env }) }
    return (await pipelineAt(root, { ...rest, cwd: root, session: { id, agentId } }, options)).delivery
  }
  return {
    send,
    write: (file: string, content: string) => writeFile(path.join(root, file), content),
    log: async () => (await readFindingsLog(stateDirFor(root))).records,
  }
}

describe("the findings log", () => {
  test("a session that breaks a rule, is blocked, and fixes it: stats counts it fired, blocked, fixed in one turn", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.write(USERS, VIOLATION)
    expect((await session.send({ kind: "edit", files: [USERS] })).findings).toHaveLength(1)
    expect((await session.send({ kind: "verify", files: [] })).stop).toBe("block")
    await session.write(USERS, fixtureFiles[USERS]!)
    await session.send({ kind: "edit", files: [USERS] })
    expect((await session.send({ kind: "verify", files: [] })).stop).toBe("allow")

    const records = await session.log()
    expect(records.map(({ ev, found }) => [ev, found.map(({ o }) => o)])).toEqual([
      ["edit", ["delivered"]],
      ["stop", ["blocked"]],
      ["edit", []],
      ["stop", []],
    ])
    // The pre-existing HTTPException(404) on line 2 is the user's, not the agent's.
    expect(records[0]!.found).toEqual([expect.objectContaining({ r: "backend/no-httpexception", f: USERS, l: 3 })])
    expect(records[2]!.ran).toEqual({ "backend/no-httpexception": [0] })
    expect(records[2]!.files).toEqual([USERS])

    const stats = await runCli(root, ["stats", "--format", "json"])
    expect(stats.code).toBe(0)
    const document = JSON.parse(stats.stdout)
    expect(document.sessions).toBe(1)
    expect(document.rules).toEqual([
      expect.objectContaining({
        rule: "backend/no-httpexception",
        fired: 1,
        blocked: 1,
        fixed: 1,
        ignored: 0,
        open: 0,
        medianTurnsToFix: 1,
      }),
    ])
    // The fixture's other detector rule; the touch rule never fires, so it is not listed.
    expect(document.neverFired).toEqual(["frontend/no-generated-edits"])
  })

  test("a finding left in place at the stop that lets the agent go is ignored", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.write(USERS, VIOLATION)
    await session.send({ kind: "edit", files: [USERS] })
    const stops = []
    for (let i = 0; i < 2; i++) stops.push((await session.send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "capReached"])
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.rules[0]).toMatchObject({ fired: 1, ignored: 1, fixed: 0, repeated: 1, medianTurnsToFix: null })
  })

  test("holds no code: neither the matched text, a capture nor the message", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    const secret = "sk_live_not_for_the_log"
    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException("${secret}")\n`)
    const edit = await session.send({ kind: "edit", files: [USERS] })
    expect(edit.findings[0]!.message).toContain(secret)
    await session.send({ kind: "verify", files: [] })

    const text = await readFile(path.join(stateDirFor(root), FINDINGS_LOG), "utf8")
    expect(text.split("\n").filter(Boolean)).toHaveLength(2)
    for (const leak of [secret, "HTTPException", "Raise a domain exception", "Services raise"]) {
      expect(text).not.toContain(leak)
    }
  })

  test("findings in files the user changed are not the agent's, and are not logged", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.send({ kind: "shell-before", files: [], toolUseId: "t1" })
    await session.send({ kind: "shell-after", files: [], toolUseId: "t1" })
    // The user's editor, after the agent's last call.
    await session.write(USERS, VIOLATION)
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.swept).toEqual([USERS])
    expect(stop.findings).toHaveLength(1)
    // The stop is recorded, as the end of a turn, with nothing it checked or found.
    expect((await session.log()).map(({ ev, files, found }) => [ev, files, found])).toEqual([["stop", [], []]])
  })

  test("a refused write is logged as refused, and a different write after it as the fix", async () => {
    const rules = [
      {
        id: "backend/no-httpexception",
        name: "Services raise domain exceptions",
        files: "^app/services/.*\\.py$",
        detect: { regex: { pattern: "raise HTTPException\\((?<args>[^)]*)\\)" } },
        refuse_write: true,
        message: "{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.",
      },
    ]
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(rules),
      [USERS]: "def get(x):\n    return x\n",
    })
    const session = sessionAt(root)
    const refusal = await session.send({
      kind: "guard",
      files: [USERS],
      intent: { edit: { find: "return x", replace: "raise HTTPException(404)", all: false } },
    })
    expect(refusal.findings).toHaveLength(1)
    await session.write(USERS, "def get(x):\n    raise NotFound()\n")
    await session.send({ kind: "edit", files: [USERS] })

    const records = await session.log()
    expect(records.map(({ ev, found, files }) => [ev, found.map(({ o }) => o), files])).toEqual([
      ["guard", ["refused"], []],
      ["edit", [], [USERS]],
    ])
    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.rules[0]).toMatchObject({ fired: 1, refused: 1, fixed: 1, medianTurnsToFix: 0 })
  })

  test("unattended: a finding past the repeat limit is delivered at a block, and a report stop is a block", async () => {
    const root = await createFixture()
    const session = sessionAt(root, "s1", { RULECAST_MODE: "unattended" })
    await session.write(USERS, VIOLATION)
    await session.send({ kind: "edit", files: [USERS] })
    const stops = []
    for (let i = 0; i < 2; i++) stops.push((await session.send({ kind: "verify", files: [] })).stop)
    // A second violation: the stop blocks on it, not on the first, which has blocked twice.
    await session.write(USERS, `${VIOLATION}    raise HTTPException(501)\n`)
    await session.send({ kind: "edit", files: [USERS] })
    for (let i = 0; i < 3; i++) stops.push((await session.send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "block", "block", "block", "report"])

    const outcomes = (await session.log())
      .filter(({ ev }) => ev === "stop")
      .map(({ found }) => Object.fromEntries(found.map(({ l, o }) => [l, o])))
    expect(outcomes).toEqual([
      { 3: "blocked" },
      { 3: "blocked" },
      { 3: "delivered", 4: "blocked" },
      { 3: "delivered", 4: "blocked" },
      { 3: "blocked", 4: "blocked" },
    ])
  })

  test("unattended: an ignore on a changed line silences nothing, and stats counts the attempt", async () => {
    const root = await createFixture()
    const session = sessionAt(root, "s1", { RULECAST_MODE: "unattended" })
    const ignore = "  # rulecast-ignore: backend/no-httpexception the caller wants it"
    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)${ignore}\n`)
    expect((await session.send({ kind: "edit", files: [USERS] })).findings).toHaveLength(1)
    const [record] = await session.log()
    expect(record!.ign).toEqual([])
    expect(record!.tried).toEqual([expect.objectContaining({ r: "backend/no-httpexception", f: USERS, l: 3 })])

    const document = JSON.parse((await runCli(root, ["stats", "--format", "json"])).stdout)
    expect(document.rules[0]).toMatchObject({ fired: 1, suppressed: 0, suppressAttempted: 1 })
  })

  test("an edit no rule checks, and a CLI run, write nothing", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.write("notes.txt", "nothing matches this\n")
    await session.send({ kind: "edit", files: ["notes.txt"] })
    expect((await runCli(root, ["run", "--all-files"])).code).toBe(1)
    expect((await runCli(root, ["run", "--files", API])).code).toBe(0)
    expect(existsSync(path.join(stateDirFor(root), FINDINGS_LOG))).toBe(false)
  })
})
