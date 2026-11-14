import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import { runTool } from "../../../src/core/detection/tool"
import { createProject } from "../../helpers/project"

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("an abort ends every process the tool started, before the call rejects (#83)", async () => {
  const dir = await createProject({})
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 200)
  // The shell waits on a child of its own: ending the shell alone left the child to write later.
  const running = runTool("/bin/sh", ["-c", "(sleep 1; echo late > late.txt) & wait"], {
    cwd: dir,
    signal: controller.signal,
    notFound: "sh is not installed",
  })
  await expect(running).rejects.toThrow()
  await settle(1500)
  expect(existsSync(path.join(dir, "late.txt"))).toBe(false)
})

test("an aborted signal runs nothing", async () => {
  const dir = await createProject({})
  const controller = new AbortController()
  controller.abort()
  await expect(
    runTool("/bin/sh", ["-c", "echo ran > ran.txt"], { cwd: dir, signal: controller.signal, notFound: "x" }),
  ).rejects.toThrow()
  await settle(100)
  expect(existsSync(path.join(dir, "ran.txt"))).toBe(false)
})

test("an abort does not wait for a process that left the group and still holds the output (#83)", async () => {
  const dir = await createProject({})
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 300)
  const started = Date.now()
  // The shell exits at once; its child starts a session of its own, out of the group's reach, and keeps the pipe.
  const running = runTool("/bin/sh", ["-c", "perl -MPOSIX -e 'POSIX::setsid(); sleep 4' & echo started"], {
    cwd: dir,
    signal: controller.signal,
    notFound: "sh is not installed",
  })
  await expect(running).rejects.toThrow()
  expect(Date.now() - started).toBeLessThan(2000)
})

const alive = (pgid: number) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

test("a signal that ends rulecast ends its tools too, one that ignores the signal included (#83)", async () => {
  const dir = await createProject({})
  const tool = fileURLToPath(new URL("../../../src/core/detection/tool.ts", import.meta.url))
  // Node itself with tsx's loader: tsx's own CLI would sit between the signal and rulecast.
  const loader = new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url).href
  const pidFile = path.join(dir, "pid")
  const script = path.join(dir, "run.mts")
  await writeFile(
    script,
    `import { runTool } from ${JSON.stringify(tool)}\n` +
      `await runTool("/bin/sh", ["-c", ${JSON.stringify(`trap '' TERM; echo $$ > ${pidFile}; sleep 30`)}], ` +
      `{ cwd: ${JSON.stringify(dir)}, signal: new AbortController().signal, notFound: "x" })\n`,
  )
  const rulecast = spawn(process.execPath, ["--import", loader, script], { stdio: "ignore" })
  for (let waited = 0; !existsSync(pidFile) || (await readFile(pidFile, "utf8")).trim() === ""; waited += 50) {
    if (waited > 10_000) throw new Error("the tool never started")
    await settle(50)
  }
  const pgid = Number((await readFile(pidFile, "utf8")).trim())
  const ended = new Promise((resolve) => rulecast.once("exit", resolve))
  rulecast.kill("SIGTERM")
  await ended
  try {
    for (let waited = 0; alive(pgid) && waited < 2000; waited += 50) await settle(50)
    expect(alive(pgid)).toBe(false)
  } finally {
    if (alive(pgid)) process.kill(-pgid, "SIGKILL")
  }
}, 20_000)

test("env is merged over the process environment for the tool", async () => {
  const dir = await createProject({})
  const ran = await runTool("/bin/sh", ["-c", 'printf "%s|%s" "$RULECAST_TOOL_ENV" "$PATH"'], {
    cwd: dir,
    signal: new AbortController().signal,
    notFound: "sh is not installed",
    env: { RULECAST_TOOL_ENV: "set" },
  })
  expect(ran.stdout).toBe(`set|${process.env.PATH}`)
})
