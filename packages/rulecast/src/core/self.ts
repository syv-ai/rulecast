import { realpathSync } from "node:fs"

import { isStandaloneBinary } from "../detectors/ast-grep/embedded"

interface Proc {
  execPath: string
  argv: string[]
}

/**
 * How this process starts another copy of itself. Under Node that is node and the script. In the
 * standalone binary, `argv[1]` is the bundle's virtual path (`/$bunfs/root/rulecast`), which the
 * binary would read as a command name: the binary alone is the whole command.
 */
export function selfCommand(proc: Proc = process, binary: boolean = isStandaloneBinary()): [string, ...string[]] {
  return binary ? [proc.execPath] : [proc.execPath, proc.argv[1]!]
}

/** Which rulecast this is, for messages that ask the developer to update it. */
export function installLabel(proc: Proc = process, binary: boolean = isStandaloneBinary()): string {
  if (binary) return `the standalone binary at ${proc.execPath}`
  const script = proc.argv[1] ?? proc.execPath
  try {
    return realpathSync(script)
  } catch {
    return script
  }
}
