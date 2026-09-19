import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { parseArgs } from "node:util"

import { CONFIG_FILE } from "../core/config/load"
import { cacheHome, projectStateDir } from "../core/home"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/** Deletes rulecast's cache, or only the current project's directory in it. */
export async function cleanCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { project: { type: "boolean", default: false } } })
  const home = cacheHome(io.env)
  let target = home
  if (values.project) {
    if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
    target = projectStateDir(home, root)
  }
  if (!existsSync(target)) {
    io.stdout("nothing to clean\n")
    return 0
  }
  await rm(target, { recursive: true, force: true })
  io.stdout(`removed ${target}\n`)
  return 0
}
