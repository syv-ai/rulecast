import { spawn } from "node:child_process"
import { accessSync, constants, statSync } from "node:fs"
import path from "node:path"

import type { Env } from "../core/home"

export interface ClipboardCommand {
  command: string
  args: string[]
}

/** In the spec's order: macOS, Wayland, X11, then Windows and WSL. */
const CANDIDATES: readonly ClipboardCommand[] = [
  { command: "pbcopy", args: [] },
  { command: "wl-copy", args: [] },
  { command: "xclip", args: ["-selection", "clipboard"] },
  { command: "clip.exe", args: [] },
]

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Full path of the first executable called `name` on env.PATH, or null. */
export function findOnPath(name: string, env: Env): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue
    const candidate = path.join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/** The first clipboard command found on PATH, with its full path; null when there is none. */
export function clipboardCommand(env: Env): ClipboardCommand | null {
  for (const candidate of CANDIDATES) {
    const found = findOnPath(candidate.command, env)
    if (found !== null) return { command: found, args: candidate.args }
  }
  return null
}

/** Pipes `text` into the clipboard command; true when it exits 0. */
export function copyWith(clipboard: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(clipboard.command, clipboard.args, { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
    // A command that fails to start closes its stdin; the error event above already answers.
    child.stdin.on("error", () => {})
    child.stdin.end(text)
  })
}
