import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { childEnv } from "./child-env"

const exec = promisify(execFile)

/**
 * Is `command` runnable by name? `command -v` under /bin/sh, so it answers the same question the
 * shell would, including builtins.
 *
 * The name is bound to `$1` rather than written into the script. `execFile`'s own `shell` option
 * would join file and arguments into one command line — `onPath("x; rm -rf ~")` would *run* the
 * second half — and doctor asks this about a `command` rule's argv[0], which comes from a config
 * a rule repo may have written.
 *
 * `PATH`, when given, is searched instead of the process's own.
 *
 * `signal` matters more here than it looks: a PATH entry on a stalled network mount makes
 * `command -v` block forever, and doctor's checks have no other way to give up.
 */
export async function onPath(command: string, signal?: AbortSignal, PATH?: string): Promise<boolean> {
  return (await commandPath(command, signal, PATH)) !== null
}

/** What `command -v` says `command` is (a path, or a builtin's name), as onPath asks it; null when nothing. */
export async function commandPath(command: string, signal?: AbortSignal, PATH?: string): Promise<string | null> {
  try {
    const env = PATH === undefined ? childEnv() : { ...childEnv(), PATH }
    const { stdout } = await exec("/bin/sh", ["-c", 'command -v "$1"', "sh", command], { signal, env })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** `dir` and its parents up to and including `top`; `dir` alone when `top` is not above it. */
export function upTo(dir: string, top: string): string[] {
  const relative = path.relative(top, dir)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [dir]
  const dirs = [dir]
  for (let current = dir; current !== top; ) {
    current = path.dirname(current)
    dirs.push(current)
  }
  return dirs
}

/**
 * The first executable among `relatives` (paths relative to a directory), tried in each directory
 * from `from` up to the repository's `top`, nearest first. Null when there is none. The one walker
 * behind every "the project's own install" lookup.
 */
export async function firstExecutable(relatives: readonly string[], from: string, top: string): Promise<string | null> {
  for (const dir of upTo(from, top)) {
    for (const relative of relatives) {
      const candidate = path.join(dir, relative)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {}
    }
  }
  return null
}

/**
 * The project's own install of `name`: the nearest executable `node_modules/.bin/<name>` from `from`
 * up to the repository's `top` (a package's own, a workspace's, the repository's). Null when there
 * is none. Every detector that runs a project's tool looks for it here first.
 */
export function localBin(name: string, from: string, top: string): Promise<string | null> {
  return firstExecutable([path.join("node_modules", ".bin", name)], from, top)
}

/**
 * A Python tool installed in the project's own virtualenv: the nearest executable `.venv/bin/<name>`
 * or `venv/bin/<name>` from `from` up to `top`. A venv kept elsewhere (Poetry's default, in its cache
 * directory) is not looked for; once activated, its bin is on the PATH, which covers it.
 */
export function venvBin(name: string, from: string, top: string): Promise<string | null> {
  return firstExecutable([path.join(".venv", "bin", name), path.join("venv", "bin", name)], from, top)
}
