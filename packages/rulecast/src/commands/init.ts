import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { mergeHooks } from "../adapters/claude-code/settings"
import { CONFIG_FILE, parseConfig, readConfigData } from "../core/config/load"
import { errorMessage, isNotFound } from "../core/errors"
import type { CliIo } from "./main"

const SETTINGS = ".claude/settings.json"

const SCAFFOLD = [
  "# rulecast config: https://github.com/syv-ai/rulecast",
  "# Add rules under repo: local, or select rules from a rule repo by repo and rev.",
  "repos:",
  "  - repo: local",
  "    rules: []",
  "",
].join("\n")

export async function initCommand(root: string, io: CliIo): Promise<number> {
  const configFile = path.join(root, CONFIG_FILE)
  if (existsSync(configFile)) {
    io.stdout(`exists   ${CONFIG_FILE}\n`)
  } else {
    await writeFile(configFile, SCAFFOLD)
    io.stdout(`created  ${CONFIG_FILE}\n`)
  }

  const data = await readConfigData(root)
  const config = data.ok ? parseConfig(data.value) : data
  if (!config.ok) throw new Error(`${config.message} (fix it, then run rulecast init again)`)

  const settingsFile = path.join(root, SETTINGS)
  let current: unknown = {}
  try {
    current = JSON.parse(await readFile(settingsFile, "utf8"))
  } catch (error) {
    if (!isNotFound(error)) throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  const command = existsSync(path.join(root, "node_modules", ".bin", "rulecast"))
    ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code'
    : "rulecast hook claude-code"
  let merged: ReturnType<typeof mergeHooks>
  try {
    merged = mergeHooks(current, command, config.value.timeouts.verifyMs)
  } catch (error) {
    throw new Error(`${SETTINGS}: ${errorMessage(error)}`)
  }
  if (merged.added.length === 0) {
    io.stdout(`Claude Code hooks already installed in ${SETTINGS}\n`)
  } else {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, `${JSON.stringify(merged.settings, null, 2)}\n`)
    io.stdout(`installed Claude Code hooks in ${SETTINGS}: ${merged.added.join(", ")}\n`)
  }
  io.stdout(`\nnext: add rules to ${CONFIG_FILE}, then run rulecast validate\n`)
  return 0
}
