import { describe, expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { pastDeadline } from "../../src/core/detection/per-rule"
import { DeadlineError } from "../../src/core/errors"
import { type DetectorRun, defaultDetectorSettings } from "../../src/core/types"
import { astGrepDetector } from "../../src/detectors/ast-grep/detector"

/**
 * Spec §13 and §14: an error raised after `deadlineAt` has passed is the clock, not the rule. The
 * core records it as a timeout — logged on edit, tried again at the next verify. A rule error is a
 * different thing: `pipeline.ts` appends a `disabled` record, which switches the rule off for the
 * rest of the session and marks the run failed.
 *
 * `signal` alone cannot tell the two apart. Its abort timer only runs when the event loop is free,
 * and synchronous work is what keeps it busy — `ast-grep` parses in native code that no timeout
 * interrupts (`detection/budget.ts`, `guard.ts`). So a detector that checks only `signal.aborted`
 * reports a deadline overrun as a rule error.
 *
 * Measured before this test existed, with the deadline already past and the signal not yet fired:
 * `path` and `regex` rethrew; `ast-grep` returned a rule error. `linter` and `llm` have the same
 * shape at `detector.ts:102` and `:180` but await a subprocess or an HTTP call, so the loop is free
 * and their `signal.aborted` is accurate — latent, not live. All four now ask `pastDeadline`.
 */

const aborted = () => {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const open = () => new AbortController().signal

describe("pastDeadline", () => {
  test("a DeadlineError is the clock whatever the time says", () => {
    expect(pastDeadline(new DeadlineError("interrupted"), { signal: open(), deadlineAt: Date.now() + 60_000 })).toBe(
      true,
    )
  })

  test("an aborted signal is the clock", () => {
    expect(pastDeadline(new Error("anything"), { signal: aborted(), deadlineAt: Date.now() + 60_000 })).toBe(true)
  })

  test("a passed wall clock is the clock, even with the signal still open", () => {
    // This is the case the signal cannot see, and the reason this predicate exists.
    expect(pastDeadline(new Error("anything"), { signal: open(), deadlineAt: Date.now() - 1 })).toBe(true)
  })

  test("an ordinary error inside the deadline is the rule", () => {
    expect(pastDeadline(new Error("bad pattern"), { signal: open(), deadlineAt: Date.now() + 60_000 })).toBe(false)
  })
})

/** An ast-grep run whose `read` throws: the one failure that is reachable without a parser or a tool. */
function run(deadlineAt: number): DetectorRun<never> {
  return {
    event: "edit",
    rules: [
      {
        id: "deadline/ast-grep",
        config: { language: "typescript", rule: { pattern: "foo($A)" } },
        files: ["a.ts"],
        context: [],
      },
    ],
    read: async () => {
      throw new Error("read blew up")
    },
    changes: new Map(),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd: process.cwd(),
    // Never aborted: the timer never got a turn, because the work blocked the loop.
    signal: open(),
    deadlineAt,
  } as unknown as DetectorRun<never>
}

describe("ast-grep past its deadline", () => {
  test("rejects when the deadline has passed and the signal has not fired", async () => {
    // Rejecting is what lets the core record a timeout. Returning a DetectorResult carrying the
    // error would disable the rule for the rest of the session.
    await expect(astGrepDetector.run(run(Date.now() - 1_000))).rejects.toThrow("read blew up")
  })

  test("still reports an ordinary failure as a rule error", async () => {
    // The companion case: the fix must not turn every failure into a timeout.
    const result = await astGrepDetector.run(run(Date.now() + 60_000))
    expect(result.errors).toEqual([{ rule: "deadline/ast-grep", message: "read blew up" }])
    expect(result.findings).toEqual([])
  })
})
