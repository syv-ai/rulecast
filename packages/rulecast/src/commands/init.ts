import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { ADAPTERS } from "../adapters"
import { CONFIG_FILE } from "../core/config/load"
import { installHooks, loadProjectConfig, printInstall } from "./install"
import type { CliIo } from "./main"

const SCAFFOLD = [
  "# rulecast config: https://github.com/syv-ai/rulecast",
  "# Add rules under repo: local, or select rules from a rule repo by repo and rev.",
  "repos:",
  "  - repo: local",
  "    rules: []",
  "",
].join("\n")

/** Interim, non-interactive setup: a minimal config plus every adapter's hooks in shared scope. */
export async function initCommand(root: string, args: string[], io: CliIo): Promise<number> {
  parseArgs({ args, options: {} })
  const configFile = path.join(root, CONFIG_FILE)
  if (existsSync(configFile)) {
    io.stdout(`exists   ${CONFIG_FILE}\n`)
  } else {
    await writeFile(configFile, SCAFFOLD)
    io.stdout(`created  ${CONFIG_FILE}\n`)
  }

  const config = await loadProjectConfig(root, "init")
  for (const adapter of ADAPTERS) {
    if (adapter.install)
      printInstall(io, adapter, await installHooks(root, adapter, "shared", config.timeouts.verifyMs))
  }
  io.stdout(`\nnext: add rules to ${CONFIG_FILE}, then run rulecast validate\n`)
  return 0
}
