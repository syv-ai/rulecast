import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { defaultDetectorSettings } from "../../../src/core/types"
import { commandDetector } from "../../../src/detectors/command/detector"
import type { CommandConfig } from "../../../src/detectors/command/schema"
import { createProject } from "../../helpers/project"

/** Nothing the machine happens to have installed may decide these. */
beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin")
  return () => vi.unstubAllEnvs()
})

async function script(root: string, name: string, mode: number): Promise<void> {
  const file = path.join(root, name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "#!/bin/sh\necho '[]'\n")
  await chmod(file, mode)
}

function check(root: string, rules: { id: string; run: string[] }[]) {
  return commandDetector.check!({
    rules: rules.map((rule) => ({
      id: rule.id,
      config: { run: rule.run, output: "json", captures: [] } satisfies CommandConfig,
    })),
    settings: defaultDetectorSettings(),
    env: process.env,
    cwd: root,
    signal: AbortSignal.timeout(5000),
  })
}

describe("command detector check", () => {
  test("an executable script in the project is ok, reported by the path the rule wrote", async () => {
    const root = await createProject({})
    await script(root, "scripts/check.sh", 0o755)
    expect(await check(root, [{ id: "a", run: ["./scripts/check.sh", "{{files}}"] }])).toEqual([
      { what: "./scripts/check.sh", level: "ok", detail: path.join(root, "scripts/check.sh"), rules: [] },
    ])
  })

  test("a script that is not executable is an error naming the rules that use it", async () => {
    const root = await createProject({})
    await script(root, "check.sh", 0o644)
    expect(
      await check(root, [
        { id: "a", run: ["./check.sh"] },
        { id: "b", run: ["./check.sh"] },
      ]),
    ).toEqual([{ what: "./check.sh", level: "error", detail: "not executable", rules: ["a", "b"] }])
  })

  test("a script that is not there at all says so", async () => {
    const root = await createProject({})
    expect(await check(root, [{ id: "a", run: ["./missing.sh"] }])).toEqual([
      { what: "./missing.sh", level: "error", detail: "no such file", rules: ["a"] },
    ])
  })

  test("a bare name is looked for on the PATH", async () => {
    const root = await createProject({})
    const results = await check(root, [
      { id: "a", run: ["sh", "-c", "true"] },
      { id: "b", run: ["definitely-not-a-real-binary-9x7"] },
    ])
    expect(results).toEqual([
      { what: "sh", level: "ok", detail: "sh (PATH)", rules: [] },
      { what: "definitely-not-a-real-binary-9x7", level: "error", detail: "not installed", rules: ["b"] },
    ])
  })

  test("one command named by several rules is checked once", async () => {
    const root = await createProject({})
    await script(root, "check.sh", 0o755)
    const results = await check(root, [
      { id: "a", run: ["./check.sh"] },
      { id: "b", run: ["./check.sh"] },
    ])
    expect(results).toHaveLength(1)
  })
})
