import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { mergeHooks } from "../adapters/claude-code/settings"
import { loadConfig } from "../core/compile/config"
import { errorMessage, isNotFound } from "../core/errors"
import { ensureStateDir } from "../core/state-dir"
import type { CliIo } from "./main"

const SETTINGS = ".claude/settings.json"

const SCAFFOLD: Readonly<Record<string, string>> = {
  ".rulecast/config.yml": [
    "# rulecast project config. Every key is optional; these are the defaults.",
    "rules: .rulecast/rules/**/*.yml",
    "context:",
    "  mode: inject",
    "  maxBytes: 32768",
    "maxMatchesPerRule: 10",
    "timeouts:",
    "  editDeadlineMs: 350",
    "  verifyMs: 60000",
    "stopGate:",
    "  maxBlocks: 3",
    "",
  ].join("\n"),
  ".rulecast/rules/example.yml": [
    "# An example rule: copy it for your own conventions, then delete this file.",
    "id: example/no-console-log",
    'files: "src/**/*.{ts,tsx,js,jsx}"',
    "severity: warning",
    "detect:",
    "  regex: { pattern: 'console\\.log\\(' }",
    "message: '{{file}}:{{line}} calls console.log. Use the project logger instead.'",
    "context: ['@conventions/example.md#logging']",
    "",
  ].join("\n"),
  "conventions/example.md": [
    "# Example conventions",
    "",
    "Rules point at sections of documents like this one.",
    "",
    "## Logging",
    "",
    "Use the project logger instead of `console.log`, so log levels and structured fields stay consistent.",
    "",
  ].join("\n"),
}

export async function initCommand(root: string, io: CliIo): Promise<number> {
  for (const [file, content] of Object.entries(SCAFFOLD)) {
    const full = path.join(root, file)
    if (existsSync(full)) {
      io.stdout(`exists   ${file}\n`)
      continue
    }
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
    io.stdout(`created  ${file}\n`)
  }
  ensureStateDir(root)

  const config = await loadConfig(root)
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
    merged = mergeHooks(current, command, config.config.timeouts.verifyMs)
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
  io.stdout("\nnext: write rules in .rulecast/rules, then run rulecast validate\n")
  return 0
}
