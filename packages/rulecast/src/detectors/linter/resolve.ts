import { access, constants } from "node:fs/promises"
import path from "node:path"

import { localBin, onPath, upTo } from "../../core/which"
import type { ToolName } from "./schema"
import { TOOLS } from "./tools"

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
 * Where a tool lints `file` (repo-relative) from: the nearest directory above it, up to the
 * repository's top, that holds one of the tool's config files, so a package's own config and its
 * relative paths apply as they do when the package runs the tool itself. The project root when
 * there is none. `seen` remembers which directories have a config, across the files of one run.
 */
export async function runDirFor(
  tool: ToolName,
  file: string,
  root: string,
  top: string,
  seen: Map<string, Promise<boolean>> = new Map(),
): Promise<string> {
  const hasMarker = (dir: string) => {
    let found = seen.get(dir)
    if (found === undefined) {
      found = Promise.all(TOOLS[tool].markers.map((marker) => reachable(path.join(dir, marker), constants.F_OK))).then(
        (present) => present.includes(true),
      )
      seen.set(dir, found)
    }
    return found
  }
  for (const dir of upTo(path.dirname(path.join(root, file)), top)) {
    if (await hasMarker(dir)) return dir
  }
  return root
}

/**
 * Spec §6: node_modules/.bin from `dir` up to the repository's `top`, then `uv run`, then PATH.
 * `uv run` only helps for a Python tool inside a project uv already manages: a `pyproject.toml` in
 * `dir`, and a `uv.lock` there or above it up to `top` (a workspace member has its lock at the
 * workspace root). Without the lock, `uv run` would create one and a `.venv` in the user's tree.
 */
async function uvLocked(dir: string, top: string): Promise<boolean> {
  for (const from of upTo(dir, top)) {
    if (await reachable(path.join(from, "uv.lock"), constants.F_OK)) return true
  }
  return false
}

export async function resolveTool(
  tool: ToolName,
  dir: string,
  available: (command: string) => boolean | Promise<boolean> = onPath,
  top: string = dir,
): Promise<ResolvedTool> {
  const local = await localBin(tool, dir, top)
  if (local !== null) return { command: local, prefix: [] }
  if (
    PYTHON_TOOLS.has(tool) &&
    (await reachable(path.join(dir, "pyproject.toml"), constants.F_OK)) &&
    (await uvLocked(dir, top)) &&
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
  options: {
    /** Give up when doctor's deadline passes; a PATH lookup can block on a stalled mount. */
    signal?: AbortSignal
    /** Injected by tests to exercise the uv branch without a uv on the machine. */
    available?: (command: string) => boolean | Promise<boolean>
    /** The repository's top, which node_modules/.bin is looked for up to, as a run does. */
    top?: string
  } = {},
): Promise<DescribedTool> {
  const available = options.available ?? ((command: string) => onPath(command, options.signal))
  const resolved = await resolveTool(tool, root, available, options.top)
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
