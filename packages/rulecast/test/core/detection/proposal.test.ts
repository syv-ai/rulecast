import { describe, expect, test } from "vitest"

import { isInserted, propose } from "../../../src/core/detection/proposal"
import type { Match } from "../../../src/core/types"

const FILE = "def get(x):\n    return x\n"

const at = (line: number, column: number, text: string): Match => ({
  file: "a.py",
  line,
  endLine: line,
  column,
  text,
  captures: {},
})

describe("propose", () => {
  test("a whole-file write is the payload, all of it inserted", () => {
    expect(propose(FILE, { content: "new\n" })).toEqual({ content: "new\n", inserts: [[0, 4]] })
  })

  test("an empty write inserts nothing", () => {
    expect(propose(FILE, { content: "" })).toEqual({ content: "", inserts: [] })
  })

  test("an edit replaces the one occurrence and reports where the new text landed", () => {
    const proposal = propose(FILE, { edit: { find: "return x", replace: "raise Boom()", all: false } })
    expect(proposal?.content).toBe("def get(x):\n    raise Boom()\n")
    const [[start, end]] = proposal!.inserts as [[number, number]]
    expect(proposal!.content.slice(start, end)).toBe("raise Boom()")
  })

  test("replace_all reports every occurrence", () => {
    const proposal = propose("a\na\na\n", { edit: { find: "a", replace: "bb", all: true } })
    expect(proposal?.content).toBe("bb\nbb\nbb\n")
    expect(proposal?.inserts).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ])
  })

  test("a deletion inserts nothing, so there is nothing a rule could fire on", () => {
    expect(propose(FILE, { edit: { find: "    return x\n", replace: "", all: false } })?.inserts).toEqual([])
  })

  describe("gives up rather than guess", () => {
    test("when old_string is not in the file", () => {
      expect(propose(FILE, { edit: { find: "nowhere", replace: "x", all: false } })).toBeNull()
    })

    test("when old_string appears twice and replace_all was not asked for", () => {
      expect(propose("a\na\n", { edit: { find: "a", replace: "b", all: false } })).toBeNull()
    })

    test("when the file does not exist yet but the tool means to edit one", () => {
      expect(propose(null, { edit: { find: "a", replace: "b", all: false } })).toBeNull()
    })

    test("when the tool call says nothing about what it writes", () => {
      expect(propose(FILE, {})).toBeNull()
    })
  })
})

describe("isInserted", () => {
  const proposal = propose("x = 1\ny = 2\nz = 3\n", { edit: { find: "y = 2", replace: "y = boom()", all: false } })!

  test("a match inside the inserted text is the agent's own", () => {
    expect(isInserted(proposal, at(2, 5, "boom()"), "regex")).toBe(true)
  })

  test("a match elsewhere in the file is not, even though the write produces it", () => {
    expect(isInserted(proposal, at(3, 1, "z = 3"), "regex")).toBe(false)
  })

  test("sharing a line with the insert is not enough", () => {
    // The edit adds "boom()" inside line 2; "call(" before it on the same line is not the agent's.
    const midLine = propose("x = 1\ncall(old)\n", { edit: { find: "old", replace: "boom()", all: false } })!
    expect(isInserted(midLine, at(2, 6, "boom()"), "regex")).toBe(true)
    expect(isInserted(midLine, at(2, 1, "call("), "regex")).toBe(false)
  })

  test("a path match is the file itself, and writing the file is what the rule forbids", () => {
    expect(isInserted(proposal, at(1, 1, "src/client/api.ts"), "path")).toBe(true)
  })
})
