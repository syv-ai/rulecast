import { spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../../../core/errors"
import { onPath } from "../../../core/which"
import { type LlmAvailability, LlmUnavailableError } from "./types"

export interface CliResult {
  stdout: string
  stderr: string
  code: number | null
}

/**
 * <root>/node_modules/.bin/<name>, then PATH — the order spec §6 sets for linters, for the same
 * reason: it is what lets a fixture run a stub of its own. linter/resolve.ts is not reused; its
 * `uv run` branch exists for ruff and is dead weight here.
 */
export async function resolveCli(name: string, root: string): Promise<string> {
  const local = path.join(root, "node_modules", ".bin", name)
  try {
    await access(local, constants.X_OK)
    return local
  } catch {
    return name
  }
}

/**
 * Spawns a CLI with the prompt on stdin and collects its output. A non-zero exit is not an error —
 * the output is the answer — but a missing binary is, and it is the whole run's problem (spec §14).
 */
export function runCli(
  command: string,
  args: string[],
  options: { cwd: string; input: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    // A CLI that answers without reading its input closes stdin early; that is not a failure.
    child.stdin.on("error", () => {})
    child.stdin.end(options.input)
    child.on("error", (error) => {
      reject(isNotFound(error) ? new LlmUnavailableError(`${command} is not installed`) : error)
    })
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
      })
    })
  })
}

/** resolveCli, then the PATH: what `available` reports for a CLI provider. */
export async function cliAvailable(name: string, cwd: string): Promise<LlmAvailability> {
  const resolved = await resolveCli(name, cwd)
  if (resolved !== name) return { ok: true, detail: resolved }
  return (await onPath(name))
    ? { ok: true, detail: `${name} (PATH)` }
    : { ok: false, detail: `${name} is not installed` }
}
