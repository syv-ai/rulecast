import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { binaryPath, currentBinaryPath } from "../../src/core/binary-home"

/** Where a rulecast can be: the project's node_modules/.bin, the installed binary, the PATH. */
export type Place = "project" | "binary" | "path"

/**
 * The fixtures every lookup of rulecast is held to: the agent hooks' command, the git hooks'
 * command and doctor's hookRulecast. Each names the places that have a rulecast and the one that
 * must run.
 */
export const LOOKUP_FIXTURES: { name: string; places: Place[]; runs: Place }[] = [
  { name: "only the installed binary", places: ["binary"], runs: "binary" },
  { name: "the project's own rulecast wins over the installed binary", places: ["project", "binary"], runs: "project" },
  { name: "the installed binary wins over one on the PATH", places: ["binary", "path"], runs: "binary" },
]

export interface LookupSetup {
  root: string
  home: string
  /** A PATH directory, with a rulecast in it when "path" is one of the places. */
  pathDir: string
  /** Where each place's rulecast is. */
  file: Record<Place, string>
}

/**
 * A stub rulecast that prints `version` for `--version`, else records `<place>`, its arguments and
 * its stdin in `<root>/ran-<place>` and answers `{"<place>":true}`.
 */
function stub(file: string, place: Place, root: string, version: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const ran = path.join(root, `ran-${place}`)
  writeFileSync(
    file,
    `#!/bin/sh\n[ "$1" = --version ] && { echo ${version}; exit 0; }\n` +
      `printf '%s\\n' "$*" > "${ran}"\ncat >> "${ran}"\necho '{"${place}":true}'\n`,
  )
  chmodSync(file, 0o755)
}

/** A project, a cache home and a PATH directory, with a stub rulecast in each of `places`. */
export function lookupSetup(
  places: Place[],
  root: string,
  versions: Partial<Record<Place, string>> = {},
  version = "0.8.2",
): LookupSetup {
  const scratch = mkdtempSync(path.join(tmpdir(), "rulecast-lookup-"))
  const home = path.join(scratch, "home")
  const pathDir = path.join(scratch, "path")
  mkdirSync(pathDir, { recursive: true })
  const file: Record<Place, string> = {
    project: path.join(root, "node_modules", ".bin", "rulecast"),
    binary: currentBinaryPath(home),
    path: path.join(pathDir, "rulecast"),
  }
  for (const place of places) {
    const v = versions[place] ?? version
    if (place === "binary") {
      const placed = binaryPath(home, v)
      stub(placed, place, root, v)
      symlinkSync(path.relative(path.dirname(file.binary), placed), file.binary)
    } else {
      stub(file[place], place, root, v)
    }
  }
  return { root, home, pathDir, file }
}

/**
 * Replaces the installed binary with one the OS cannot run: executable, but not a program for this
 * machine, as a binary built for another platform in a shared cache home is.
 */
export function breakInstalledBinary(setup: LookupSetup): void {
  const target = realpathSync(setup.file.binary)
  writeFileSync(
    target,
    Buffer.from("\u007fELF\u0002\u0001\u0001\u0000not a program for this machine\u0000\u0001", "latin1"),
  )
  chmodSync(target, 0o755)
}
