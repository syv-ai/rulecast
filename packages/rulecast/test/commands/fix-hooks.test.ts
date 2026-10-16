import { readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { fixCommand } from "../../src/commands/fix"
import { hookCommand } from "../../src/commands/hook"
import { runCommand } from "../../src/commands/run"
import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { captureIo } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { claudeCodePayload } from "../helpers/payloads"

/**
 * "Hooks never apply fixes" (issue #30), checked three ways: what a hook leaves on disk, what a
 * detector is asked for under a hook, and what the hook's code can reach at all.
 */

const FILE = "app/users.py"
const VIOLATION = 'def get():\n    print("user")\n'

/** A fixable rule that fires on FILE, and refuses writes too, so the guard runs it. */
const LOGGER = {
  id: "py/logger",
  name: "Logger",
  files: "\\.py$",
  refuse_write: true,
  detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)", fix: "log.info({{args}})" } },
  message: "{{file}}:{{line}} uses print. Use the logger.",
  examples: { bad: [{ path: "a.py", code: 'print("hi")\n', fixed: 'log.info("hi")\n' }] },
}

/** Every kind of event a recorded payload produces, and the content written before it, if any. */
const EVENTS: { name: string; tool?: Record<string, unknown>; write?: boolean }[] = [
  { name: "session-start.startup" },
  { name: "post-tool-use.read.complete" },
  { name: "pre-tool-use.write", tool: { content: 'print("proposed")\n' } },
  { name: "pre-tool-use.edit", tool: { old_string: "def get():", new_string: "def fetch():" } },
  { name: "post-tool-use.edit", write: true },
  { name: "post-tool-use.write.update", write: true },
  { name: "pre-tool-use.bash" },
  { name: "post-tool-use.bash", write: true },
  { name: "user-prompt-submit" },
  { name: "stop" },
  { name: "subagent-stop" },
]

function payload(root: string, name: string, tool?: Record<string, unknown>) {
  const isFileTool =
    !name.includes("bash") && !name.startsWith("session") && !name.includes("stop") && !name.includes("prompt")
  const value = claudeCodePayload(name, { root, file: isFileTool ? FILE : undefined, sessionId: "s1" })
  if (tool !== undefined) value.tool_input = { ...value.tool_input, ...tool }
  return JSON.stringify(value)
}

async function hook(
  root: string,
  name: string,
  registry = createRegistry([...builtinDetectors]),
  tool?: Record<string, unknown>,
) {
  const { io, output } = captureIo(root, payload(root, name, tool))
  expect(await hookCommand(["claude-code"], registry, io)).toBe(0)
  return output.stdout
}

describe("hooks never apply fixes", () => {
  test("every recorded hook event leaves a fixable violation byte-identical, and still reports it", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([LOGGER]), [FILE]: "def get():\n    pass\n" })
    const delivered: string[] = []
    for (const event of EVENTS) {
      if (event.write === true) await writeFile(path.join(root, FILE), VIOLATION)
      const before = await readFile(path.join(root, FILE))
      delivered.push(await hook(root, event.name, undefined, event.tool))
      expect((await readFile(path.join(root, FILE))).equals(before), event.name).toBe(true)
    }
    // The edit and the stop told the agent about it: it was found, and left for the agent to fix.
    expect(delivered.join("\n")).toContain("uses print. Use the logger.")
    expect(await readFile(path.join(root, FILE), "utf8")).toBe(VIOLATION)
  })

  test("a detector is never asked for fixes by a hook or by run, and is by fix", async () => {
    const seen: { fixes: boolean | undefined }[] = []
    // Flags "BAD" and, when asked, offers "GOOD" in its place: a fixable detector like regex.
    const spy: Detector<Record<string, never>> = {
      kind: "spy",
      schema: z.object({}).strict(),
      captures: () => [],
      events: () => ["edit", "verify"],
      guards: true,
      fixable: () => true,
      async run(input) {
        seen.push({ fixes: input.fixes })
        const findings = []
        for (const rule of input.rules) {
          for (const file of rule.files) {
            const text = (await input.read(file)) ?? ""
            const at = text.indexOf("BAD")
            if (at === -1) continue
            const match = { file, line: 1, endLine: 1, column: at + 1, text: "BAD", captures: {} }
            findings.push({
              rule: rule.id,
              match,
              ...(input.fixes ? { fix: { start: at, end: at + 3, text: "GOOD" } } : {}),
            })
          }
        }
        return { findings, errors: [] }
      },
    }
    const registry = createRegistry([...builtinDetectors, spy])
    const rule = {
      id: "spy/rule",
      name: "Spy",
      files: "\\.py$",
      refuse_write: true,
      detect: { spy: {} },
      message: "{{file}}:{{line}} spied",
      examples: { bad: [{ path: "a.py", code: "BAD\n", fixed: "GOOD\n" }] },
    }
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([rule]), [FILE]: "ok\n" })
    for (const event of EVENTS) {
      if (event.write === true) await writeFile(path.join(root, FILE), "BAD\n")
      const tool = event.name === "pre-tool-use.write" ? { content: "BAD\n" } : event.tool
      await hook(root, event.name, registry, tool)
    }
    const { io } = captureIo(root)
    await runCommand(root, ["--all-files"], registry, io)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((call) => call.fixes === undefined)).toBe(true)
    expect(await readFile(path.join(root, FILE), "utf8")).toBe("BAD\n")

    // The control: the spy does see the request when it is made, and the fix is written.
    seen.length = 0
    await fixCommand(root, ["--all-files"], registry, captureIo(root).io)
    expect(seen.some((call) => call.fixes === true)).toBe(true)
    expect(await readFile(path.join(root, FILE), "utf8")).toBe("GOOD\n")
  })

  test("nothing a hook runs can reach core/fix/", () => {
    const src = fileURLToPath(new URL("../../src/", import.meta.url))
    // Type-only imports are erased when compiled, so they are not a way to reach code.
    const IMPORT =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^"']*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g
    const reachable = new Set<string>()
    const visit = (file: string) => {
      if (reachable.has(file)) return
      reachable.add(file)
      for (const found of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const target = path.resolve(path.dirname(file), (found[1] ?? found[2])!)
        const resolved = [`${target}.ts`, path.join(target, "index.ts")].find((candidate) => {
          try {
            readFileSync(candidate)
            return true
          } catch {
            return false
          }
        })
        if (resolved !== undefined) visit(resolved)
      }
    }
    for (const entry of ["core/pipeline.ts", "core/guard.ts", "commands/hook.ts"]) visit(path.join(src, entry))
    expect(reachable.size).toBeGreaterThan(30)
    const fixDir = path.join(src, "core", "fix") + path.sep
    expect([...reachable].filter((file) => file.startsWith(fixDir))).toEqual([])
    expect([...reachable].filter((file) => file.endsWith(`${path.sep}examples.ts`))).toEqual([])
  })
})
