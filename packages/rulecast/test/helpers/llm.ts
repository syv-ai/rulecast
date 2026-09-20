import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const payloads = fileURLToPath(new URL("../payloads/llm/", import.meta.url))

/** Where the providers look first (plan 6a, Decision 8): <root>/node_modules/.bin. */
function binDir(root: string): string {
  return path.join(root, "node_modules", ".bin")
}

export interface StubAgentOptions {
  /** Models the stub answers unparseably, for a deterministic per-rule failure. */
  broken?: string[]
  /** Printed verbatim instead of the recorded envelope (OpenCode prints plain text). */
  stdout?: string
  exitCode?: number
}

/**
 * A stub agent CLI in <root>/node_modules/.bin. Each call writes its argv and its prompt to its own
 * directory under <root>/<name>.calls/, so a test can count the calls a run made and read each
 * prompt. One directory per call, not one appended file: the detector runs its calls concurrently,
 * and two processes appending a multi-kilobyte prompt to one file interleave.
 *
 * **The stub answers about whatever the prompt asked.** The recording names rule `r1`, but callers
 * use whatever ids they need — the detector contract suite uses `a`, `b`, `good` and `bad`. So the
 * stub reads every `### <id>` heading out of the prompt and emits one copy of the recorded finding
 * per rule, which is also what a real model does when two rules ask about the same line.
 *
 * It is a Node script with the running node's absolute path in its shebang, so it works whatever a
 * test has done to PATH — and tests do stub PATH, to keep a machine's real `claude` out of reach.
 */
export async function stubAgentCli(root: string, name: string, options: StubAgentOptions = {}): Promise<void> {
  await mkdir(binDir(root), { recursive: true })
  const callsDir = path.join(root, `${name}.calls`)
  await mkdir(callsDir, { recursive: true })

  const recording = JSON.parse(await readFile(path.join(payloads, "claude-code.json"), "utf8"))
  const script = `#!${process.execPath}
const { mkdirSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")

const CALLS = ${JSON.stringify(callsDir)}
const BROKEN = ${JSON.stringify(options.broken ?? [])}
const VERBATIM = ${JSON.stringify(options.stdout ?? null)}
const RECORDING = ${JSON.stringify(recording)}
const EXIT_CODE = ${options.exitCode ?? 0}

const argv = process.argv.slice(2).join(" ")
const chunks = []
process.stdin.on("data", (chunk) => chunks.push(chunk))
process.stdin.on("end", () => {
  const prompt = Buffer.concat(chunks).toString("utf8")
  const dir = join(CALLS, String(process.pid))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "argv"), argv)
  writeFileSync(join(dir, "stdin"), prompt)

  if (BROKEN.some((model) => argv.includes(model))) {
    process.stdout.write("I had a think and decided not to answer.\\n")
    process.exit(EXIT_CODE)
  }
  if (VERBATIM !== null) {
    process.stdout.write(VERBATIM)
    process.exit(EXIT_CODE)
  }

  const rules = [...prompt.matchAll(/^### (\\S+)/gm)].map((match) => match[1])
  const template = RECORDING.structured_output.findings
  const findings = rules.flatMap((rule) => template.map((finding) => ({ ...finding, rule })))
  const answer = { ...RECORDING, structured_output: { findings }, result: JSON.stringify({ findings }) }
  process.stdout.write(JSON.stringify(answer))
  process.exit(EXIT_CODE)
})
`
  const file = path.join(binDir(root), name)
  await writeFile(file, script)
  await chmod(file, 0o755)
}

/** The argv of each call the stub received. Calls run concurrently, so the order is not meaningful. */
export function stubArgv(root: string, name: string): Promise<string[]> {
  return callFiles(root, name, "argv")
}

/** The prompt of each call the stub received. */
export function stubStdin(root: string, name: string): Promise<string[]> {
  return callFiles(root, name, "stdin")
}

async function callFiles(root: string, name: string, which: "argv" | "stdin"): Promise<string[]> {
  const dir = path.join(root, `${name}.calls`)
  let calls: string[]
  try {
    calls = await readdir(dir)
  } catch {
    return []
  }
  return Promise.all(calls.sort().map((call) => readFile(path.join(dir, call, which), "utf8")))
}
