import { type CliIo, main } from "../../src/commands/main"
import type { Env } from "../../src/core/home"
import type { Prompter } from "../../src/init/prompts"
import { testEnv } from "./home"

export interface CapturedOutput {
  stdout: string
  stderr: string
  /** Calls to startWarm. */
  warmed: { root: string; kinds: string[] }[]
  /** Texts handed to copyToClipboard. */
  copied: string[]
}

export interface IoOptions {
  /** Behave as if stdin and stdout were terminals. */
  interactive?: boolean
  /** Answers prompts; required when a test runs an interactive command. */
  prompter?: Prompter
  /** What copyToClipboard reports; default true. */
  clipboard?: boolean
}

export function captureIo(
  cwd: string,
  stdin = "",
  env: Env = testEnv,
  options: IoOptions = {},
): { io: CliIo; output: CapturedOutput } {
  const output: CapturedOutput = { stdout: "", stderr: "", warmed: [], copied: [] }
  const io: CliIo = {
    cwd,
    env,
    interactive: options.interactive ?? false,
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
    prompter: async () => {
      if (!options.prompter) throw new Error("the test gave no prompter")
      return options.prompter
    },
    copyToClipboard: async (text) => {
      output.copied.push(text)
      return options.clipboard ?? true
    },
  }
  return { io, output }
}

export async function runCli(
  cwd: string,
  argv: string[],
  stdin = "",
  env: Env = testEnv,
  options: IoOptions = {},
): Promise<CapturedOutput & { code: number }> {
  const { io, output } = captureIo(cwd, stdin, env, options)
  const code = await main(argv, io)
  return { code, ...output }
}
