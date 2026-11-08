import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { nativeDir } from "../core/binary-home"
import { CONFIG_FILE } from "../core/config/load"
import { cacheHome, projectStateDir } from "../core/home"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/**
 * Deletes rulecast's cache, or only the current project's directory in it. The native files this
 * version of the standalone binary loads stay: a running binary may have them loaded.
 */
export async function cleanCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { project: { type: "boolean", default: false } } })
  const home = cacheHome(io.env)
  if (values.project) {
    if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
    const target = projectStateDir(home, root)
    if (!existsSync(target)) {
      io.stdout("nothing to clean\n")
      return 0
    }
    await rm(target, { recursive: true, force: true })
    io.stdout(`removed ${target}\n`)
    return 0
  }
  const keep = [nativeDir(home)].filter((dir) => existsSync(dir))
  const removed = await removeAllBut(home, keep)
  if (removed === 0) {
    io.stdout("nothing to clean\n")
    return 0
  }
  io.stdout(keep.length === 0 ? `removed ${home}\n` : `removed ${home}, keeping ${keep.join(" and ")}\n`)
  return 0
}

/** Removes everything under `dir` except the paths in `keep` and their parents. Returns how many entries went. */
async function removeAllBut(dir: string, keep: string[]): Promise<number> {
  if (!existsSync(dir)) return 0
  if (keep.length === 0) {
    await rm(dir, { recursive: true, force: true })
    return 1
  }
  let removed = 0
  for (const name of await readdir(dir)) {
    const entry = path.join(dir, name)
    if (keep.includes(entry)) continue
    if (keep.some((kept) => kept.startsWith(`${entry}${path.sep}`))) {
      removed += await removeAllBut(entry, keep)
      continue
    }
    await rm(entry, { recursive: true, force: true })
    removed++
  }
  return removed
}
