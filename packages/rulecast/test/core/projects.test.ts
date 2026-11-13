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
import { createRepo } from "../helpers/git"
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

  test("other events add the configs above cwd after a cd, deduplicated, and record them", async () => {
    const root = await createProject({ [CONFIG]: config, [`pkg/${CONFIG}`]: config })
    const event = {
      cwd: path.join(root, "pkg"),
      launchDir: root,
      sessionId: "cd-1",
      agent: "main",
      kind: "prompt" as const,
    }
    expect((await projectsForEvent(event, TEST_HOME, NO_HOME)).own).toEqual([path.join(root, "pkg"), root])
    expect(await sessionRoots(TEST_HOME, "cd-1", "main")).toEqual([path.join(root, "pkg"), root])
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
