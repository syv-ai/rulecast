import { createRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import type { Env } from "../core/home"
import { builtinDetectors } from "../detectors"
import type { Prompter } from "../init/prompts"
import { autoupdateCommand } from "./autoupdate"
import { cleanCommand } from "./clean"
import { hookCommand } from "./hook"
import { initCommand } from "./init"
import { installCommand, uninstallCommand } from "./install"
import { findRoot } from "./project"
import { runCommand } from "./run"
import { tryRepoCommand } from "./try-repo"
import { UsageError } from "./usage"
import { validateCommand } from "./validate"
import { warmCommand } from "./warm"

export interface CliIo {
  cwd: string
  /** Environment variables; the cache home comes from RULECAST_HOME or XDG_CACHE_HOME (core/home.ts). */
  env: Env
  /** stdin and stdout are terminals: init may prompt. */
  interactive: boolean
  /** The terminal prompter, loaded on demand; only init calls it, and only when interactive. */
  prompter(): Promise<Prompter>
  /** Copies text to the system clipboard; false when no clipboard command exists or it fails. */
  copyToClipboard(text: string): Promise<boolean>
  stdout(text: string): void
  stderr(text: string): void
  /** All of stdin. */
  readStdin(): Promise<string>
  /** Starts `rulecast warm --detector <kind>...` in root, detached. */
  startWarm(root: string, kinds: string[]): void
}

const USAGE = `usage:
  rulecast init [--rules id,id | --no-rules] [--agent <name>]... [--scope shared|personal] [--yes]
  rulecast install [--agent <name>]... [--scope shared|personal]
  rulecast uninstall [--agent <name>]...
  rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast autoupdate [--freeze] [--repo URL]...
  rulecast try-repo <path|url> [RULE_ID] [--ref REV] [run flags]
  rulecast validate [file...]
  rulecast clean [--project]
  rulecast hook <adapter>
  rulecast warm [--detector <kind>]...
`

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  const registry = createRegistry([...builtinDetectors])
  const root = findRoot(io.cwd)
  try {
    switch (command) {
      case "init":
        return await initCommand(args, registry, io)
      case "install":
        return await installCommand(root, args, io)
      case "uninstall":
        return await uninstallCommand(root, args, io)
      case "run":
        return await runCommand(root, args, registry, io)
      case "autoupdate":
        return await autoupdateCommand(root, args, io)
      case "try-repo":
        return await tryRepoCommand(root, args, registry, io)
      case "validate":
        return await validateCommand(root, args, registry, io)
      case "clean":
        return await cleanCommand(root, args, io)
      case "hook":
        return await hookCommand(args, registry, io)
      case "warm":
        return await warmCommand(root, args, registry, io)
      case undefined:
      case "help":
      case "--help":
        io.stdout(USAGE)
        return command === undefined ? 2 : 0
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (error) {
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      io.stderr(USAGE)
    }
    return 2
  }
}
