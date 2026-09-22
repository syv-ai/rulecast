import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

/**
 * Is `command` runnable by name? `command -v` under /bin/sh, so it answers the same question the
 * shell would, including builtins.
 *
 * The name is bound to `$1` rather than written into the script. `execFile`'s own `shell` option
 * would join file and arguments into one command line — `onPath("x; rm -rf ~")` would *run* the
 * second half — and doctor asks this about a `command` rule's argv[0], which comes from a config
 * a rule repo may have written.
 */
export async function onPath(command: string): Promise<boolean> {
  try {
    await exec("/bin/sh", ["-c", 'command -v "$1" > /dev/null', "sh", command])
    return true
  } catch {
    return false
  }
}
