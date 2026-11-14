import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process"

import { childEnv } from "../child-env"
import { isNotFound } from "../errors"

/** A whole-repository run of a linter on a large project prints megabytes of JSON. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** What a checker printed, and how it exited. */
export interface ToolResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * POSIX: each tool runs in a process group of its own, so an abort can end everything it started.
 * Killing only the tool leaves its children running: a pre-commit hook's formatter outlived its
 * deadline and rewrote files after the hook detector had put them back (#83). `spawn`, not
 * `execFile`, which drops `detached`. Windows has no process groups; there the tool alone is killed.
 */
const GROUPS = process.platform !== "win32"

/**
 * After an abort, how long the tool's output may stay open once the tool itself has exited. A
 * process that left the group (setsid) and kept the pipe would otherwise hold the run past its
 * deadline for as long as it lives.
 */
const ABORT_OUTPUT_GRACE_MS = 100

/** Signals forwarded to the tool groups still running, which a terminal no longer reaches. */
const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const

/** Tool groups running now, by their leader's pid. */
const live = new Map<number, ChildProcess>()

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH: the group is gone already.
  }
}

/**
 * Ends the tool's group with SIGKILL, and again once the tool's output closes, for a process of the
 * group that let go of the pipes and kept running. SIGKILL, not SIGTERM: a shell's background job
 * survives SIGTERM, a tool may ignore it, and an ended run's results are dropped anyway.
 */
function endGroup(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  signalGroup(pid, "SIGKILL")
  child.once("close", () => signalGroup(pid, "SIGKILL"))
}

/** How many times, at most, a signal that ends rulecast sends SIGKILL to each group first. */
const FINAL_KILLS = 5

/** A pause of `ms` that blocks, for a signal handler about to end the process. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Whether any process of the group is left. */
function groupLeft(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A signal to rulecast ends the tool groups too: a group of its own is out of the terminal's reach,
 * so Ctrl-C would otherwise end rulecast and leave its tools running. They are ended at once, since
 * no grace timer would outlive rulecast, and whether another handler keeps rulecast alive cannot be
 * known here. With no other handler for the signal, rulecast then ends as the signal says; a command
 * that handles it (doctor) ends on its own, once what the tools changed is put back.
 *
 * Before ending, each group is sent SIGKILL again until none of it is left, a few times at most: a
 * process forked while the first SIGKILL landed escapes it.
 */
function forward(signal: NodeJS.Signals): void {
  for (const child of live.values()) endGroup(child)
  if (process.listenerCount(signal) > 1) return
  for (const pid of live.keys()) {
    for (let kill = 0; kill < FINAL_KILLS && groupLeft(pid); kill++) {
      pause(5)
      signalGroup(pid, "SIGKILL")
    }
  }
  for (const each of FORWARDED) process.off(each, forward)
  process.kill(process.pid, signal)
}

/** Tools between `arm` and `track`, whose forwarders are installed while they spawn. */
let arming = 0

function listen(): void {
  if (live.size === 0 && arming === 0) for (const each of FORWARDED) process.on(each, forward)
}

function unlisten(): void {
  if (live.size === 0 && arming === 0) for (const each of FORWARDED) process.off(each, forward)
}

/**
 * Before spawn(): a signal that arrives while the tool is being started finds the forwarders in place.
 * Installed after, a signal in between took the default action and left the group, detached, running.
 * Node runs a signal's handlers after the code that is running, so by then `track` has the tool.
 */
function arm(): void {
  listen()
  arming += 1
}

/** A spawn that started nothing: undoes its `arm`. */
function disarm(): void {
  arming -= 1
  unlisten()
}

function track(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) {
    disarm()
    return
  }
  arming -= 1
  live.set(pid, child)
  child.once("close", () => {
    live.delete(pid)
    unlisten()
  })
}

