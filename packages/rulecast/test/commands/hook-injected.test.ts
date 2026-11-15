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
