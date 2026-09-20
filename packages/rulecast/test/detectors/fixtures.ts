import { chmod } from "node:fs/promises"
import path from "node:path"

import type { DetectorFixture } from "../../src/testing/detector-contract"
import { brokenTool, linkTool } from "../helpers/linters"
import { stubAgentCli } from "../helpers/llm"

const PY = "import os\n\n\ndef get(id):\n    try:\n        return fetch(id)\n    except ValueError:\n        pass\n"
const JS = 'console.log("hi")\nconst unused = 1\ndebugger\n'
const CHECKER = '#!/bin/sh\necho \'[{"file":"app/a.py","line":1,"layer":"crud"}]\'\n'

/** One fixture per built-in detector. A third-party detector supplies the same shape. */
export const DETECTOR_FIXTURES: Record<string, DetectorFixture> = {
  regex: {
    files: { "app/a.py": PY },
    config: { pattern: "except (?<exception>\\w+):" },
    matching: ["app/a.py"],
    // A pattern the schema accepts cannot fail at run time, so there is no failing case.
  },
  path: {
    files: { "app/a.py": PY },
    config: {},
    matching: ["app/a.py"],
  },
  "ast-grep": {
    files: { "app/a.py": PY },
    config: { language: "python", rule: { pattern: "fetch($$$ARGS)" } },
    matching: ["app/a.py"],
  },
  command: {
    files: { "app/a.py": PY, "check.sh": CHECKER },
    prepare: (root) => chmod(path.join(root, "check.sh"), 0o755),
    config: { run: ["./check.sh", "{{files}}"], captures: ["layer"] },
    matching: ["app/a.py"],
    failing: { config: { run: ["./no-such-command"] } },
  },
  linter: {
    files: { "src/a.js": JS },
    prepare: async (root) => {
      await linkTool(root, "oxlint")
      // A ruff that resolves but prints nonsense. Relying on ruff being absent would make this
      // fixture pass or fail depending on the machine.
      await brokenTool(root, "ruff")
    },
    config: { tool: "oxlint", rules: ["no-debugger"] },
    matching: ["src/a.js"],
    failing: { config: { tool: "ruff" }, matching: ["src/a.js"] },
  },
  llm: {
    files: { "app/a.py": PY },
    // A stub claude in the fixture's node_modules/.bin, where the provider looks first: no
    // network, no credentials, no cost, and the same answer every run.
    prepare: (root) => stubAgentCli(root, "claude", { broken: ["broken-model"] }),
    config: { model: "haiku", question: "Does this function swallow an exception?" },
    matching: ["app/a.py"],
    // The contract runs with an empty `changes` map, so app/a.py is *absent* rather than empty and
    // is sent as a whole-file judgement — an empty change set would be skipped and the contract's
    // "must produce at least one finding" case could never pass.
    //
    // The failing config names a model the stub answers unparseably, which is a per-rule error.
    // A missing binary would not do: spec §14 makes that a whole-run failure, and the contract
    // asserts one rule's failure is never reported as one.
    failing: { config: { model: "broken-model", question: "Anything." }, matching: ["app/a.py"] },
  },
}
