import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { onPath } from "../../src/core/which"

describe("onPath", () => {
  test("finds a command every POSIX machine has", async () => {
    expect(await onPath("sh")).toBe(true)
  })

  test("does not find a command that does not exist", async () => {
    expect(await onPath("definitely-not-a-real-binary-9x7")).toBe(false)
  })

  test("an aborted signal gives up instead of waiting for the shell", async () => {
    // Without this, doctor's 30 s deadline is decorative: a PATH entry on a stalled network mount
    // makes `command -v` block and checkDetectors never settles.
    expect(await onPath("sh", AbortSignal.abort())).toBe(false)
  })

  test("treats its argument as an argument, not as shell text", async () => {
    // execFile's own `shell` option would join file and arguments into one command line, so a name
    // carrying a metacharacter would *run*. doctor asks this about a command rule's argv[0], which
    // comes from a config a rule repo may have written.
    const marker = path.join(await mkdtemp(path.join(tmpdir(), "rulecast-which-")), "pwned")
    expect(await onPath(`sh; touch ${marker}`)).toBe(false)
    expect(existsSync(marker), "the second half of the name must not have run").toBe(false)
  })
})
