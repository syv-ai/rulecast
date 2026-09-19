import { spawn } from "node:child_process"

/** Starts a process that outlives this one: own process group, no stdio, never awaited. */
export function spawnDetached(command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" })
  // A failure to start is reported asynchronously; nobody is waiting for it.
  child.on("error", () => {})
  child.unref()
}
