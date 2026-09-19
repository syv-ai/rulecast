import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { type Env, projectStateDir } from "../../src/core/home"

/** One cache home per test file (vitest isolates modules per file), so tests never touch ~/.cache/rulecast. */
export const TEST_HOME: string = mkdtempSync(path.join(tmpdir(), "rulecast-home-"))

export const testEnv: Env = { RULECAST_HOME: TEST_HOME }

/** The state directory rulecast uses for a test project. */
export function stateDirFor(root: string): string {
  return projectStateDir(TEST_HOME, root)
}
