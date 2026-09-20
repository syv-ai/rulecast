import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { ToolName } from "./schema"

const exec = promisify(execFile)

export interface ResolvedTool {
  command: string
  /** Arguments that come before the tool's own: ["run", "--", "ruff"] for uv. */
  prefix: string[]
}

/** Tools that live in a Python environment, so `uv run` can supply them. */
const PYTHON_TOOLS: ReadonlySet<string> = new Set(["ruff"])

async function reachable(file: string, mode: number): Promise<boolean> {
  try {
    await access(file, mode)
    return true
  } catch {
    return false
  }
}

async function onPath(command: string): Promise<boolean> {
  try {
    await exec("command", ["-v", command], { shell: "/bin/sh" })
    return true
  } catch {
    return false
  }
}

/**
 * Spec §6: the project's node_modules/.bin, then `uv run`, then PATH. `uv run` only helps for a
 * Python tool inside a Python project, so it is gated on both.
 */
export async function resolveTool(
  tool: ToolName,
  root: string,
  available: (command: string) => boolean | Promise<boolean> = onPath,
): Promise<ResolvedTool> {
  const local = path.join(root, "node_modules", ".bin", tool)
  if (await reachable(local, constants.X_OK)) return { command: local, prefix: [] }
  if (
    PYTHON_TOOLS.has(tool) &&
    (await reachable(path.join(root, "pyproject.toml"), constants.F_OK)) &&
    (await available("uv"))
  ) {
    return { command: "uv", prefix: ["run", "--", tool] }
  }
  return { command: tool, prefix: [] }
}
