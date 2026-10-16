import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { createRegistry } from "../../src/core/detection/registry"
import { mergeBase } from "../../src/core/git"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { git } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

/**
 * The pipeline's raw result, for callers that need more than the rendered delivery: every match
 * with its id and status, and which rules ran to completion on which files. A committed baseline
 * is written from the first and pruned with the second (a rule that did not run keeps its entries).
 */
const USERS = "app/services/users.py"
const ORDERS = "app/services/orders.py"

const schema = z.object({}).strict()

const failing: Detector<z.infer<typeof schema>> = {
  kind: "failing",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: () => Promise.reject(new Error("tool not installed")),
}

const slow: Detector<z.infer<typeof schema>> = {
  kind: "slow",
  schema,
  captures: () => [],
  events: () => ["edit", "verify"],
  run: () => new Promise(() => {}),
}

const summary = (findings: { id: string; rule: { id: string }; match: { line: number }; status: string }[]) =>
  findings.map(({ id, rule, match, status }) => ({ id, rule: rule.id, line: match.line, status }))

describe("pipeline findings and ran", () => {
  test("every match is returned with its id and status, not merged per rule", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const result = await pipelineAt(root, {
      kind: "verify",
      files: [USERS, "src/client/api.ts"],
      baseCommit: await mergeBase(root, "main"),
      cwd: root,
    })
    const found = summary(result.findings ?? [])
    expect(found.map(({ rule, line, status }) => [rule, line, status])).toEqual([
      ["backend/no-httpexception", 2, "preexisting"],
      ["backend/no-httpexception", 3, "new"],
      ["frontend/no-generated-edits", 1, "preexisting"],
    ])
    expect(found.every(({ id }) => /^[0-9a-f]{16}$/.test(id))).toBe(true)
    expect(new Set(found.map(({ id }) => id)).size).toBe(3)
    expect(result.ran).toEqual(
      new Map([
        ["backend/no-httpexception", [USERS]],
        ["frontend/no-generated-edits", ["src/client/api.ts"]],
      ]),
    )
  })

  test("the ids are the ones the delivery would carry, and stable across runs", async () => {
    const root = await createFixture()
    const event = { kind: "verify" as const, files: [USERS], cwd: root }
    const first = await pipelineAt(root, event)
    const second = await pipelineAt(root, event)
    expect(first.findings?.map(({ id }) => id)).toEqual(second.findings?.map(({ id }) => id))
    expect(first.findings?.map(({ status }) => status)).toEqual(["new"])
  })

  test("only files a rule matched are listed for it; a skipped kind is not listed at all", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, ORDERS), "x = 1\n")
    const result = await pipelineAt(
      root,
      { kind: "verify", files: [USERS, ORDERS, "src/client/api.ts", "README.md"], cwd: root },
      { skipDetectorKinds: new Set(["path"]) },
    )
    expect(result.ran).toEqual(new Map([["backend/no-httpexception", [USERS, ORDERS]]]))
  })

  test("a rule whose detector failed or timed out did not run", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig(
        [
          ...fixtureRules,
          { id: "x/failing", name: "Failing", files: "^app/", detect: { failing: {} }, message: "m" },
          { id: "x/slow", name: "Slow", files: "^app/", detect: { slow: {} }, message: "m" },
        ],
        { timeouts: { verify_ms: 50 } },
      ),
    )
    const result = await pipelineAt(
      root,
      { kind: "verify", files: [USERS], cwd: root },
      { registry: createRegistry([...builtinDetectors, failing, slow]) },
    )
    expect(result.failed).toBe(true)
    expect([...(result.ran?.keys() ?? [])]).toEqual(["backend/no-httpexception"])
    expect(summary(result.findings ?? []).map(({ rule }) => rule)).toEqual(["backend/no-httpexception"])
  })

  test("an ignored match is in ignored, not in findings", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, USERS),
      "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)  # rulecast-ignore: backend/no-httpexception legacy\n",
    )
    const result = await pipelineAt(root, { kind: "verify", files: [USERS], cwd: root })
    expect(summary(result.findings ?? []).map(({ line }) => line)).toEqual([2])
    expect(result.ignored?.map(({ match }) => match.line)).toEqual([3])
    expect(result.ran?.get("backend/no-httpexception")).toEqual([USERS])
  })

  test("an event that runs no detector has no ran", async () => {
    const root = await createFixture()
    const result = await pipelineAt(root, { kind: "touch", files: [USERS], cwd: root, session: { id: "s1" } })
    expect(result.ran).toBeUndefined()
    expect(result.findings ?? []).toEqual([])
  })
})
