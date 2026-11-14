import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  configRootsAbove,
  configRootsBelow,
  displayPath,
  projectsForEvent,
  projectsForFiles,
  recordSessionRoots,
  sessionRoots,
} from "../../src/core/projects"
import { createRepo, git } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { createProject } from "../helpers/project"

const CONFIG = ".rulecast-config.yaml"
const config = "repos: []\n"
/** A user home directory that is none of the fixtures' ancestors. */
const NO_HOME = "/nonexistent-home"

describe("configRootsAbove", () => {
  test("every ancestor holding a config, nearest first", async () => {
    const root = await createProject({ [CONFIG]: config, [`pkg/${CONFIG}`]: config, "pkg/src/x.py": "" })
    expect(configRootsAbove(path.join(root, "pkg/src"), NO_HOME)).toEqual([path.join(root, "pkg"), root])
    expect(configRootsAbove(root, NO_HOME)).toEqual([root])
  })

  test("stops above a worktree only at another checkout of the same repository", async () => {
    const repo = await createRepo({ [CONFIG]: config })
    // A worktree nested in its own repository, as Claude Code makes them.
    const worktree = path.join(repo, ".claude/worktrees/x")
    await git(repo, "worktree", "add", "-q", "-b", "x", worktree)
    expect(configRootsAbove(path.join(worktree, "src"), NO_HOME)).toEqual([worktree])
    expect(configRootsAbove(repo, NO_HOME)).toEqual([repo])
  })

  test("a bare repository's directory is no checkout: its config applies to the worktrees below it", async () => {
    const source = await createRepo({ "a.py": "" })
    // The "bare repo plus worktrees" layout: proj/.bare, proj/.git naming it, a worktree per branch.
    const proj = await createProject({ [CONFIG]: config })
    await git(proj, "clone", "-q", "--bare", source, ".bare")
    await writeFile(path.join(proj, ".git"), "gitdir: ./.bare\n")
    await git(proj, "worktree", "add", "-q", "w1", "main")
    const w1 = path.join(proj, "w1")
    expect(configRootsAbove(w1, NO_HOME)).toEqual([proj])
    // A worktree nested in one of them is still its own checkout: w1's config does not reach it.
    await writeFile(path.join(w1, CONFIG), config)
    const nested = path.join(w1, ".claude/worktrees/x")
    await git(w1, "worktree", "add", "-q", "-b", "x", nested)
    expect(configRootsAbove(nested, NO_HOME)).toEqual([proj])
    expect(configRootsAbove(w1, NO_HOME)).toEqual([w1, proj])
  })

  test("a nested repository and a submodule keep the configs above them", async () => {
    // A home directory kept in git for its dotfiles, with a config and a repository under it.
    const home = await createRepo({ [`work/${CONFIG}`]: config, ".bashrc": "" })
    const project = path.join(home, "work/project")
    await mkdir(project, { recursive: true })
    await git(project, "init", "-q")
    expect(configRootsAbove(project, NO_HOME)).toEqual([path.join(home, "work")])
    // A submodule's .git names a git directory of its own inside the superproject's.
    const superproject = await createRepo({ [CONFIG]: config })
    const submodule = path.join(superproject, "vendor/lib")
    await mkdir(path.join(superproject, ".git/modules"), { recursive: true })
    await git(superproject, "init", "-q", "--separate-git-dir", path.join(superproject, ".git/modules/lib"), submodule)
    expect(configRootsAbove(submodule, NO_HOME)).toEqual([superproject])
  })

  test("a config in the home directory counts only from the home directory", async () => {
    const home = await createProject({ [CONFIG]: config, "code/repo/x.py": "" })
    expect(configRootsAbove(path.join(home, "code/repo"), home)).toEqual([])
    expect(configRootsAbove(home, home)).toEqual([home])
  })
})

