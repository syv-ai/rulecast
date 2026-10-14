export type Runner = "pre-commit" | "prek"

export interface Framed {
  /** null: no status line, so the runner never ran the hook (an unknown id, a failed install). */
  status: "passed" | "failed" | "skipped" | null
  /** The hook's own exit code, from `- exit code: N`; null when the runner printed none. */
  exitCode: number | null
  /** The runner said "files were modified by this hook". */
  modified: boolean
  /** The tool's own output, as it printed it. */
  output: string
}

const ESCAPE = String.fromCharCode(27)
const ANSI = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "g")
/** `mypy.......Failed`, `shellcheck....(no files to check)Skipped`. */
const STATUS = /^\S.*?\.{2,}(?:\([^)]*\))?(Passed|Failed|Skipped)\s*$/
const EXIT_CODE = /^- exit code: (\d+)\s*$/
const MODIFIED = /^- files were modified by this hook\s*$/
/** `- hook id:`, `- description:`, `- duration:` and whatever else the runners add in that shape. */
const DETAIL = /^- [a-z][a-z ]*:/
/** pre-commit's environment set-up and stash notices. */
const NOTICE = /^\[(INFO|WARNING)\]/

/**
 * What pre-commit or prek printed, without what the runner itself added: the status line, the
 * `- hook id` block, set-up notices, and prek's two-space indent of the tool's lines. The single
 * owner of knowing what those runners print.
 */
export function stripRunnerFraming(text: string, runner: Runner): Framed {
  const framed: Framed = { status: null, exitCode: null, modified: false, output: "" }
  const output: string[] = []
  for (const raw of text.replace(ANSI, "").split(/\r?\n/)) {
    const status = STATUS.exec(raw)
    if (status) {
      framed.status = status[1]!.toLowerCase() as Framed["status"]
      continue
    }
    const exit = EXIT_CODE.exec(raw)
    if (exit) {
      framed.exitCode = Number(exit[1])
      continue
    }
    if (MODIFIED.test(raw)) {
      framed.modified = true
      continue
    }
    if (DETAIL.test(raw) || NOTICE.test(raw)) continue
    output.push(runner === "prek" && framed.status !== null ? raw.replace(/^ {2}/, "") : raw)
  }
  framed.output = output.join("\n").replace(/^\n+/, "")
  return framed
}
