import { createRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import { builtinDetectors } from "../detectors"
import { checkCommand, UsageError } from "./check"
import { findRoot } from "./project"
import { validateCommand } from "./validate"
import { warmCommand } from "./warm"

export interface CliIo {
  cwd: string
  stdout(text: string): void
  stderr(text: string): void
  /** All of stdin. */
  readStdin(): Promise<string>
  /** Starts `rulecast warm --detector <kind>...` in root, detached. */
  startWarm(root: string, kinds: string[]): void
}

const USAGE = `usage:
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
  rulecast warm [--detector <kind>]...
`

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  const registry = createRegistry([...builtinDetectors])
  const root = findRoot(io.cwd)
  try {
    switch (command) {
      case "check":
        return await checkCommand(root, args, registry, io)
      case "validate":
        return await validateCommand(root, registry, io)
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
