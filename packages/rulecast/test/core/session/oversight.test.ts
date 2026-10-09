import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { notices } from "../../../src/core/session/oversight"
import type { Event, Match } from "../../../src/core/types"
import { createFixture } from "../../helpers/fixture"
import { pipelineAt } from "../../helpers/pipeline"

const at = (file: string, line: number): Match => ({ file, line, endLine: line, column: 1, text: "", captures: {} })

describe("notices", () => {
  test("a config that changed since the session started is told, once per change", () => {
    const told = notices({ startConfigHash: "a", currentConfigHash: "b", ignored: [], told: new Set() })
    expect(told.map((notice) => notice.text)).toEqual([
      "rulecast: .rulecast-config.yaml changed during this session; findings may have been silenced. Review: git diff .rulecast-config.yaml",
    ])
    expect(
      notices({ startConfigHash: "a", currentConfigHash: "b", ignored: [], told: new Set([told[0]!.key]) }),
    ).toEqual([])
    // A further change is a new change.
    expect(
      notices({ startConfigHash: "a", currentConfigHash: "c", ignored: [], told: new Set([told[0]!.key]) }),
    ).toHaveLength(1)
  })

  test("an unchanged config, or a store older than the check, says nothing", () => {
    expect(notices({ startConfigHash: "a", currentConfigHash: "a", ignored: [], told: new Set() })).toEqual([])
    expect(notices({ startConfigHash: null, currentConfigHash: "b", ignored: [], told: new Set() })).toEqual([])
  })

  test("ignores on lines changed this session are told; ones already there are not", () => {
    const told = notices({
      startConfigHash: "a",
      currentConfigHash: "a",
      ignored: [
        { rule: "py/x", match: at("a.py", 4), reason: "debug only", status: "new" },
        { rule: "py/x", match: at("b.py", 9), reason: "old", status: "preexisting" },
      ],
      told: new Set(),
    })
    expect(told.map((notice) => notice.text)).toEqual([
      'rulecast: the agent added a rulecast-ignore comment this session: a.py:4 (py/x: "debug only")',
    ])
  })
})

/** The DX review's G1 session: the agent edits the config past the Stop gate. */
describe("oversight in a session", () => {
  const USERS = "app/services/users.py"

  test("a config edit that silences a finding passes the gate, and the user is told", async () => {
    const root = await createFixture()
    const session = { id: "g1" }
    const send = (event: Omit<Event, "cwd">, stopGate = false) =>
      pipelineAt(root, { ...event, cwd: root }, { stopGate })

    await send({ kind: "touch", files: [USERS], session, completeRead: true })
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS], session })
    const blocked = await send({ kind: "verify", files: [], session }, true)
    expect(blocked.delivery.stop).toBe("block")
    expect(blocked.delivery.notices).toBeUndefined()

    await send({ kind: "prompt", files: [], session })
    const config = path.join(root, ".rulecast-config.yaml")
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace("files: ^app/services/.*\\.py$", "files: ^nowhere/"),
    )
    const passed = await send({ kind: "verify", files: [], session }, true)
    expect(passed.delivery.stop).toBe("allow")
    expect(passed.delivery.notices).toEqual([
      "rulecast: .rulecast-config.yaml changed during this session; findings may have been silenced. Review: git diff .rulecast-config.yaml",
    ])
    // Told once, not at every Stop after it.
    const again = await send({ kind: "verify", files: [], session }, true)
    expect(again.delivery.notices).toBeUndefined()
  })

  test("an ignore the agent adds is told at the Stop", async () => {
    const root = await createFixture()
    const session = { id: "ign" }
    const send = (event: Omit<Event, "cwd">, stopGate = false) =>
      pipelineAt(root, { ...event, cwd: root }, { stopGate })
    await send({ kind: "touch", files: [USERS], session, completeRead: true })
    await writeFile(
      path.join(root, USERS),
      "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)  # rulecast-ignore: backend/no-httpexception the caller maps it\n",
    )
    await send({ kind: "edit", files: [USERS], session })
    const stop = await send({ kind: "verify", files: [], session }, true)
    expect(stop.delivery.stop).toBe("allow")
    expect(stop.delivery.notices).toEqual([
      `rulecast: the agent added a rulecast-ignore comment this session: ${USERS}:3 (backend/no-httpexception: "the caller maps it")`,
    ])
  })
})
