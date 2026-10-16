import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { headCommit } from "../../src/core/git"
import { sessionDir } from "../../src/core/session/session"
import type { Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

const TEST = "tests/test_pricing.py"

/** Counts assert statements: what the rule keeps, not a violation. */
const keepAssertions = (scope: "removed" | "instance" = "removed") => ({
  id: "tests/keep-assertions",
  name: "Assertions are not removed",
  files: "^tests/",
  severity: "warning",
  scope,
  detect: { "ast-grep": { language: "python", rule: { kind: "assert_statement" } } },
  message: "{{file}}:{{line}} removes assertions ({{removed}} of {{baseline}} removed).",
})

const BEFORE = [
  "def test_total():",
  "    assert total([1, 2]) == 3",
  "    assert total([]) == 0",
  "",
  "def test_discount():",
  "    assert discount(100, 15) == 85",
  "",
].join("\n")

async function scenario(content = BEFORE, rules: Record<string, unknown>[] = [keepAssertions()]) {
  const root = await createRepo({ ".rulecast-config.yaml": localConfig(rules), [TEST]: content })
  const send = async (event: Omit<Event, "cwd" | "session">, session: string | null = "s1") =>
    (
      await pipelineAt(
        root,
        { ...event, cwd: root, ...(session === null ? {} : { session: { id: session } }) },
        { stopGate: event.kind === "verify" && session !== null },
      )
    ).delivery
  const write = (text: string) => writeFile(path.join(root, TEST), text)
  return { root, send, write }
}

const summary = (findings: { rule: string; line: number; message: string; status: string }[]) =>
  findings.map(({ rule, line, message, status }) => ({ rule, line, message, status }))

describe("pipeline: removed scope", () => {
  test("removing an assert in a session is one finding at the stop, on the first changed line, and none at the edit", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await write(BEFORE.replace("    assert total([]) == 0\n", ""))

    // The edit may be the first half of a move: the count is judged when the agent stops.
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])
    const stop = await send({ kind: "verify", files: [] })
    expect(summary(stop.findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 3,
        message: "tests/test_pricing.py:3 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
    // A warning: attended, it does not hold the stop.
    expect(stop.stop).toBe("allow")
  })

  test("adding, moving or rewriting asserts is nothing, and no assert is ever a finding by itself", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })

    await write(`${BEFORE}\ndef test_more():\n    assert total([5]) == 5\n`)
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])

    await write(
      "def test_discount():\n    assert discount(100, 15) == 85\n\ndef test_total():\n    assert total([]) == 0\n    assert total([1, 2]) == 3\n",
    )
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])

    await write(BEFORE.replace("assert total([]) == 0", "assert total([]) == 0.0"))
    const delivery = await send({ kind: "verify", files: [] })
    expect(delivery.findings).toEqual([])
    expect(delivery.preexistingSummary).toEqual([])
  })

  test("moving an assert over two edits is nothing: cut at the first, pasted at the second", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await write(BEFORE.replace("    assert total([]) == 0\n", ""))
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])
    await write(`${BEFORE.replace("    assert total([]) == 0\n", "")}\ndef test_empty():\n    assert total([]) == 0\n`)
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])
    expect((await send({ kind: "verify", files: [] })).findings).toEqual([])
  })

  test("a deletion at the end of the file is reported on its last line, not past it", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await write(BEFORE.replace("    assert discount(100, 15) == 85\n", ""))
    await send({ kind: "edit", files: [TEST] })
    expect(summary((await send({ kind: "verify", files: [] })).findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 5,
        message: "tests/test_pricing.py:5 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
  })

  test("removing every assert from a file still counts: the file has no match left to report on", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await write("def test_total():\n    total([1, 2])\n")
    await send({ kind: "edit", files: [TEST] })
    expect(summary((await send({ kind: "verify", files: [] })).findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 2,
        message: "tests/test_pricing.py:2 removes assertions (3 of 3 removed).",
        status: "new",
      },
    ])
  })

  test("without a touch, the stop measures the session's start commit", async () => {
    const { send, write } = await scenario()
    // A shell edit the agent never read through its tools: no snapshot, so the edit has nothing to
    // count against; the stop reads the file at the start commit and counts there.
    await write(BEFORE.replace("    assert discount(100, 15) == 85\n", "    pass\n"))
    expect((await send({ kind: "edit", files: [TEST] })).findings).toEqual([])
    expect(summary((await send({ kind: "verify", files: [] })).findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 6,
        message: "tests/test_pricing.py:6 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
  })

  test("a Read after a shell deletion does not make the deletion the baseline", async () => {
    const { send, write } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "toolu_1" })
    await write(BEFORE.replace("    assert discount(100, 15) == 85\n", "    pass\n"))
    await send({ kind: "shell-after", files: [], toolUseId: "toolu_1" })
    await send({ kind: "touch", files: [TEST], completeRead: true })
    expect(summary((await send({ kind: "verify", files: [] })).findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 6,
        message: "tests/test_pricing.py:6 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
  })

  test("a verify against a base commit reports a removed assert", async () => {
    const { root, send, write } = await scenario()
    const base = (await headCommit(root))!
    await write(BEFORE.replace("    assert total([1, 2]) == 3\n", ""))
    const delivery = await send({ kind: "verify", files: [TEST], baseCommit: base }, null)
    expect(summary(delivery.findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 2,
        message: "tests/test_pricing.py:2 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
  })

  test("with no baseline at all the rule does not fire", async () => {
    const { send, write } = await scenario()
    await write("def test_total():\n    pass\n")
    // run --files or --all-files: nothing to compare with.
    expect((await send({ kind: "verify", files: [TEST] }, null)).findings).toEqual([])
  })

  test("a deleted test file is not covered: there is no content left to count", async () => {
    const { root, send } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await rm(path.join(root, TEST))
    await send({ kind: "edit", files: [TEST] })
    expect((await send({ kind: "verify", files: [] })).findings).toEqual([])
  })

  test("a removed rule's count is measured at touch; a project without one takes no measurement", async () => {
    const store = async (root: string) =>
      readFile(path.join(sessionDir(stateDirFor(root), "s1"), "baseline.jsonl"), "utf8")
    const counted = await scenario()
    await counted.send({ kind: "touch", files: [TEST], completeRead: true })
    expect(await store(counted.root)).toContain(`"t":"container"`)

    const plain = await scenario(BEFORE, [keepAssertions("instance")])
    await plain.send({ kind: "touch", files: [TEST], completeRead: true })
    expect(await store(plain.root)).not.toContain(`"t":"container"`)
  })

  const IGNORE = "  # rulecast-ignore: tests/keep-assertions the value is checked elsewhere"

  test("an ignore comment added on an assert is not its removal", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [TEST], completeRead: true })
    await write(BEFORE.replace("assert total([]) == 0", `assert total([]) == 0${IGNORE}`))
    await send({ kind: "edit", files: [TEST] })
    expect((await send({ kind: "verify", files: [] })).findings).toEqual([])
  })

  test("an assert already ignored at the baseline is counted there too", async () => {
    const { send, write } = await scenario(BEFORE.replace("assert total([]) == 0", `assert total([]) == 0${IGNORE}`))
    await send({ kind: "touch", files: [TEST], completeRead: true })
    // Another assert goes: one of three, not one of two.
    await write(
      BEFORE.replace("assert total([]) == 0", `assert total([]) == 0${IGNORE}`).replace(
        "    assert total([1, 2]) == 3\n",
        "",
      ),
    )
    await send({ kind: "edit", files: [TEST] })
    expect(summary((await send({ kind: "verify", files: [] })).findings)).toEqual([
      {
        rule: "tests/keep-assertions",
        line: 2,
        message: "tests/test_pricing.py:2 removes assertions (1 of 3 removed).",
        status: "new",
      },
    ])
  })
})
