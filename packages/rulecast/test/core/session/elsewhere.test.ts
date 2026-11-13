import { describe, expect, test } from "vitest"

import { namedPaths } from "../../../src/core/session/elsewhere"

describe("namedPaths (#71)", () => {
  const cwd = "/repo/.claude/worktrees/lead"
  const home = "/home/dev"

  test("cd, pushd and git -C targets, relative ones from cwd, ~ from home", () => {
    expect(namedPaths("cd ../w1-m && sed -i 's/a/b/' x.py", cwd, home)).toEqual(["/repo/.claude/worktrees/w1-m"])
    expect(namedPaths("pushd ~/repos/c/.claude/worktrees/w2 >/dev/null", cwd, home)).toEqual([
      "/home/dev/repos/c/.claude/worktrees/w2",
    ])
    expect(namedPaths('git -C "/repo/.claude/worktrees/w3" status', cwd, home)).toEqual(["/repo/.claude/worktrees/w3"])
  })

  test("absolute and ~ paths anywhere in the command", () => {
    expect(namedPaths("python3 /repo/.claude/worktrees/w4/tools/gen.py > ~/out.txt", cwd, home)).toEqual([
      "/repo/.claude/worktrees/w4/tools/gen.py",
      "/home/dev/out.txt",
    ])
  })

  test("paths built from variables, /dev and /tmp are left out", () => {
    expect(namedPaths('cd "$W/$wt" && make 2>/dev/null; cp a /tmp/b', cwd, home)).toEqual([])
  })
})
