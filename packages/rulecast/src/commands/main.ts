import { createRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import type { Env } from "../core/home"
import { VERSION } from "../core/version"
import { builtinDetectors } from "../detectors"
import type { Prompter } from "../init/prompts"
import { autoupdateCommand } from "./autoupdate"
import { cleanCommand } from "./clean"
import { doctorCommand } from "./doctor"
import { commandHelp, usage } from "./help"
import { hookCommand } from "./hook"
import { initCommand } from "./init"
import { installCommand, uninstallCommand } from "./install"
import { findRoot } from "./project"
import { runCommand } from "./run"
import { testCommand } from "./test"
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

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  const registry = createRegistry([...builtinDetectors])
  const root = findRoot(io.cwd)
  if (command === "--version" || command === "-v" || command === "version") {
    io.stdout(`${VERSION}\n`)
    return 0
  }
  // Intercepted here, so no command's parser needs to know --help exists.
  const help =
    command === "help" && args[0] !== undefined
      ? args[0]
      : args.includes("--help") || args.includes("-h")
        ? command
        : null
  if (help !== null && help !== undefined) {
    const text = commandHelp(help)
    if (text !== null) {
      io.stdout(text)
      return 0
    }
  }
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
      case "test":
        return await testCommand(root, args, registry, io)
      case "validate":
        return await validateCommand(root, args, registry, io)
      case "clean":
        return await cleanCommand(root, args, io)
      case "hook":
        return await hookCommand(args, registry, io)
      case "warm":
        return await warmCommand(root, args, registry, io)
      case "doctor":
        return await doctorCommand(root, args, registry, io)
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(usage())
        return command === undefined ? 2 : 0
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (error) {
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      // The one command's flags, not every command's: that is the help being asked for.
      io.stderr(`\n${(command !== undefined && commandHelp(command)) || usage()}`)
    }
    return 2
  }
}
