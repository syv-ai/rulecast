import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { Delivery } from "../types"
import { renderAgentText } from "./render-agent"

/**
 * Where files an agent is told to read are put: `<root>/.rulecast/`, inside the project.
 *
 * Measured with Claude Code 2.1.296 (plan 10, Task 11): in default permission mode a Read of
 * anything under `~/.cache/rulecast` is blocked until the user grants it, so a pointer to the cache
 * is a pointer the agent cannot follow. The directory ignores itself — its own `.gitignore` holds
 * `*` — so nothing here is ever committed and no project's ignore file needs editing.
 */
export const AGENT_DIR = ".rulecast"

/** `<root>/.rulecast`, created with its self-ignoring `.gitignore` on first use. */
export function agentDir(root: string): string {
  const dir = path.join(root, AGENT_DIR)
  mkdirSync(dir, { recursive: true })
  const ignore = path.join(dir, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, "# Written by rulecast: files its hooks point an agent at.\n*\n")
  return dir
}

/**
 * The project-relative copy of a file under the rulecast home, for a pointer the agent will follow:
 * `<home>/repos/x/v1/doc.md` → `.rulecast/repos/x/v1/doc.md`. Null when the file is not under the
 * home or cannot be copied: the caller keeps the original pointer, which is no worse than before.
 */
export function copyIntoProject(root: string, home: string, file: string): string | null {
  const rest = path.relative(home, file)
  if (rest.startsWith("..") || path.isAbsolute(rest)) return null
  try {
    const target = path.join(agentDir(root), rest)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(file, target)
    return path.join(AGENT_DIR, rest).split(path.sep).join("/")
  } catch {
    return null
  }
}

/** Kept per session: enough to follow a pointer delivered a turn or two ago, not a log. */
const KEEP = 3

/** The file exists because the message could not hold everything, so it holds everything. */
const UNLIMITED = { maxMatchesPerRule: Number.MAX_SAFE_INTEGER }

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_")

function markdown(delivery: Delivery, now: Date): string {
  const body = renderAgentText({ ...delivery, overflowPath: null }, UNLIMITED)
  return [
    `# rulecast delivery — ${now.toISOString()}`,
    "",
    "Too much to fit in one hook message. Everything rulecast found for the files in this session,",
    "with the doc section each rule cites:",
    "",
    body,
    "",
  ].join("\n")
}

/**
 * Writes the untrimmed delivery into `dir` (the pipeline passes `<root>/.rulecast/deliveries`, see
 * `AGENT_DIR`) and prunes this session's older ones.
 * Best effort: a hook must not fail because a file could not be written, and what the agent most
 * needs is in the message itself — this is the rest of it.
 */
export function writeOverflow(
  dir: string,
  session: string | null,
  delivery: Delivery,
  now: Date = new Date(),
): string | null {
  const prefix = safeSegment(session ?? "no-session")
  const file = path.join(dir, `${prefix}-${now.toISOString().replace(/[:.]/g, "-")}.md`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, markdown(delivery, now))
    const mine = readdirSync(dir)
      .filter((name) => name.startsWith(`${prefix}-`))
      .sort()
    for (const old of mine.slice(0, Math.max(0, mine.length - KEEP))) rmSync(path.join(dir, old), { force: true })
    return file
  } catch {
    return null
  }
}
