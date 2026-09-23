import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { Delivery } from "../types"
import { renderAgentText } from "./render-agent"

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
 * Writes the untrimmed delivery beside the session's state and prunes this session's older ones.
 * Best effort: a hook must not fail because a file could not be written, and what the agent most
 * needs is in the message itself — this is the rest of it.
 */
export function writeOverflow(
  stateDir: string,
  session: string | null,
  delivery: Delivery,
  now: Date = new Date(),
): string | null {
  const prefix = safeSegment(session ?? "no-session")
  const dir = path.join(stateDir, "deliveries")
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