/**
 * Runs a checker and returns what it printed and its exit code.
 *
 * A non-zero exit is not a failure: a linter or a command rule exits non-zero precisely when it
 * found something, and the output is the answer. The exit code is kept for a caller that knows a
 * tool's codes (ty exits 2 on a bad config); none is told to fail on it here. What is a failure is a binary that is not there —
 * reported as `notFound`, which the caller words for its own user — and an error that carries no
 * output at all, such as a permission failure. An abort is rethrown untouched, so the caller can tell the clock from
 * the rule (`pastDeadline`), and only once the tool and every process it started have ended
 * (`endGroup`), so a caller that puts files back after an abort does so last.
 *
 * `command` and `linter` each carried a copy of this, `maxBuffer` and comment included. `llm`'s CLI
 * providers do not use it: they write a prompt to stdin, keep stderr and the exit code, and a
 * missing binary is a whole-run `LlmUnavailableError` there rather than a rule error.
 */
export async function runTool(
  command: string,
  args: readonly string[],
  /** `env`: variables set for the tool on top of rulecast's own environment. */
  options: {
    cwd: string
    signal: AbortSignal
    notFound: string
    stdin?: string
    env?: Readonly<Record<string, string>>
  },
): Promise<ToolResult> {
  options.signal.throwIfAborted()
  if (GROUPS) arm()
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...childEnv(), ...options.env } : childEnv(),
      detached: GROUPS,
      windowsHide: true,
    })
  } catch (error) {
    if (GROUPS) disarm()
    throw error
  }
  const stop = () => (GROUPS ? endGroup(child) : child.kill("SIGKILL"))
  options.signal.addEventListener("abort", stop, { once: true })
  if (GROUPS) track(child)
  // A tool that exits without reading its stdin (a crash, a config error, or simply a path run)
  // closes the pipe under us. That is not a failure: the tool's output is still the answer, and an
  // unhandled EPIPE would take the process down.
  child.stdin.on("error", () => {})
  // Always closed, empty when there is nothing to send: a tool that reads stdin when given no
  // input would otherwise wait for an end that never comes.
  if (options.stdin === undefined) child.stdin.end()
  else child.stdin.end(options.stdin)
  try {
    const { stdout, stderr, code } = await collect(child, stop, options.signal)
    // Aborted, and ended before it could fail: still the clock's, not a clean run.
    options.signal.throwIfAborted()
    // A process killed by a signal has no exit code.
    return { stdout, stderr, exitCode: code ?? 1 }
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason ?? error
    if (isNotFound(error)) throw new Error(options.notFound)
    throw error
  } finally {
    options.signal.removeEventListener("abort", stop)
  }
}

/**
 * What the tool printed and how it exited, once its output has closed, or, after an abort, once
 * the tool has exited and ABORT_OUTPUT_GRACE_MS has passed. Output past
 * MAX_OUTPUT_BYTES ends the tool, as execFile's `maxBuffer` did, and what came before is kept.
 */
function collect(
  child: ChildProcessWithoutNullStreams,
  end: () => void,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Aborted: once the tool has exited, its output is cut after a short grace, whoever still holds it.
    let cut: NodeJS.Timeout | undefined
    const cutOutput = () => {
      cut = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
      }, ABORT_OUTPUT_GRACE_MS)
    }
    const aborted = () => {
      if (child.exitCode !== null || child.signalCode !== null) cutOutput()
      else child.once("exit", cutOutput)
    }
    signal.addEventListener("abort", aborted, { once: true })
    child.once("close", () => {
      clearTimeout(cut)
      signal.removeEventListener("abort", aborted)
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    const take = (chunks: Buffer[]) => (chunk: Buffer) => {
      if (size > MAX_OUTPUT_BYTES) return
      size += chunk.length
      if (size > MAX_OUTPUT_BYTES) end()
      else chunks.push(chunk)
    }
    child.stdout.on("data", take(out))
    child.stderr.on("data", take(err))
    child.once("error", reject)
    child.once("close", (code) =>
      resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code }),
    )
  })
}
