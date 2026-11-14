import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"

import * as gitModule from "../../../src/core/git"
import { namedPaths, uncheckedCheckouts, untold } from "../../../src/core/session/elsewhere"
import { createRepo, git } from "../../helpers/git"

vi.mock("../../../src/core/git", { spy: true })

describe("namedPaths (#71)", () => {
  const cwd = "/repo/.claude/worktrees/lead"
  const home = "/home/dev"

  test("cd, pushd and git -C targets, relative ones from cwd, ~ from home", () => {
    expect(namedPaths("cd ../w1-m && sed -i 's/a/b/' x.py", cwd, home)).toEqual([
      "/repo/.claude/worktrees/w1-m",
      "/repo/.claude/worktrees/lead/s/a/b",
    ])
    expect(namedPaths("pushd ~/repos/c/.claude/worktrees/w2 >/dev/null", cwd, home)).toEqual([
      "/home/dev/repos/c/.claude/worktrees/w2",
    ])
    expect(namedPaths('git -C "/repo/.claude/worktrees/w3" status', cwd, home)).toEqual(["/repo/.claude/worktrees/w3"])
    expect(namedPaths("cd -- ../w5 && make -C ../w6", cwd, home)).toEqual([
      "/repo/.claude/worktrees/w5",
      "/repo/.claude/worktrees/w6",
    ])
  })

  test("absolute, ~ and relative paths anywhere in the command, /tmp included", () => {
    expect(namedPaths("python3 /repo/.claude/worktrees/w4/tools/gen.py > ~/out.txt", cwd, home)).toEqual([
      "/repo/.claude/worktrees/w4/tools/gen.py",
      "/home/dev/out.txt",
    ])
    expect(namedPaths("sed -i s/a/b/ ../w1/x.py && cp /tmp/wt/a.py .", cwd, home)).toEqual([
      "/repo/.claude/worktrees/lead/s/a/b",
      "/repo/.claude/worktrees/w1/x.py",
      "/tmp/wt/a.py",
    ])
    expect(namedPaths("cat .claude/worktrees/x/b.py", "/repo", home)).toEqual(["/repo/.claude/worktrees/x/b.py"])
  })

  test("paths built from variables, /dev, and paths in quoted text are left out", () => {
    expect(namedPaths('cd "$W/$wt" && make 2>/dev/null', cwd, home)).toEqual([])
    expect(namedPaths('git commit -m "port the fix from /repo/w1/x.py" && echo "cd /repo/w2"', cwd, home)).toEqual([])
    expect(namedPaths('cat "/repo/w1/x.py"', cwd, home)).toEqual(["/repo/w1/x.py"])
    expect(namedPaths("cat > notes.md <<'EOF'\nsee /repo/w1/x.py\n  and ../w2/y.py\nEOF\nls", cwd, home)).toEqual([])
    expect(namedPaths("cat <<-END | tee out\n\t/repo/w1/x.py\n\tEND", cwd, home)).toEqual([])
  })
})

describe("uncheckedCheckouts", () => {
  test("a command that names only places in the current checkout does not ask git", async () => {
    const root = await createRepo({ "a.py": "" })
    const spy = vi.mocked(gitModule.git)
    spy.mockClear()
    expect(await uncheckedCheckouts(`cd ${path.join(root, "pkg")} && ls ./src ${root}/a.py`, root, [])).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  test("a command that names places outside every checkout does not ask git", async () => {
    const root = await createRepo({ "a.py": "" })
    const outside = await mkdtemp(path.join(tmpdir(), "rulecast-plain-"))
    const spy = vi.mocked(gitModule.git)
    spy.mockClear()
    expect(await uncheckedCheckouts(`ls ${outside} /tmp && cat ${outside}/.npmrc`, root, [])).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("uncheckedCheckouts: which checkouts", () => {
  test("a checkout on a branch is reported; a detached one, such as a gate's throwaway copy, is not", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": "repos: []\n", "a.py": "" })
    const branch = `${root}-w1`
    const copy = `${root}-gate`
    await git(root, "worktree", "add", "-q", "-b", "w1", branch)
    await git(root, "worktree", "add", "-q", "--detach", copy)
    expect(await uncheckedCheckouts(`cd ${copy} && uv sync && pytest`, root, [])).toEqual([])
    expect(await uncheckedCheckouts(`cd ${branch} && pytest`, root, [])).toEqual([await realpath(branch)])
  })
})

describe("untold", () => {
  test("concurrent calls tell a checkout once", async () => {
    const cache = await mkdtemp(path.join(tmpdir(), "rulecast-cache-"))
    const told = await Promise.all(Array.from({ length: 8 }, () => untold(cache, "s", "main", ["/w1"])))
    expect(told.flat()).toEqual(["/w1"])
    expect(await untold(cache, "s", "sub1", ["/w1"])).toEqual(["/w1"])
    expect(await untold(cache, "s", "main", ["/w1", "/w2"])).toEqual(["/w2"])
  })
})
