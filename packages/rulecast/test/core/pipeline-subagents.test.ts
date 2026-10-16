import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { openSession, sessionDir } from "../../src/core/session/session"
import type { Event } from "../../src/core/types"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"
// Not in the fixture's commit: a file the subagent creates.
const ORDERS = "app/services/orders.py"

async function scenario() {
  const root = await createFixture()
  const send = async (event: Omit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    return (await pipelineAt(root, { ...rest, cwd: root, session: { id: "s1", agentId } }, { stopGate: true })).delivery
  }
  /** One edit tool call: the write, then its PostToolUse. */
  const edit = async (file: string, content: string, agentId?: string) => {
    await writeFile(path.join(root, file), content)
    return send({ kind: "edit", files: [file], agentId })
  }
  const stop = (agentId?: string) => send({ kind: "verify", files: [], agentId })
  const work = async () => (await openSession(sessionDir(stateDirFor(root), "s1"), "main")).work
  let calls = 0
  /** One shell call: its before hook, what the command does, its after hook. */
  const shell = async (act: () => Promise<unknown>, agentId?: string) => {
    const toolUseId = `toolu_${++calls}`
    await send({ kind: "shell-before", files: [], toolUseId, agentId })
    await act()
    return send({ kind: "shell-after", files: [], toolUseId, agentId })
  }
  return { send, edit, stop, work, shell, root }
}

const violation = (file: string) => `${fixtureFiles[file] ?? "def get():\n"}    raise HTTPException(500)\n`
const files = (delivery: { findings: { file: string }[] }) => [
  ...new Set(delivery.findings.map((finding) => finding.file)),
]

describe("a subagent's stop verifies its own edits", () => {
  test("two concurrent subagents are each blocked only for their own file; the main stop for both", async () => {
    const { send, edit, stop } = await scenario()
    await send({ kind: "start", files: [] })
    await Promise.all([edit(USERS, violation(USERS), "sub1"), edit(ORDERS, violation(ORDERS), "sub2")])

    const [first, second] = await Promise.all([stop("sub1"), stop("sub2")])
    expect(first.stop).toBe("block")
    expect(files(first)).toEqual([USERS])
    expect(second.stop).toBe("block")
    expect(files(second)).toEqual([ORDERS])

    // The main agent owns integration: everything any agent changed this session.
    const main = await stop()
    expect(main.stop).toBe("block")
    expect(files(main).sort()).toEqual([ORDERS, USERS])
  })

  test("a subagent that only read files stops, with a sibling's violation in the session", async () => {
    const { send, edit, stop } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "touch", files: [USERS], completeRead: true, agentId: "reader" })
    await edit(USERS, violation(USERS), "sub1")
    const reader = await stop("reader")
    expect(reader.stop).toBe("allow")
    expect(reader.findings).toEqual([])
  })

  test("a sibling's edits are not swept at a subagent's stop", async () => {
    const { send, edit, stop, work } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS), "sub1")
    const other = await stop("sub2")
    expect(other.stop).toBe("allow")
    expect(other.swept).toBeUndefined()
    expect((await work()).swept).toEqual([])
  })

  test("a file both subagents edited can block either of them", async () => {
    const { send, edit, stop } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS), "sub1")
    // sub2's change is clean, but the file is now also its own: ownership is per file, not per line.
    await edit(USERS, `${violation(USERS)}    return None\n`, "sub2")
    expect((await stop("sub1")).stop).toBe("block")
    expect((await stop("sub2")).stop).toBe("block")
  })

  test("the main agent's own edit blocks its stop, never a subagent's", async () => {
    const { send, edit, stop } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS))
    expect((await stop("sub1")).stop).toBe("allow")
    expect((await stop()).stop).toBe("block")
  })
})

