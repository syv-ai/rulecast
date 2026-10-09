import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { isNotFound } from "../errors"

const exec = promisify(execFile)

/**
 * Runs a checker and returns what it printed.
 *
 * A non-zero exit is not a failure: a linter or a command rule exits non-zero precisely when it
 * found something, and the output is the answer. What is a failure is a binary that is not there —
 * reported as `notFound`, which the caller words for its own user — and an error that carries no
 * output at all, such as a permission failure. An abort is rethrown untouched, so the caller can tell the clock from
 * the rule (`pastDeadline`).
 *
 * `command` and `linter` each carried a copy of this, `maxBuffer` and comment included. `llm`'s CLI
 * providers do not use it: they write a prompt to stdin, keep stderr and the exit code, and a
 * missing binary is a whole-run `LlmUnavailableError` there rather than a rule error.
 */
export async function runTool(
  command: string,
  args: readonly string[],
  options: { cwd: string; signal: AbortSignal; notFound: string; stdin?: string },
): Promise<string> {
  try {
    const running = exec(command, [...args], {
      cwd: options.cwd,
      signal: options.signal,
      // A whole-repository run of a linter on a large project prints megabytes of JSON.
      maxBuffer: 64 * 1024 * 1024,
    })
    // A tool that exits without reading its stdin (a crash, a config error, or simply a path run)
    // closes the pipe under us. That is not a failure: the tool's output is still the answer, and an
    // unhandled EPIPE would take the process down.
    running.child.stdin?.on("error", () => {})
    // Always closed, empty when there is nothing to send: a tool that reads stdin when given no
    // input would otherwise wait for an end that never comes.
    if (options.stdin === undefined) running.child.stdin?.end()
    else running.child.stdin?.end(options.stdin)
    const result = await running
    return result.stdout
  } catch (error) {
    if (options.signal.aborted) throw error
    if (isNotFound(error)) throw new Error(options.notFound)
    const failure = error as { stdout?: string }
    if (typeof failure.stdout !== "string") throw error
    return failure.stdout
  }
}
