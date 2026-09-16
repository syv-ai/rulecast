import { describe, expect, test } from "vitest"

import { selectTouchRules, selectViolationRules } from "../../../src/core/detection/select"
import { rule } from "../../helpers/rules"

const tsx = rule({ id: "tsx", files: "src/**/*.tsx" })
const verifyOnly = rule({
  id: "verify-only",
  files: "src/**/*.tsx",
  detector: { kind: "regex", config: {}, captures: [], events: ["verify"] },
})
const touchOnly = rule({ id: "touch-only", files: "src/**", on: ["touch"], detector: null, message: null })
const both = rule({ id: "both", files: "backend/**", on: ["touch", "violation"] })

describe("selectViolationRules", () => {
  test("keeps violation rules for the event with their matching files", () => {
    const files = ["src/a.tsx", "src/b.ts", "backend/x.py"]
    expect(selectViolationRules([tsx, verifyOnly, touchOnly, both], "edit", files, new Set())).toEqual([
      { rule: tsx, files: ["src/a.tsx"] },
      { rule: both, files: ["backend/x.py"] },
    ])
    expect(selectViolationRules([tsx, verifyOnly], "verify", files, new Set(["tsx"]))).toEqual([
      { rule: verifyOnly, files: ["src/a.tsx"] },
    ])
  })

  test("drops rules with no matching files", () => {
    expect(selectViolationRules([tsx], "edit", ["README.md"], new Set())).toEqual([])
  })
})

describe("selectTouchRules", () => {
  test("keeps touch rules matching a file that have not fired and are not disabled", () => {
    expect(selectTouchRules([tsx, touchOnly, both], ["src/a.tsx"], new Set(), new Set())).toEqual([touchOnly])
    expect(selectTouchRules([touchOnly, both], ["src/a.tsx", "backend/x.py"], new Set(["touch-only"]), new Set())).toEqual([both])
    expect(selectTouchRules([touchOnly], ["src/a.tsx"], new Set(), new Set(["touch-only"]))).toEqual([])
  })
})
