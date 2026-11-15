import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { INJECTED_LOG } from "../../src/core/stats/injected"
import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { stateDirFor, testEnv } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"

// What reached the model is recorded per project, for `rulecast stats` (agreed with both leads).

describe("the hook records what reached the model", () => {
  test("a Read that delivers a doc section: one read record with the section and its size", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("post-tool-use.read.complete", {
      root,
      file: "app/services/users.py",
      sessionId: "s1",
    })
    const { stdout } = await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), testEnv)
    const told = JSON.parse(stdout).hookSpecificOutput.additionalContext as string
    const lines = (await readFile(path.join(stateDirFor(root), INJECTED_LOG), "utf8")).trim().split("\n")
    const records = lines.map((line) => JSON.parse(line))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ s: "s1", a: "main", ev: "read", chars: told.length })
    expect(records[0].docs.map(([ref]: [string]) => ref)).toEqual(["conventions/backend.md#services"])
  })

  test("an answer only the user sees is not recorded", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("stop", { root, sessionId: "s1" })
    await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), testEnv)
    await expect(readFile(path.join(stateDirFor(root), INJECTED_LOG), "utf8")).rejects.toThrow()
  })
})

describe("rulecast stats shows what reached the model", () => {
  test("≈ tokens by event, per session beside its turns, and doc sections by cost with the rules citing them", async () => {
    const root = await createFixture()
    const hook = (name: string, file?: string) =>
      runCli(
        root,
        ["hook", "claude-code"],
        JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })),
        testEnv,
      )
    await hook("post-tool-use.read.complete", "app/services/users.py")
    await hook("stop")
    const { stdout } = await runCli(root, ["stats", "--format", "json"], "", testEnv)
    const injected = JSON.parse(stdout).injected
    expect(injected.tokens).toBeGreaterThan(0)
    expect(Object.keys(injected.byEvent)).toEqual(["read"])
    expect(injected.sessions).toEqual([{ session: "s1", tokens: injected.tokens, turns: 1, perTurn: injected.tokens }])
    expect(injected.docs).toEqual([
      expect.objectContaining({ ref: "conventions/backend.md#services", deliveries: 1, rules: ["backend/services"] }),
    ])
    const terminal = (await runCli(root, ["stats"], "", testEnv)).stdout
    expect(terminal).toContain("injected into the agents (≈ tokens, chars ÷ 4):")
    expect(terminal).toContain("conventions/backend.md#services")
  })
})

describe("review of cec2ae0: the hook side", () => {
  test("stats shows what reached the model before any stop is in the findings log", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("post-tool-use.read.complete", {
      root,
      file: "app/services/users.py",
      sessionId: "s1",
    })
    await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), testEnv)
    const terminal = (await runCli(root, ["stats"], "", testEnv)).stdout
    expect(terminal).toContain("injected into the agents")
  })

  test("a doc section two projects both deliver is counted once, by the project whose copy was shown", async () => {
    const { createRepo } = await import("../helpers/git")
    const { localConfig } = await import("../helpers/config")
    const touch = (id: string) => ({ id, name: id, files: "\\.py$", stages: ["touch"], context: ["@docs/d.md#s"] })
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([touch("top/t")]),
      "backend/.rulecast-config.yaml": localConfig([{ ...touch("b/t"), context: ["@../docs/d.md#s"] }]),
      "docs/d.md": `# D\n\n## S\n\n${"Section text. ".repeat(40)}\n`,
      "backend/x.py": "x = 1\n",
    })
    const payload = claudeCodePayload("post-tool-use.read.complete", { root, file: "backend/x.py", sessionId: "s1" })
    const { stdout } = await runCli(root, ["hook", "claude-code"], JSON.stringify(payload), testEnv)
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toContain("Section text.")
    const docsOf = async (dir: string) => {
      const text = await readFile(path.join(stateDirFor(dir), INJECTED_LOG), "utf8").catch(() => "")
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => JSON.parse(line).docs as [string, number][])
    }
    const all = [...(await docsOf(root)), ...(await docsOf(path.join(root, "backend")))]
    expect(all).toHaveLength(1)
  })
})
