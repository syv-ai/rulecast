import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { stripRunnerFraming } from "../../../src/detectors/hook/framing"

const payloads = fileURLToPath(new URL("../../payloads/hook/", import.meta.url))
const payload = (name: string) => readFileSync(payloads + name, "utf8")

describe("stripRunnerFraming", () => {
  for (const runner of ["pre-commit", "prek"] as const) {
    test(`${runner}: a failed hook gives its exit code and the tool's own lines, unindented`, () => {
      const framed = stripRunnerFraming(payload(`${runner}.findings.txt`), runner)
      expect(framed.status).toBe("failed")
      expect(framed.exitCode).toBe(1)
      expect(framed.modified).toBe(false)
      const lines = framed.output.split("\n").filter((line) => line !== "")
      expect(lines).toHaveLength(6)
      expect(lines[0]).toMatch(/^s\.sh:2:8: warning: /)
    })

    test(`${runner}: a skipped hook ran nothing`, () => {
      const framed = stripRunnerFraming(payload(`${runner}.skipped.txt`), runner)
      expect(framed.status).toBe("skipped")
      expect(framed.output.trim()).toBe("")
    })

    test(`${runner}: an unknown hook id has no status line at all`, () => {
      const framed = stripRunnerFraming(payload(`${runner}.unknown.txt`), runner)
      expect(framed.status).toBeNull()
      expect(framed.output).toMatch(/No hook/)
    })

    test(`${runner}: a fixer's output is kept`, () => {
      const framed = stripRunnerFraming(payload(`${runner}.modified.txt`), runner)
      expect(framed.status).toBe("failed")
      expect(framed.output.trim()).toBe("Fixing t3.txt")
    })
  }

  test("prek says when the hook modified files", () => {
    expect(stripRunnerFraming(payload("prek.modified.txt"), "prek").modified).toBe(true)
  })

  test("pre-commit's environment set-up lines are framing too", () => {
    const text = "[INFO] Initializing environment for local.\nmypy....Passed\n"
    expect(stripRunnerFraming(text, "pre-commit")).toMatchObject({ status: "passed", output: "" })
  })
})
