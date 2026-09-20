import { chmod } from "node:fs/promises"
import path from "node:path"

import type { DetectorFixture } from "../../src/testing/detector-contract"
import { linkTool } from "../helpers/linters"

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
    prepare: (root) => linkTool(root, "oxlint"),
    config: { tool: "oxlint", rules: ["no-debugger"] },
    matching: ["src/a.js"],
    // ruff is not a workspace devDependency, so the rule cannot resolve its tool.
    failing: { config: { tool: "ruff" }, matching: ["src/a.js"] },
  },
}
