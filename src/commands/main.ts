import { existsSync } from "node:fs"
import path from "node:path"
import { createRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import { builtinDetectors } from "../detectors"
import { checkCommand, UsageError } from "./check"
import { validateCommand } from "./validate"

export interface CliIo {
  cwd: string
  stdout(text: string): void
  stderr(text: string): void
}

const USAGE = `usage:
  rulecast check [files...] [--base <ref>] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast validate
`

/** Nearest ancestor of cwd containing .rulecast/, or cwd itself. */
export function findRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".rulecast"))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

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
