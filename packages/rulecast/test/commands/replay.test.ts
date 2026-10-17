import { readdir } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"
import { stubAgentCli } from "../helpers/llm"
import { transcriptsFor } from "../helpers/transcripts"

const replay = async (root: string, ...argv: string[]) =>
  runCli(root, ["replay", "claude-code", ...argv], "", { ...testEnv, CLAUDE_CONFIG_DIR: await transcriptsFor(root) })

describe("rulecast replay claude-code", () => {
  test("judges each edit and each turn from the transcript, and counts what the rules would have done", async () => {
    const root = await createFixture()
    const result = await replay(root, "--format", "json")
    expect(result).toMatchObject({ code: 0, stderr: "" })
    const document = JSON.parse(result.stdout)
    expect(document).toMatchObject({ sessions: 1, edits: 4, turns: 3, unknownEdits: 1, skippedRules: [], errors: [] })
    expect(document.rules).toEqual([
      {
        rule: "backend/no-httpexception",
        severity: "error",
        edits: 3,
        editsFired: 2,
        turns: 2,
        turnsFired: 1,
        wouldBlock: 1,
      },
      {
        rule: "frontend/no-generated-edits",
        severity: "warning",
        edits: 1,
        editsFired: 1,
        turns: 1,
        turnsFired: 1,
        wouldBlock: 0,
      },
    ])
    const where = (finding: { agent: string; turn: number; stage: string; file: string; line: number }) =>
      `${finding.agent} ${finding.turn} ${finding.stage} ${finding.file}:${finding.line}`
    // The 404 was there before the session: never the agent's.
    expect(document.findings.map(where).sort()).toEqual(
      [
        "a1 0 edit src/client/api.ts:1",
        "a1 0 turn src/client/api.ts:1",
        "main 0 edit app/services/orders.py:1",
        "main 0 edit app/services/users.py:2",
        "main 0 turn app/services/orders.py:1",
        "main 0 turn app/services/users.py:2",
      ].sort(),
    )
    expect(document.findings).toContainEqual(
      expect.objectContaining({
        session: "session",
        rule: "backend/no-httpexception",
        message: "app/services/users.py:2 raises HTTPException(500). Raise a domain exception.",
      }),
    )
  })

  test("the terminal table, and what a transcript cannot show", async () => {
    const root = await createFixture()
    const result = await replay(root)
    expect(result.stdout).toContain("1 session: 4 edits and 3 turns judged, 1 more edits not")
    expect(result.stdout).toMatch(/backend\/no-httpexception\s+2 of 3\s+1 of 2\s+1/)
    expect(result.stdout).toContain("Edits made through Bash are not in a transcript")
  })

  test("--rule judges only that rule; a rule whose tool needs the files on disk is named, not run", async () => {
    const script = {
      id: "local/script",
      name: "A script",
      files: "^app/services/",
      detect: { command: { run: ["true"] } },
      message: "{{file}} script",
    }
    const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig([...fixtureRules, script]) })
    const only = JSON.parse((await replay(root, "--rule", "frontend/no-generated-edits", "--format", "json")).stdout)
    expect(only.rules.map((rule: { rule: string }) => rule.rule)).toEqual(["frontend/no-generated-edits"])
    const all = JSON.parse((await replay(root, "--format", "json")).stdout)
    expect(all.skippedRules).toEqual(["local/script"])
  })

  describe("llm rules", () => {
    beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
    afterEach(() => vi.unstubAllEnvs())

    const judgement = {
      id: "backend/judgement",
      name: "Judgement",
      files: "^app/services/.*\\.py$",
      detect: { llm: { model: "haiku", question: "Does this need judgement? Report each offending line." } },
      message: "{{file}}:{{line}} needs judgement. {{reason}}",
    }

    test("are left out unless asked for, and --llm says what they would cost before --yes runs them", async () => {
      const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig([judgement]) })
      await stubAgentCli(root, "claude")
      const without = JSON.parse((await replay(root, "--format", "json")).stdout)
      expect(without.rules).toEqual([])
      // Verify only, as at a stop: turn 0 judges users.py and orders.py, turn 1 users.py.
      expect(JSON.parse((await replay(root, "--llm", "--format", "json")).stdout)).toEqual({ estimate: { calls: 3 } })
      expect(await readdir(path.join(root, "claude.calls"))).toEqual([])
      const run = JSON.parse((await replay(root, "--llm", "--yes", "--format", "json")).stdout)
      expect(await readdir(path.join(root, "claude.calls"))).toHaveLength(3)
      expect(run.rules[0]).toMatchObject({ rule: "backend/judgement", turns: 2 })
    })
  })

  test("usage errors", async () => {
    const root = await createFixture()
    for (const argv of [
      [],
      ["codex"],
      ["claude-code", "--yes"],
      ["claude-code", "--sessions", "0"],
      ["claude-code", "--rule", "nope"],
    ]) {
      const result = await runCli(root, ["replay", ...argv])
      expect(result.code, argv.join(" ")).toBe(2)
    }
  })
})
