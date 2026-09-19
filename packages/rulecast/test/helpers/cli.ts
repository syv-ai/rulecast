import { type CliIo, main } from "../../src/commands/main"
import type { Env } from "../../src/core/home"
import { testEnv } from "./home"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
}

/** In-process CLI I/O. The environment defaults to this test file's own RULECAST_HOME. */
export function captureIo(cwd: string, stdin = "", env: Env = testEnv): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [] }
  const io: CliIo = {
    cwd,
    env,
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

export async function runCli(
  cwd: string,
  argv: string[],
  stdin = "",
  env: Env = testEnv,
): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin, env)
  const code = await main(argv, io)
  return { code, ...output }
}
