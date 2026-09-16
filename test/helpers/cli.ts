import { type CliIo, main } from "../../src/commands/main"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
}

export function captureIo(cwd: string, stdin = ""): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [] }
  const io: CliIo = {
    cwd,
    stdout: (text) => {
      output.stdout += text
    },
    stderr: (text) => {
      output.stderr += text
    },
    readStdin: async () => stdin,
    startWarm: (root, kinds) => {
      output.warmed.push({ root, kinds })
    },
  }
  return { io, output }
}

export async function runCli(cwd: string, argv: string[], stdin = ""): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin)
  const code = await main(argv, io)
  return { code, ...output }
}