describe("projectsForFiles", () => {
  test("a file under a top config and a package config maps to both, each relative to its root", async () => {
    const root = await createProject({ [CONFIG]: config, [`pkg/${CONFIG}`]: config, "pkg/src/x.py": "" })
    const projects = projectsForFiles(path.join(root, "pkg"), ["src/x.py"], NO_HOME)
    expect([...projects]).toEqual([
      [path.join(root, "pkg"), ["src/x.py"]],
      [root, ["pkg/src/x.py"]],
    ])
  })

  test("a file under no config is dropped", async () => {
    const root = await createProject({ [`pkg/${CONFIG}`]: config, "pkg/a.py": "", "other/b.py": "" })
    const projects = projectsForFiles(root, ["other/b.py", path.join(root, "pkg/a.py")], NO_HOME)
    expect([...projects]).toEqual([[path.join(root, "pkg"), ["a.py"]]])
  })
})

describe("configRootsBelow", () => {
  test("finds configs below, tracked or not, but not gitignored ones", async () => {
    const root = await createRepo({ [CONFIG]: config, [`a/${CONFIG}`]: config, ".gitignore": "ignored/\n" })
    await createAt(root, { [`b/${CONFIG}`]: config, [`ignored/${CONFIG}`]: config })
    expect(await configRootsBelow(root)).toEqual([path.join(root, "a"), path.join(root, "b")])
  })

  test("the top config is not below itself, and a config deleted on disk but still indexed is dropped", async () => {
    const root = await createRepo({ [CONFIG]: config, [`a/${CONFIG}`]: config, [`gone/${CONFIG}`]: config })
    await rm(path.join(root, "gone", CONFIG))
    expect(await configRootsBelow(root)).toEqual([path.join(root, "a")])
    expect(await configRootsBelow(path.join(root, "a"))).toEqual([])
  })

  test("outside a git repository there is nothing below", async () => {
    const root = await createProject({ [CONFIG]: config, [`a/${CONFIG}`]: config })
    expect(await configRootsBelow(root)).toEqual([])
  })
})

describe("session roots", () => {
  test("recorded roots read back once each, in order; concurrent appends all land", async () => {
    const cache = await mkdtemp(path.join(tmpdir(), "rulecast-cache-"))
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordSessionRoots(cache, "s/../1", "main", [`/r${i}`])))
    await recordSessionRoots(cache, "s/../1", "main", ["/r0"])
    const roots = await sessionRoots(cache, "s/../1")
    expect(roots).toHaveLength(20)
    expect(new Set(roots)).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `/r${i}`)))
    expect(await sessionRoots(cache, "other")).toEqual([])
  })

  test("each root is recorded for the agent that ran it", async () => {
    const cache = await mkdtemp(path.join(tmpdir(), "rulecast-cache-"))
    await recordSessionRoots(cache, "s", "main", ["/lead"])
    await recordSessionRoots(cache, "s", "sub1", ["/w1", "/lead"])
    expect(await sessionRoots(cache, "s")).toEqual(["/lead", "/w1"])
    expect(await sessionRoots(cache, "s", "main")).toEqual(["/lead"])
    expect(await sessionRoots(cache, "s", "sub1")).toEqual(["/w1", "/lead"])
  })
})

