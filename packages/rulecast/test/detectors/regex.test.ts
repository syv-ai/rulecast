import { describe, expect, test } from "vitest"

import { memoryCache } from "../../src/core/detection/cache"
import { defaultDetectorSettings } from "../../src/core/types"
import { regexDetector } from "../../src/detectors/regex"
import { createProject } from "../helpers/project"

describe("regex detector", () => {
  test("schema applies default flags and rejects invalid patterns", () => {
    expect(regexDetector.schema.parse({ pattern: "a" })).toEqual({ pattern: "a", flags: "" })
    expect(regexDetector.schema.safeParse({ pattern: "(" }).success).toBe(false)
    expect(regexDetector.schema.safeParse({ pattern: "a", flags: "x" }).success).toBe(false)
  })

  test("captures are the pattern's named groups", () => {
    expect(regexDetector.captures({ pattern: "(?<name>\\w+)(?<=x)(?<args>.*)", flags: "" })).toEqual(["name", "args"])
    expect(regexDetector.events({ pattern: "a", flags: "" })).toEqual(["edit", "verify"])
  })

  test("reports every match with positions and captures", async () => {
    const cwd = await createProject({
      "app/services/users.py": "def get():\n    raise HTTPException(404)\n    raise HTTPException(\n        403)\n",
    })
    const result = await regexDetector.run({
      event: "edit",
      rules: [
        {
          id: "no-httpexception",
          config: regexDetector.schema.parse({ pattern: "raise HTTPException\\((?<args>[^)]*)\\)" }),
          files: ["app/services/users.py", "app/services/deleted.py"],
          context: [],
        },
      ],
      changes: new Map(),
      cache: memoryCache(),
      settings: defaultDetectorSettings(),
      cwd,
      signal: new AbortController().signal,
    })
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 2,
          endLine: 2,
          column: 5,
          text: "raise HTTPException(404)",
          captures: { args: "404" },
        },
      },
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 3,
          endLine: 4,
          column: 5,
          text: "raise HTTPException(\n        403)",
          captures: { args: "\n        403" },
        },
      },
    ])
  })
})
