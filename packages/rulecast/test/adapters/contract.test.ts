import { describe, expect, test } from "vitest"

import { ADAPTERS } from "../../src/adapters"
import type { Event } from "../../src/core/types"
import { type AdapterFixture, adapterContract } from "../../src/testing/adapter-contract"
import { claudeCodePayload } from "../helpers/payloads"

const editEvent: Event = { kind: "edit", files: ["src/math.ts"], cwd: "/project", session: { id: "s1" } }

const claudeCodeAdapter = ADAPTERS.find((adapter) => adapter.name === "claude-code")!

const claudeCode: AdapterFixture = {
  payloads: [
    "post-tool-use.read.complete",
    "post-tool-use.edit",
    "stop",
    "user-prompt-submit",
    "session-start.compact",
  ].map((name) => {
    const input = claudeCodePayload(name)
    // Recorded from the adapter itself: this case pins that parsing stays stable and pure. What
    // each payload *should* parse to is asserted by hand in adapters/claude-code/parse.test.ts,
    // which stays the authority. A second adapter's fixture would be written out by hand.
    return { name, input, expected: claudeCodeAdapter.parse(input) }
  }),
  deliveries: [
    {
      name: "one new error finding",
      event: editEvent,
      delivery: {
        findings: [
          {
            rule: "no-silent-except",
            severity: "error",
            status: "new",
            file: "src/math.ts",
            line: 4,
            column: 5,
            message: "src/math.ts:4 swallows an exception.",
            count: 1,
          },
        ],
        preexistingSummary: [],
        references: [{ ref: "conventions/errors.md#swallowed", state: "full", content: "Handle it." }],
        touches: [],
        stop: null,
        warnings: ["one rule was skipped"],
        templates: {},
        omitted: { findings: [], rules: 0, preexisting: 0 },
        overflowPath: null,
      },
    },
  ],
  // An event key holding only rulecast's own groups is dropped on remove, so the second fixture
  // keeps a foreign hook — which is the case worth pinning: uninstalling rulecast must not remove
  // the user's own hooks.
  settings: [{}, { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] } }],
}

const FIXTURES: Record<string, AdapterFixture> = { "claude-code": claudeCode }

test("every adapter has a contract fixture", () => {
  expect(ADAPTERS.map((adapter) => adapter.name).sort()).toEqual(Object.keys(FIXTURES).sort())
})

for (const adapter of ADAPTERS) {
  describe(`${adapter.name} adapter contract`, () => {
    for (const contractCase of adapterContract(adapter, FIXTURES[adapter.name]!)) {
      test(contractCase.name, () => contractCase.run())
    }
  })
}
