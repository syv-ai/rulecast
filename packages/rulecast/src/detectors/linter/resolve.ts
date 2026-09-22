import { access, constants } from "node:fs/promises"
import path from "node:path"

import { onPath } from "../../core/which"
import type { ToolName } from "./schema"

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

export interface DescribedTool {
  /** The command as a person would type it: a repo-relative path, "uv run -- ruff", or the bare name. */
  command: string
  /** Which of resolveTool's three branches answered. */
  how: "local" | "uv" | "path"
  /** Is there something there to run. */
  found: boolean
}

/**
 * How resolveTool found a tool, for `rulecast doctor`. resolveTool returns a runnable command
 * whether or not anything provides it — a bare name is its last resort — so doctor cannot tell a
 * resolved tool from a missing one by its return value alone.
 */
export async function describeTool(
  tool: ToolName,
  root: string,
  available: (command: string) => boolean | Promise<boolean> = onPath,
): Promise<DescribedTool> {
  const resolved = await resolveTool(tool, root, available)
  if (path.isAbsolute(resolved.command)) {
    // resolveTool only returns an absolute path after testing it for X_OK, so it exists.
    const relative = path.relative(root, resolved.command)
    const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    return { command: inside ? relative.split(path.sep).join("/") : resolved.command, how: "local", found: true }
  }
  if (resolved.prefix.length > 0) {
    return { command: [resolved.command, ...resolved.prefix].join(" "), how: "uv", found: true }
  }
  return { command: resolved.command, how: "path", found: await available(resolved.command) }
}
