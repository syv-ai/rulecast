import { existsSync } from "node:fs"
import { mkdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { LockTimeoutError, withLock, withLockAt } from "../../../src/core/session/lock"
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

  test("a holder that works longer than staleMs keeps its lock: nobody else enters meanwhile (plan 21)", async () => {
    // The lock's mtime was never refreshed, so a slow holder's lock looked stale and was taken
    // over, and that holder's release then removed the next owner's lock: three were inside at once.
    const lock = path.join(await createProject({}), "lock")
    let inside = 0
    let most = 0
    const holder = (ms: number) =>
      withLockAt(
        lock,
        async () => {
          most = Math.max(most, ++inside)
          await new Promise((resolve) => setTimeout(resolve, ms))
          inside--
        },
        { waitMs: 5000, staleMs: 100, retryMs: 5 },
      )
    await Promise.all([holder(300), holder(300), holder(100)])
    expect(most).toBe(1)
  })

  test("a holder whose lock was taken over leaves the new owner's lock in place on release", async () => {
    const lock = path.join(await createProject({}), "lock")
    await withLockAt(lock, async () => {
      // Another process judged this lock stale and took it over while this holder was stalled.
      await rm(lock, { recursive: true, force: true })
      await mkdir(lock)
    })
    expect(existsSync(lock)).toBe(true)
  })

  test("times out on a fresh lock held too long", async () => {
    const dir = path.join(await createProject({}), "session")
    await mkdir(path.join(dir, ".lock"), { recursive: true })
    await expect(withLock(dir, async () => "never", { waitMs: 50, staleMs: 5000, retryMs: 5 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    )
  })
})
