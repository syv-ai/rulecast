import path from "node:path"

import { describe, expect, test } from "vitest"

import { appendContext, appendWork, commitSession, openSession, sessionDir } from "../../../src/core/session/session"
import { emptyDelivery } from "../../../src/core/types"
import { createProject } from "../../helpers/project"

describe("session", () => {
  test("session directories live in the state directory and sanitise ids", async () => {
    expect(sessionDir("/state", "abc-123_x.y")).toBe("/state/sessions/abc-123_x.y")
    expect(sessionDir("/state", "../evil/id")).toBe("/state/sessions/.._evil_id")
  })

  test.each([".", "..", ""])("session id %j stays inside the sessions directory", (id) => {
    expect(path.dirname(sessionDir("/state", id))).toBe("/state/sessions")
  })

  test("work is shared across agents, context is per agent", async () => {
    const dir = sessionDir(await createProject({}), "s1")
    await appendWork(dir, [{ t: "edited", file: "a.ts" }])
    await appendContext(dir, "main", [{ t: "touched", rule: "r" }])
    const main = await openSession(dir, "main")
    const sub = await openSession(dir, "sub/1")
    expect(main.work.edited).toEqual(["a.ts"])
    expect(sub.work.edited).toEqual(["a.ts"])
    expect(main.context.touched).toEqual(new Set(["r"]))
    expect(sub.context.touched).toEqual(new Set())
  })

  test("commit re-reads state under the lock and appends the decision's records", async () => {
    const dir = sessionDir(await createProject({}), "s1")
    const commit = () =>
      commitSession(dir, "main", async (view) => {
        const alreadyWarned = view.context.warned.has("w")
        return {
          delivery: { ...emptyDelivery(), warnings: alreadyWarned ? [] : ["once"] },
          work: [{ t: "stopBlock", agent: "main" }],
          context: alreadyWarned ? [] : [{ t: "warned", key: "w" }],
        }
      })
    const results = await Promise.all([commit(), commit()])
    // Whichever commit takes the lock first warns; the other sees its record.
    expect(results.map((delivery) => delivery.warnings.join()).sort()).toEqual(["", "once"])
    const view = await openSession(dir, "main")
    expect(view.work.stopBlocks.get("main")).toBe(2)
  })
})
