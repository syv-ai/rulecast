import { describe, expect, test } from "vitest"

import { defaultDetectorSettings } from "../../../src/core/types"
import { astGrepDetector } from "../../../src/detectors/ast-grep/detector"
import { createProject } from "../../helpers/project"

describe("ast-grep detector check", () => {
  test("one ok result naming every language its rules use, sorted", async () => {
    const root = await createProject({})
    const rules = [
      {
        id: "b",
        config: await astGrepDetector.schema.parseAsync({ language: "typescript", rule: { pattern: "f($A)" } }),
      },
      {
        id: "a",
        config: await astGrepDetector.schema.parseAsync({ language: "python", rule: { pattern: "print($A)" } }),
      },
      {
        id: "c",
        config: await astGrepDetector.schema.parseAsync({ language: "python", rule: { pattern: "eval($A)" } }),
      },
    ]
    expect(
      await astGrepDetector.check!({
        rules,
        settings: defaultDetectorSettings(),
        env: process.env,
        cwd: root,
        signal: AbortSignal.timeout(20_000),
      }),
    ).toEqual([{ what: "ast-grep", level: "ok", detail: "python, typescript", rules: [] }])
  }, 30_000)
})
