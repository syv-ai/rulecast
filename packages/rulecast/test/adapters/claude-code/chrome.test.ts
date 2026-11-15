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
      "checkout",
    )
    const message = said(combined)!
    expect(message).toBe("RC note [validation-rename]: other notice\nRC warning: own warning")
    expect(message).not.toContain(".rulecast-config.yaml")
  })
})

describe("what a line is tagged with, and what it leaves out (review of 7a64b2a)", () => {
  const tagged = (roots: string[], from: string) =>
    said(
      combineDeliveries(
        roots.map((root, index) => ({ root, delivery: delivery({ warnings: [`w${index}`] }) })),
        from,
        "checkout",
      ),
    )

  test("one part beside the agent is tagged too", () => {
    expect(tagged(["/repo/backend"], "/repo/frontend")).toBe("RC warning [backend]: w0")
  })

  test("from a worktree under the main checkout, the main checkout is another checkout", () => {
    expect(tagged(["/repo", "/repo/.claude/worktrees/wt1"], "/repo/.claude/worktrees/wt1")).toBe(
      "RC warning [repo]: w0\nRC warning: w1",
    )
  })

  test("two checkouts with one name are told apart by their path", () => {
    expect(tagged(["/a/pkg", "/b/pkg"], "/c")).toBe("RC warning [a/pkg]: w0\nRC warning [b/pkg]: w1")
  })

  test("a warning whose own text starts with brackets is not read as a tag", () => {
    expect(said(delivery({ warnings: ["[x] y.py: rulecast-ignore needs a reason"] }))).toBe(
      "RC warning: [x] y.py: rulecast-ignore needs a reason",
    )
  })

  test("a warning of several lines is said on one", () => {
    expect(said(delivery({ warnings: ["3 rules failed to compile.\nFirst: r/x: bad"] }))).toBe(
      "RC warning: 3 rules failed to compile. First: r/x: bad",
    )
  })

  test("a summary's first compile problem names its rule too", () => {
    expect(
      said(
        delivery({
          warnings: ["3 rules failed to compile — run rulecast validate.\nFirst: .rulecast-config.yaml (r/x): bad"],
        }),
      ),
    ).toBe("RC warning: 3 rules failed to compile — run rulecast validate. First: rule r/x: bad")
  })

  test("the main checkout and another checkout of one name: told apart, the one above by its parent", () => {
    expect(tagged(["/work/repo", "/other/repo"], "/work/repo/.claude/worktrees/wt1")).toBe(
      "RC warning [work/repo]: w0\nRC warning [other/repo]: w1",
    )
  })

  test("a compile problem names its rule, not its config's path", () => {
    expect(
      said(delivery({ warnings: ["../wt/.rulecast-config.yaml (r/x): name: required (run rulecast validate)"] })),
    ).toBe("RC warning: rule r/x: name: required (run rulecast validate)")
  })
})
