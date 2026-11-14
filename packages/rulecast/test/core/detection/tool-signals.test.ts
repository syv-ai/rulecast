import { spawn as realSpawn, spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, vi } from "vitest"

import { createProject } from "../../helpers/project"

/** Forwarders installed when spawn() is called, signal by signal. */
const atSpawn: Record<string, number>[] = []

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      atSpawn.push(
        Object.fromEntries(["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, process.listenerCount(name)])),
      )
      return actual.spawn(...args)
    },
  }
})

const { runTool } = await import("../../../src/core/detection/tool")

test("the signal forwarders are in place before the tool is spawned (#83)", async () => {
  // A signal between spawn() and the forwarders' install took the default action: rulecast died and
  // the tool's group, detached, lived on.
  const before = Object.fromEntries(["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, process.listenerCount(name)]))
  atSpawn.length = 0
  const dir = await createProject({})
  await runTool("/bin/sh", ["-c", "exit 0"], { cwd: dir, signal: new AbortController().signal, notFound: "x" })
  expect(atSpawn).toHaveLength(1)
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) expect(atSpawn[0]![name]).toBe(before[name]! + 1)
  // Removed again once nothing runs.
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) expect(process.listenerCount(name)).toBe(before[name])
})

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Processes whose command line holds `marker`. */
const running = (marker: string) =>
  spawnSync("pgrep", ["-f", marker], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)

test("a signal the moment a tool starts ends it with rulecast, every time (#83)", async () => {
  const dir = await createProject({})
  const tool = fileURLToPath(new URL("../../../src/core/detection/tool.ts", import.meta.url))
  const loader = new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url).href
  for (let round = 0; round < 5; round++) {
    // A sleep no other process runs, so pgrep finds this round's tool and nothing else.
    const marker = `${30 + round}.${process.pid}${Date.now() % 100_000}`
    const script = path.join(dir, `run-${round}.mts`)
    await writeFile(
      script,
      `import { runTool } from ${JSON.stringify(tool)}\n` +
        `void runTool("/bin/sh", ["-c", ${JSON.stringify(`trap '' TERM; sleep ${marker}; true`)}], ` +
        `{ cwd: ${JSON.stringify(dir)}, signal: new AbortController().signal, notFound: "x" }).catch(() => {})\n` +
        `process.kill(process.pid, "SIGTERM")\n`,
    )
    const rulecast = realSpawn(process.execPath, ["--import", loader, script], { stdio: "ignore" })
    await new Promise((resolve) => rulecast.once("exit", resolve))
    try {
      for (let waited = 0; running(`sleep ${marker}`).length > 0 && waited < 2000; waited += 50) await settle(50)
      expect(running(`sleep ${marker}`)).toEqual([])
    } finally {
      for (const pid of running(`sleep ${marker}`)) process.kill(Number(pid), "SIGKILL")
    }
  }
}, 60_000)