describe("agents acting at the same moment", () => {
  test("a subagent that never used the shell sweeps nothing: a sibling's command may still be writing", async () => {
    const { send, stop, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await writeFile(path.join(root, USERS), violation(USERS))
    const other = await stop("sub2")
    expect(other.swept).toBeUndefined()
    expect(other.findings).toEqual([])
  })

  test("a subagent's first shell call sweeps nothing: the session's latest state may be a sibling's", async () => {
    const { send, shell, work, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await writeFile(path.join(root, USERS), violation(USERS))
    await shell(async () => {}, "sub2")
    expect((await work()).swept).toEqual([])
  })

  test("a subagent's stop shows what it swept, not what another agent swept; the main stop shows both", async () => {
    const { send, stop, shell, root } = await scenario()
    await send({ kind: "start", files: [] })
    await shell(async () => {}, "sub1")
    // The user's own edit, between sub1's calls: sub1's next before hook sweeps it.
    await writeFile(path.join(root, USERS), violation(USERS))
    await shell(async () => {}, "sub1")
    await shell(async () => {}, "sub2")
    expect((await stop("sub2")).swept).toBeUndefined()
    expect((await stop("sub1")).swept).toEqual([USERS])
    expect((await stop()).swept).toEqual([USERS])
  })
})

describe("agents sharing a working tree", () => {
  const told = (delivery: { agentNotices?: string[] }) =>
    (delivery.agentNotices ?? []).filter((text) => text.includes("worktree"))

  test("overlapping shell calls that changed no files: no notice, and none used up", async () => {
    // Claude Code keys hooks on the session's project directory: an agent's command that ran in
    // another directory still records states for this tree. Nothing changed here, nothing to misattribute.
    const { send, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await send({ kind: "shell-before", files: [], toolUseId: "b", agentId: "sub2" })
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "b", agentId: "sub2" }))).toEqual([])
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "a", agentId: "sub1" }))).toEqual([])

    // The once-per-session notice is still there for a call whose files could be another agent's.
    await send({ kind: "shell-before", files: [], toolUseId: "c", agentId: "sub1" })
    await send({ kind: "shell-before", files: [], toolUseId: "d", agentId: "sub2" })
    await writeFile(path.join(root, USERS), violation(USERS))
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "d", agentId: "sub2" }))).toHaveLength(1)
  })

  test("overlapping shell calls of two agents that changed files: each is told once that attribution may be wrong", async () => {
    const { send, shell, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await send({ kind: "shell-before", files: [], toolUseId: "b", agentId: "sub2" })
    await writeFile(path.join(root, USERS), violation(USERS))
    const second = await send({ kind: "shell-after", files: [], toolUseId: "b", agentId: "sub2" })
    expect(told(second)).toHaveLength(1)
    expect(told(second)[0]).toContain("isolation: worktree")
    // sub1's call overlapped sub2's too, though sub2's has ended by now.
    const first = await send({ kind: "shell-after", files: [], toolUseId: "a", agentId: "sub1" })
    expect(told(first)).toHaveLength(1)

    // Once per session: overlapping again, with files changed, says nothing new.
    await send({ kind: "shell-before", files: [], toolUseId: "c", agentId: "sub1" })
    const again = await send({ kind: "shell-before", files: [], toolUseId: "d", agentId: "sub2" })
    expect(told(again)).toEqual([])
    await writeFile(path.join(root, ORDERS), violation(ORDERS))
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "d", agentId: "sub2" }))).toEqual([])
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "c", agentId: "sub1" }))).toEqual([])
    expect(told(await shell(async () => {}, "sub1"))).toEqual([])
  })

  test("the notice rides along with the call's findings", async () => {
    const { send, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await send({ kind: "shell-before", files: [], toolUseId: "b", agentId: "sub2" })
    await writeFile(path.join(root, USERS), violation(USERS))
    const second = await send({ kind: "shell-after", files: [], toolUseId: "b", agentId: "sub2" })
    expect(files(second)).toEqual([USERS])
    expect(told(second)).toHaveLength(1)
  })

  test("shell calls of two agents one after the other: no notice", async () => {
    const { send, shell } = await scenario()
    await send({ kind: "start", files: [] })
    expect(told(await shell(async () => {}, "sub1"))).toEqual([])
    expect(told(await shell(async () => {}, "sub2"))).toEqual([])
    expect(told(await shell(async () => {}))).toEqual([])
  })

  test("one agent's own overlapping shell calls: no notice", async () => {
    const { send } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "a", agentId: "sub1" })
    await send({ kind: "shell-before", files: [], toolUseId: "b", agentId: "sub1" })
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "b", agentId: "sub1" }))).toEqual([])
    expect(told(await send({ kind: "shell-after", files: [], toolUseId: "a", agentId: "sub1" }))).toEqual([])
  })

  test("without tool use ids, an agent's calls are matched in order", async () => {
    const { send, root } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], agentId: "sub1" })
    await send({ kind: "shell-after", files: [], agentId: "sub1" })
    await send({ kind: "shell-before", files: [], agentId: "sub2" })
    expect(told(await send({ kind: "shell-after", files: [], agentId: "sub2" }))).toEqual([])
    await send({ kind: "shell-before", files: [], agentId: "sub1" })
    await send({ kind: "shell-before", files: [], agentId: "sub2" })
    await writeFile(path.join(root, USERS), violation(USERS))
    expect(told(await send({ kind: "shell-after", files: [], agentId: "sub2" }))).toHaveLength(1)
  })

  test("a call whose after never came is closed by its agent's next prompt", async () => {
    const { send, shell } = await scenario()
    await send({ kind: "start", files: [] })
    // Interrupted: its PostToolUse never fires.
    await send({ kind: "shell-before", files: [], toolUseId: "a" })
    await send({ kind: "prompt", files: [] })
    expect(told(await shell(async () => {}, "sub1"))).toEqual([])
  })
})
