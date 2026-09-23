import { expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { defaultDetectorSettings } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { pathDetector } from "../../src/detectors/path"
import { createProject, fromDisk } from "../helpers/project"

test("path detector matches each existing file across all its lines", async () => {
  const cwd = await createProject({ "src/client/api.ts": "export const a = 1\nexport const b = 2\n" })
  expect(pathDetector.schema.safeParse({ extra: true }).success).toBe(false)
  expect(pathDetector.captures({})).toEqual([])
  const result = await pathDetector.run({
    event: "edit",
    rules: [{ id: "no-generated-edits", config: {}, files: ["src/client/api.ts", "src/client/gone.ts"], context: [] }],
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal: new AbortController().signal,
  })
  expect(result).toEqual({
    findings: [
      {
        rule: "no-generated-edits",
        match: { file: "src/client/api.ts", line: 1, endLine: 3, column: 1, text: "src/client/api.ts", captures: {} },
      },
    ],
    errors: [],
  })
})

test("built-in detectors have unique kinds", () => {
  expect(builtinDetectors.map((detector) => detector.kind)).toEqual([
    "regex",
    "path",
    "ast-grep",
    "command",
    "linter",
    "llm",
  ])
})
