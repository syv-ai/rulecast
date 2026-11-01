import { mkdir, mkdtemp, realpath, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"

import {
  claudeConfigDir,
  listSessions,
  projectTranscriptDir,
  projectTranscriptDirs,
  readSession,
} from "../../../src/adapters/claude-code/transcript"
import { createRepo } from "../../helpers/git"
import { createProject } from "../../helpers/project"
import { transcriptsFor } from "../../helpers/transcripts"

const USERS0 = "def get():\n    raise HTTPException(404)\n"
const USERS1 = "def get():\n    raise HTTPException(500)\n    raise HTTPException(404)\n"
const USERS2 = "def get():\n    return None\n    raise HTTPException(404)\n"

test("a session's turns, each edit's content before and after, and the subagent's own", async () => {
  const root = await createProject({})
  const configDir = await transcriptsFor(root)
  const dirs = await projectTranscriptDirs(root, configDir)
  const [entry] = await listSessions(dirs, 5)
  expect(entry?.session).toBe("session")
  const session = await readSession(entry!, root)
  expect(session.agents).toEqual([
    {
      agent: "main",
      unknown: 1,
      turns: [
        {
          index: 0,
          edits: [
            // originalFile was null: rebuilt from the complete Read before it.
            { file: "app/services/users.py", before: USERS0, after: USERS1 },
            { file: "app/services/orders.py", before: null, after: "raise HTTPException(400)\n" },
          ],
        },
        // The task notification and the injected skill text are not prompts: this is the second.
        { index: 1, edits: [{ file: "app/services/users.py", before: USERS1, after: USERS2 }] },
      ],
    },
    {
      agent: "a1",
      unknown: 0,
      turns: [
        {
          index: 0,
          edits: [{ file: "src/client/api.ts", before: "export const api = 1\n", after: "export const api = 2\n" }],
        },
      ],
    },
  ])
})

test("CLAUDE_CONFIG_DIR replaces ~/.claude, and the project's directory is its path with every other character a -", async () => {
  expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/cfg", HOME: "/home/u" })).toBe("/cfg")
  expect(claudeConfigDir({ HOME: "/home/u" })).toBe("/home/u/.claude")
  const root = await createProject({})
  const encoded = (await realpath(root)).replace(/[^A-Za-z0-9]/g, "-")
  expect(await projectTranscriptDir(root, "/cfg")).toBe(path.join("/cfg", "projects", encoded))
})

test("a project with no transcripts has no sessions", async () => {
  expect(await listSessions(["/nowhere/at/all"], 5)).toEqual([])
})

test("a session launched at the git top is found for a package's root, and only its edits inside the root are kept", async () => {
  const top = await createRepo({ "README.md": "# repo\n" })
  const real = await realpath(top)
  const backend = path.join(real, "backend")
  await mkdir(backend)
  const configDir = await mkdtemp(path.join(tmpdir(), "rulecast-claude-"))
  const write = (file: string, content: string) =>
    JSON.stringify({
      type: "user",
      toolUseResult: { type: "create", filePath: path.join(real, file), content, structuredPatch: [] },
    })
  const dir = await projectTranscriptDir(real, configDir)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, "launched-at-top.jsonl"),
    `${[
      JSON.stringify({ type: "user", message: { content: "add the endpoints" } }),
      write("backend/app.py", "x = 1\n"),
      write("frontend/app.ts", "export const x = 1\n"),
    ].join("\n")}\n`,
  )

  const dirs = await projectTranscriptDirs(backend, configDir)
  expect(dirs).toEqual([await projectTranscriptDir(backend, configDir), dir])
  const [entry] = await listSessions(dirs, 5)
  expect(entry?.session).toBe("launched-at-top")
  const session = await readSession(entry!, backend)
  expect(session.agents).toEqual([
    { agent: "main", unknown: 0, turns: [{ index: 0, edits: [{ file: "app.py", before: null, after: "x = 1\n" }] }] },
  ])
})

test("outside git, only the root's own transcript dir is read", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "rulecast-nogit-")))
  expect(await projectTranscriptDirs(root, "/cfg")).toEqual([await projectTranscriptDir(root, "/cfg")])
})

test("sessions from several launch dirs are merged newest first before the limit", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "rulecast-claude-"))
  const a = path.join(configDir, "a")
  const b = path.join(configDir, "b")
  await mkdir(a)
  await mkdir(b)
  for (const [dir, name, at] of [
    [a, "old", 1000],
    [b, "newest", 3000],
    [a, "middle", 2000],
  ] as const) {
    await writeFile(path.join(dir, `${name}.jsonl`), "")
    await utimes(path.join(dir, `${name}.jsonl`), at, at)
  }
  expect((await listSessions([a, b], 2)).map((entry) => entry.session)).toEqual(["newest", "middle"])
})
