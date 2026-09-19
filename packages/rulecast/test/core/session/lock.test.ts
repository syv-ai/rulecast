import { mkdir, utimes } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { LockTimeoutError, withLock } from "../../../src/core/session/lock"
import { createProject } from "../../helpers/project"

describe("withLock", () => {
  test("serialises concurrent critical sections", async () => {
    const dir = path.join(await createProject({}), "session")
    const events: string[] = []
    const section = (name: string) =>
      withLock(dir, async () => {
        events.push(`${name}:in`)
        await new Promise((resolve) => setTimeout(resolve, 15))
        events.push(`${name}:out`)
      })
    await Promise.all([section("a"), section("b")])
    // Either order is fine; the sections must not interleave.
    expect(events).toHaveLength(4)
    expect(events[1]).toBe(events[0]!.replace(":in", ":out"))
    expect(events[3]).toBe(events[2]!.replace(":in", ":out"))
  })

  test("releases the lock when the section throws", async () => {
    const dir = path.join(await createProject({}), "session")
    await expect(withLock(dir, async () => Promise.reject(new Error("fail")))).rejects.toThrow("fail")
    expect(await withLock(dir, async () => "again")).toBe("again")
  })

  test("takes over a stale lock", async () => {
    const dir = path.join(await createProject({}), "session")
    const lock = path.join(dir, ".lock")
    await mkdir(lock, { recursive: true })
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)
    expect(await withLock(dir, async () => "took over", { waitMs: 200, staleMs: 5000, retryMs: 5 })).toBe("took over")
  })

  test("times out on a fresh lock held too long", async () => {
    const dir = path.join(await createProject({}), "session")
    await mkdir(path.join(dir, ".lock"), { recursive: true })
    await expect(withLock(dir, async () => "never", { waitMs: 50, staleMs: 5000, retryMs: 5 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    )
  })
})
