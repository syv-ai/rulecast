import path from "node:path"
import { describe, expect, test } from "vitest"

import { findRoot, hasProject, toProjectPath } from "../../src/commands/project"
import { createProject } from "../helpers/project"

describe("project paths", () => {
  test("findRoot walks up to the nearest directory containing .rulecast-config.yaml", async () => {
    const root = await createProject({ ".rulecast-config.yaml": "repos: []\n", "app/deep/x.py": "" })
    expect(findRoot(path.join(root, "app/deep"))).toBe(root)
    const bare = await createProject({ "x.py": "" })
    expect(findRoot(bare)).toBe(bare)
  })

  test("hasProject is true only where .rulecast-config.yaml exists", async () => {
    expect(hasProject(await createProject({ ".rulecast-config.yaml": "repos: []\n" }))).toBe(true)
    expect(hasProject(await createProject({ ".rulecast/config.yml": "" }))).toBe(false)
    expect(hasProject(await createProject({ "x.py": "" }))).toBe(false)
  })

  test("toProjectPath makes paths repo-relative and rejects paths outside the root", () => {
    expect(toProjectPath("/repo", "/repo/src", "a.ts")).toBe("src/a.ts")
    expect(toProjectPath("/repo", "/anywhere", "/repo/app/x.py")).toBe("app/x.py")
    expect(toProjectPath("/repo", "/repo", "..config/x")).toBe("..config/x")
    expect(toProjectPath("/repo", "/repo", "/elsewhere/x.py")).toBeNull()
    expect(toProjectPath("/repo", "/repo/src", "../..")).toBeNull()
    expect(toProjectPath("/repo", "/repo", "/repo")).toBeNull()
  })
})
