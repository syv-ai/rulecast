import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../../src/adapters/claude-code/adapter"
import { combineDeliveries } from "../../../src/core/delivery/combine"
import { type Delivery, type Event, type EventKind, emptyDelivery } from "../../../src/core/types"

// What rulecast itself says to the user, as against the findings and docs the developer chose
// (the developer, 2026-11-15): one short line each, `RC <level>: <message>`, no heading and no
// config path. A line from a checkout other than the session's own is tagged with its directory.

const options = { maxMatchesPerRule: 10 }
const event = (kind: EventKind): Event => ({ kind, files: [], cwd: "/project", session: { id: "s1" } }) as Event
const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({ ...emptyDelivery(), ...overrides })
const said = (value: Delivery, kind: EventKind = "verify") =>
  JSON.parse(claudeCodeAdapter.format(value, event(kind), options).stdout || "{}").systemMessage as string | undefined

describe("rulecast's own lines to the user", () => {
  test("a warning: `RC warning: …`, with no heading", () => {
    expect(
      said(delivery({ warnings: ["regex detector failed for r/x: bad pattern. Disabled for this session."] })),
    ).toBe("RC warning: regex detector failed for r/x: bad pattern. Disabled for this session.")
  })

  test("a notice: `RC note: …`, without its own `rulecast:`", () => {
    expect(
      said(delivery({ notices: ["rulecast: the agent added a rulecast-ignore comment this session: a.py:3"] })),
    ).toBe("RC note: the agent added a rulecast-ignore comment this session: a.py:3")
  })

  test("rules that did not run, at an unattended stop: one `RC error:` line", () => {
    const value = delivery({
      stop: "incomplete",
      disabled: [{ reason: "not in the cache (run rulecast install)", rules: ["python/a", "python/b"] }],
    })
    const message = JSON.parse(claudeCodeAdapter.format(value, event("verify"), options).stdout).systemMessage
    expect(message).toMatch(/^RC error: rules that did not run: /)
    expect(message).not.toContain("\n")
  })

  test("repeats at a stop that lets the agent go: `RC note: …`", () => {
    expect(said(delivery({ repeated: [{ rule: "a/r", file: "x.py" }] }))).toBe(
      "RC note: Still there from earlier stops, not repeated here: a/r (x.py).",
    )
  })

  test("several checkouts: the session's own lines untagged, another's tagged with its directory, no config path", () => {
    const own = delivery({ warnings: ["own warning"] })
    const other = delivery({ notices: ["rulecast: other notice"] })
    const combined = combineDeliveries(
      [
        { root: "/repo", delivery: own },
        { root: "/repo-worktrees/validation-rename", delivery: other },
      ],
      "/repo",
    )
    const message = said(combined)!
    expect(message).toBe("RC note [validation-rename]: other notice\nRC warning: own warning")
    expect(message).not.toContain(".rulecast-config.yaml")
  })
})
