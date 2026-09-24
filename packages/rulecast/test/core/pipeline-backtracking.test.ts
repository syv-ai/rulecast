import { describe, expect, test } from "vitest"

import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

/**
 * Spec §13: when `edit_deadline_ms` passes, the core aborts outstanding detector runs and delivers
 * what finished. It could not, for any detector whose work is synchronous.
 *
 * `run.ts` enforces the deadline with `Promise.race([detector.run(…), deadline])`, and `deadline`
 * resolves from a `setTimeout`. A timer only fires when the event loop is free, and `regex` ran
 * `text.matchAll(…)` synchronously — so the deadline could not fire, and the detector's own promise
 * then won the race in a microtask, ahead of the queued timer. The hook reported a clean, on-time
 * run at twenty times its budget.
 *
 * Measured before the fix: 350 ms deadline, 30 `a`s, no completion inside a 30 second watchdog on
 * both the edit path and the `PreToolUse` guard, where it holds up the agent's write.
 *
 * `(a+)+$` against a string of `a`s with no trailing match is the textbook exponential backtrack:
 * the engine tries every partition of the run of `a`s before giving up.
 */
const CATASTROPHIC = "(a+)+$"
const SUBJECT = `${"a".repeat(30)}b\n`
const DEADLINE_MS = 250

/** Generous: the point is bounded versus unbounded, not the exact overshoot. */
const LIMIT_MS = 5_000

async function repo(refuseWrite: boolean) {
  return createRepo({
    ".rulecast-config.yaml": localConfig(
      [
        {
          id: "evil/backtrack",
          name: "Catastrophic backtracking",
          files: "\\.txt$",
          ...(refuseWrite ? { refuse_write: true } : {}),
          detect: { regex: { pattern: CATASTROPHIC } },
          message: "{{file}}:{{line}}",
        },
      ],
      { timeouts: { edit_deadline_ms: DEADLINE_MS, verify_ms: DEADLINE_MS } },
    ),
    "victim.txt": SUBJECT,
  })
}

describe("a regex that backtracks exponentially", () => {
  test("cannot hold the edit hook past its deadline", { timeout: 60_000 }, async () => {
    const root = await repo(false)
    const started = performance.now()
    const result = await pipelineAt(root, { kind: "edit", files: ["victim.txt"], cwd: root, session: { id: "s1" } })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(LIMIT_MS)
    // Dropped at the deadline is logged, not delivered as a warning, and never disables the rule.
    expect(result.deadlineMissed).toEqual(["regex"])
    expect(result.failed).toBe(false)
  })

  test("cannot hold the guard open, so the agent's write is never blocked indefinitely", {
    timeout: 60_000,
  }, async () => {
    const root = await repo(true)
    const started = performance.now()
    const { delivery } = await pipelineAt(root, {
      kind: "guard",
      files: ["victim.txt"],
      intent: { content: SUBJECT },
      cwd: root,
      session: { id: "s1" },
    })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(LIMIT_MS)
    // The guard fails open: a detector that could not finish leaves the write alone (§9).
    expect(delivery.findings).toEqual([])
  })

  test("a verify says the timeout was hit and names the setting to raise", { timeout: 60_000 }, async () => {
    const root = await repo(false)
    const started = performance.now()
    const result = await pipelineAt(root, { kind: "verify", files: ["victim.txt"], cwd: root })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(LIMIT_MS)
    expect(result.failed).toBe(true)
    expect(result.delivery.warnings.join(" ")).toContain("timeouts.verify_ms")
  })
})

test("an ordinary pattern still finds every match it should", async () => {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig([
      {
        id: "ok/compute",
        name: "No bare compute",
        files: "\\.ts$",
        detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
        message: "{{file}}:{{line}} calls compute({{n}})",
      },
    ]),
    "src/app.ts": "compute(1)\ncompute(22)\nnothing\ncompute(333)\n",
  })
  const result = await pipelineAt(root, { kind: "verify", files: ["src/app.ts"], cwd: root })

  expect(result.delivery.findings.map((finding) => [finding.line, finding.captures?.n])).toEqual([
    [1, "1"],
    [2, "22"],
    [4, "333"],
  ])
})
