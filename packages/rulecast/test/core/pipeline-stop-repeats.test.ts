import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../src/core/delivery/render-agent"
import type { DistributiveOmit, Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

// A Stop says each finding once (decided with the AKA and Conductor leads, 2026-11-14): what an
// earlier stop already sent the agent is one line, not a block, while it stays and its file does not
// change. A stale or accepted finding must not cost a turn at every prompt.

const USERS = "app/services/users.py"
const API = "src/client/api.ts"
const VIOLATION = `${fixtureFiles[USERS]}    raise HTTPException(500)\n`

async function scenario(env?: Record<string, string>, at?: string) {
  const root = at ?? (await createFixture())
  const send = async (event: DistributiveOmit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const session = { id: "s1", agentId }
    return (
      await pipelineAt(root, { ...rest, cwd: root, session }, { stopGate: true, ...(env === undefined ? {} : { env }) })
    ).delivery
  }
  const write = (file: string, content: string) => writeFile(path.join(root, file), content)
  /** A stop in a prompt of its own: attended allows one block per prompt (stop_gate.max_blocks). */
  const stop = async (agentId?: string) => {
    await send({ kind: "prompt", files: [], agentId })
    return send({ kind: "verify", files: [], agentId })
  }
  return { root, send, write, stop }
}

const findingLines = (delivery: { findings: { file: string; line: number }[] }) =>
  delivery.findings.map((finding) => `${finding.file}:${finding.line}`)

describe("a Stop sends each finding once", () => {
  test("an unchanged finding sent at an earlier stop is a repeat: listed, not blocking, in any prompt", async () => {
    const { send, write, stop } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })

    const first = await stop()
    expect(first.stop).toBe("block")
    expect(findingLines(first)).toEqual([`${USERS}:3`])

    const second = await stop()
    expect(second.stop).toBe("allow")
    expect(second.findings).toEqual([])
    expect(second.repeated).toEqual([{ rule: "backend/no-httpexception", file: USERS }])

    // Within one prompt too: past the cap the stop is allowed, not capReached.
    const sameprompt = await send({ kind: "verify", files: [] })
    expect(sameprompt.stop).toBe("allow")
    expect(sameprompt.repeated).toEqual([{ rule: "backend/no-httpexception", file: USERS }])
  })

  test("a block sends only what is new; earlier findings, warnings too, ride as one line", async () => {
    const { send, write, stop } = await scenario()
    await write(API, "export const api = 2\n")
    await send({ kind: "edit", files: [API] })
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    const first = await stop()
    expect(first.stop).toBe("block")
    expect(first.findings.map((finding) => finding.rule).sort()).toEqual([
      "backend/no-httpexception",
      "frontend/no-generated-edits",
    ])

    const orders = "app/services/orders.py"
    await write(orders, "def get():\n    raise HTTPException(400)\n")
    await send({ kind: "edit", files: [orders] })
    const second = await stop()
    expect(second.stop).toBe("block")
    expect(findingLines(second)).toEqual([`${orders}:2`])
    expect(second.repeated).toEqual([
      { rule: "backend/no-httpexception", file: USERS },
      { rule: "frontend/no-generated-edits", file: API },
    ])
    const text = renderAgentText(second, { maxMatchesPerRule: 10 })
    expect(text).toContain(
      `Still there from earlier stops, not repeated here: backend/no-httpexception (${USERS}), frontend/no-generated-edits (${API}).`,
    )
    expect(text).not.toContain("is generated. Regenerate it")
  })

  test("a warning alone never blocks, so it is not sent, and stays new until a block sends it", async () => {
    const { send, write, stop } = await scenario()
    await write(API, "export const api = 2\n")
    await send({ kind: "edit", files: [API] })
    expect((await stop()).stop).toBe("allow")

    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    const block = await stop()
    expect(block.stop).toBe("block")
    expect(block.findings.map((finding) => finding.rule).sort()).toEqual([
      "backend/no-httpexception",
      "frontend/no-generated-edits",
    ])
  })

  test("the finding's file changed and the finding is still there: sent as new once more (AKA)", async () => {
    const { send, write, stop } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    expect((await stop()).stop).toBe("block")

    // An edit that should have fixed it, and did not.
    await write(USERS, `# tried\n${VIOLATION}`)
    await send({ kind: "edit", files: [USERS] })
    const again = await stop()
    expect(again.stop).toBe("block")
    expect(findingLines(again)).toEqual([`${USERS}:4`])
    expect(again.repeated).toBeUndefined()

    expect((await stop()).stop).toBe("allow")
  })

  test("a finding a stop saw gone is forgotten: brought back, it blocks again (Conductor)", async () => {
    const { send, write, stop } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    expect((await stop()).stop).toBe("block")

    await write(USERS, fixtureFiles[USERS]!)
    await send({ kind: "edit", files: [USERS] })
    expect((await stop()).stop).toBe("allow")

    // The same text back, byte for byte the file it was sent in.
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    const back = await stop()
    expect(back.stop).toBe("block")
    expect(findingLines(back)).toEqual([`${USERS}:3`])
  })

  test("a file deleted after its finding was sent is forgotten with it: recreated, it blocks again", async () => {
    const { root, send, write, stop } = await scenario()
    const extra = "app/services/extra.py"
    await write(extra, VIOLATION)
    await send({ kind: "edit", files: [extra] })
    expect((await stop()).stop).toBe("block")
    await rm(path.join(root, extra))
    expect((await stop()).stop).toBe("allow")
    await write(extra, VIOLATION)
    await send({ kind: "edit", files: [extra] })
    expect((await stop()).stop).toBe("block")
  })

  test("a stop whose rule did not run on the file forgets nothing: the finding stays a repeat", async () => {
    // Times out while `slow` exists. (A tool that fails is disabled for the session instead.)
    const flaky = {
      id: "tool/flaky",
      name: "A tool that is sometimes too slow",
      files: "\\.py$",
      detect: {
        command: {
          run: ["sh", "-c", 'if [ -e slow ]; then sleep 5; fi; for f; do echo "$f:1: error: given"; done', "sh"],
          output: { lines: "gcc-nocol" },
        },
      },
      message: "{{file}}:{{line}} {{message}}",
    }
    const root = await createRepo({
      ...fixtureFiles,
      ".rulecast-config.yaml": localConfig([...fixtureRules, flaky], { timeouts: { verify_ms: 1500 } }),
    })
    const { send, write, stop } = await scenario(undefined, root)
    const orders = "app/services/orders.py"
    await write(orders, "x = 1\n")
    await send({ kind: "edit", files: [orders] })
    expect((await stop()).findings.map((finding) => finding.rule)).toEqual(["tool/flaky"])
    await writeFile(path.join(root, "slow"), "")
    expect((await stop()).findings).toEqual([])
    await rm(path.join(root, "slow"))
    const back = await stop()
    expect(back.stop).toBe("allow")
    expect(back.repeated).toEqual([{ rule: "tool/flaky", file: orders }])
  })

  test("a finding the budget cut from the block was not sent: the next stop sends it", async () => {
    const { root, send, write } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    const stopWith = async (maxContextChars: number | null) => {
      await send({ kind: "prompt", files: [] })
      const event = { kind: "verify" as const, files: [], cwd: root, session: { id: "s1" } }
      return (await pipelineAt(root, event, { stopGate: true, maxContextChars })).delivery
    }
    const cut = await stopWith(120)
    expect(cut.stop).toBe("block")
    expect(cut.findings).toEqual([])
    const next = await stopWith(null)
    expect(next.stop).toBe("block")
    expect(findingLines(next)).toEqual([`${USERS}:3`])
  })

  test("past its share of the budget the repeats line counts findings, not rule and file pairs", async () => {
    const { root, send, write } = await scenario()
    // Three findings of one rule in one file: one rule and file pair.
    await write(USERS, `${VIOLATION}    raise HTTPException(501)\n    raise HTTPException(502)\n`)
    await send({ kind: "edit", files: [USERS] })
    const stopWith = async (maxContextChars: number | null) => {
      await send({ kind: "prompt", files: [] })
      const event = { kind: "verify" as const, files: [], cwd: root, session: { id: "s1" } }
      return (await pipelineAt(root, event, { stopGate: true, maxContextChars })).delivery
    }
    expect((await stopWith(null)).stop).toBe("block")
    // Too little room to name the pair.
    const tight = await stopWith(300)
    expect(tight.repeated).toBeUndefined()
    expect(tight.repeatedMore).toBe(3)
    expect(renderAgentText({ ...tight, findings: [] }, { maxMatchesPerRule: 10 })).toBe("")
  })

  test("each agent is sent its own: the main agent's stop still sends what a subagent's stop sent", async () => {
    const { send, write, stop } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS], agentId: "sub1" })
    expect((await stop("sub1")).stop).toBe("block")
    expect((await stop("sub1")).stop).toBe("allow")
    expect((await stop()).stop).toBe("block")
  })

  test("unattended keeps its per-finding limit: an unfixed finding blocks twice, then is reported", async () => {
    const { send, write } = await scenario({ RULECAST_MODE: "unattended" })
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    const stops = []
    for (let index = 0; index < 3; index++) stops.push((await send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "block", "report"])
  })
})
