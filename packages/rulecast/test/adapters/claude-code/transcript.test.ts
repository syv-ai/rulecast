import { realpath } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"

import {
  claudeConfigDir,
  listSessions,
  projectTranscriptDir,
  readSession,
} from "../../../src/adapters/claude-code/transcript"
import { createProject } from "../../helpers/project"
import { transcriptsFor } from "../../helpers/transcripts"

const USERS0 = "def get():\n    raise HTTPException(404)\n"
const USERS1 = "def get():\n    raise HTTPException(500)\n    raise HTTPException(404)\n"
const USERS2 = "def get():\n    return None\n    raise HTTPException(404)\n"

test("a session's turns, each edit's content before and after, and the subagent's own", async () => {
  const root = await createProject({})
  const configDir = await transcriptsFor(root)
  const dir = await projectTranscriptDir(root, configDir)
  const [entry] = await listSessions(dir, 5)
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
  expect(await listSessions("/nowhere/at/all", 5)).toEqual([])
})