describe("projectsForEvent", () => {
  test("a session start finds configs above and below the launch dir and records them", async () => {
    const root = await createRepo({ [CONFIG]: config, [`frontend/${CONFIG}`]: config, [`backend/${CONFIG}`]: config })
    const event = {
      cwd: root,
      launchDir: path.join(root, "frontend"),
      sessionId: "start-1",
      agent: "main",
      kind: "start" as const,
    }
    expect((await projectsForEvent(event, TEST_HOME, NO_HOME)).own).toEqual([path.join(root, "frontend"), root])
    expect(await sessionRoots(TEST_HOME, "start-1")).toEqual([path.join(root, "frontend"), root])
    const top = { ...event, launchDir: root, sessionId: "start-2" }
    expect((await projectsForEvent(top, TEST_HOME, NO_HOME)).own).toEqual([
      root,
      path.join(root, "backend"),
      path.join(root, "frontend"),
    ])
  })

  test("a Stop includes a root recorded by an earlier edit outside the launch dir", async () => {
    const root = await createRepo({ [CONFIG]: config, [`frontend/${CONFIG}`]: config, [`backend/${CONFIG}`]: config })
    const launchDir = path.join(root, "frontend")
    const edited = projectsForFiles(launchDir, ["../backend/x.py"], NO_HOME)
    await recordSessionRoots(TEST_HOME, "stop-1", "main", [...edited.keys()])
    const stop = { cwd: launchDir, launchDir, sessionId: "stop-1", agent: "main", kind: "verify" as const }
    expect(await projectsForEvent(stop, TEST_HOME, NO_HOME)).toEqual({
      own: [launchDir, root, path.join(root, "backend")],
      subagents: [],
    })
  })

  test("other events add the configs above cwd after a cd, deduplicated, and record nothing", async () => {
    const root = await createProject({ [CONFIG]: config, [`pkg/${CONFIG}`]: config })
    const event = {
      cwd: path.join(root, "pkg"),
      launchDir: root,
      sessionId: "cd-1",
      agent: "main",
      kind: "prompt" as const,
    }
    expect((await projectsForEvent(event, TEST_HOME, NO_HOME)).own).toEqual([path.join(root, "pkg"), root])
    expect(await projectsForEvent({ ...event, kind: "shell-after" }, TEST_HOME, NO_HOME)).toEqual({
      own: [path.join(root, "pkg"), root],
      subagents: [],
    })
    // Roots are recorded from edits and from shell calls that changed files (commands/hook.ts), not here.
    expect(await sessionRoots(TEST_HOME, "cd-1")).toEqual([])
  })

  test("a subagent in the session's tree reaches the configs the start found below its cwd, not beyond", async () => {
    const root = await createRepo({ [`packages/a/${CONFIG}`]: config, [`packages/b/${CONFIG}`]: config })
    const of = (agent: string, cwd: string, kind: "start" | "shell-after" | "verify") =>
      projectsForEvent({ cwd, launchDir: root, sessionId: "below-1", agent, kind }, TEST_HOME, NO_HOME)
    await of("main", root, "start")
    const packages = [path.join(root, "packages/a"), path.join(root, "packages/b")]
    for (const kind of ["shell-after", "verify"] as const) {
      expect(await of("sub1", root, kind)).toEqual({ own: packages, subagents: [] })
      expect(await of("sub1", path.join(root, "packages/a"), kind)).toEqual({ own: [packages[0]], subagents: [] })
    }
  })

  test("the main agent's shell calls and stop list its subagents' worktrees apart; a subagent's never reach another's", async () => {
    const lead = await createProject({ [CONFIG]: config })
    const w1 = await createProject({ [CONFIG]: config })
    const w2 = await createProject({ [CONFIG]: config })
    await recordSessionRoots(TEST_HOME, "tree-1", "main", [lead])
    await recordSessionRoots(TEST_HOME, "tree-1", "sub1", [w1])
    await recordSessionRoots(TEST_HOME, "tree-1", "sub2", [w2, lead])
    const of = (agent: string, cwd: string, kind: "verify" | "shell-after" | "prompt") =>
      projectsForEvent({ cwd, launchDir: lead, sessionId: "tree-1", agent, kind }, TEST_HOME, NO_HOME)

    for (const kind of ["verify", "shell-after"] as const) {
      expect(await of("main", lead, kind)).toEqual({ own: [lead], subagents: [w1, w2] })
      expect(await of("sub1", w1, kind)).toEqual({ own: [w1], subagents: [] })
    }
    // A subagent working in the lead's tree reaches it from there, and only it.
    expect(await of("sub2", lead, "verify")).toEqual({ own: [lead, w2], subagents: [] })
    // A prompt only resets bookkeeping: it reaches every project the session ran.
    expect(await of("main", lead, "prompt")).toEqual({ own: [lead, w1, w2], subagents: [] })
  })
})

describe("displayPath", () => {
  test("is the identity without displayFrom", () => {
    expect(displayPath("/repo", undefined)("pkg/a.py")).toBe("pkg/a.py")
  })

  test("is relative to displayFrom, down, up and sideways", () => {
    expect(displayPath("/repo", "/repo")("pkg/a.py")).toBe("pkg/a.py")
    expect(displayPath("/repo/pkg", "/repo")("src/a.py")).toBe("pkg/src/a.py")
    expect(displayPath("/repo", "/repo/pkg")("other/a.py")).toBe("../other/a.py")
    expect(displayPath("/repo/backend", "/repo/frontend")("x.py")).toBe("../backend/x.py")
  })
})

async function createAt(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
}
