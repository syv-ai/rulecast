import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const payloads = fileURLToPath(new URL("../payloads/llm/", import.meta.url))

/** Where the providers look first (plan 6a, Decision 8): <root>/node_modules/.bin. */
function binDir(root: string): string {
  return path.join(root, "node_modules", ".bin")
}

export interface StubAgentOptions {
  /** Models the stub answers with unparseable output, for a deterministic per-rule failure. */
  broken?: string[]
  /** What the stub prints instead of the recorded claude envelope (OpenCode prints plain text). */
  stdout?: string
  exitCode?: number
}

/**
 * A stub agent CLI in <root>/node_modules/.bin. It appends its argv to <root>/<name>.argv and its
 * stdin to <root>/<name>.stdin — appends, so a test can count how many calls a run made — then
 * prints the recorded answer.
 *
 * **The stub is prompt-sensitive.** The recording names rule `r1`, but callers use whatever ids
 * they need, so the stub reads the first `### <id>` heading out of the prompt on stdin and
 * substitutes it for `r1`. One recording therefore serves every test, the contract suite's `a`,
 * `b`, `good` and `bad` included. See test/payloads/llm/README.md.
 */
export async function stubAgentCli(root: string, name: string, options: StubAgentOptions = {}): Promise<void> {
  await mkdir(binDir(root), { recursive: true })
  const answer = options.stdout ?? (await readFile(path.join(payloads, "claude-code.json"), "utf8"))
  const answerFile = path.join(binDir(root), `${name}.answer`)
  await writeFile(answerFile, answer)

  const argvFile = path.join(root, `${name}.argv`)
  const stdinFile = path.join(root, `${name}.stdin`)
  const broken = options.broken ?? []
  const script = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> ${quote(argvFile)}`,
    `prompt=$(cat)`,
    `printf '%s\\n\\0---\\0\\n' "$prompt" >> ${quote(stdinFile)}`,
    ...broken.map((model) => `case "$*" in *${model}*) echo 'I had a think and decided not to answer.'; exit 0;; esac`),
    // The first "### <id>" heading of the prompt is the rule this call is about.
    `rule=$(printf '%s' "$prompt" | sed -n 's/^### \\([^ ]*\\).*/\\1/p' | head -n 1)`,
    `if [ -n "$rule" ]; then sed "s|\\"r1\\"|\\"$rule\\"|g" ${quote(answerFile)}; else cat ${quote(answerFile)}; fi`,
    `exit ${options.exitCode ?? 0}`,
    "",
  ].join("\n")
  const file = path.join(binDir(root), name)
  await writeFile(file, script)
  await chmod(file, 0o755)
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** The argv of each call the stub received, in order. */
export async function stubArgv(root: string, name: string): Promise<string[]> {
  return lines(await read(path.join(root, `${name}.argv`)))
}

/** The prompt of each call the stub received, in order. */
export async function stubStdin(root: string, name: string): Promise<string[]> {
  const text = await read(path.join(root, `${name}.stdin`))
  return text
    .split("\n\0---\0\n")
    .filter((call) => call.length > 0)
    .map((call) => call.replace(/\n$/, ""))
}

async function read(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return ""
  }
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0)
}
