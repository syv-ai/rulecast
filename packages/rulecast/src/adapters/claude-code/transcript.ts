import { createReadStream } from "node:fs"
import { readdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"

import { isNotFound } from "../../core/errors"

/**
 * Claude Code's session transcripts, read for `rulecast replay` (shapes recorded from Claude Code
 * 2.1.296, 2026-10-17; test/payloads/claude-code/transcripts/README.md).
 *
 * A session is `<config dir>/projects/<encoded root>/<session id>.jsonl`; each subagent it started is
 * `<session id>/subagents/agent-<id>.jsonl`. An Edit or Write is a `user` record whose
 * `toolUseResult` has `filePath` and `structuredPatch`: Write gives the new `content` (`type`
 * `create` or `update`), Edit gives `oldString`, `newString` and `replaceAll`. Either may carry the
 * file before it as `originalFile`, and often does not (null): then the content is what the session
 * last wrote or fully read, and an edit of a file it never saw whole cannot be rebuilt and is counted
 * as unknown. Changes made through Bash are not in a transcript.
 */
export interface TranscriptEdit {
  /** Project-relative. */
  file: string
  /** null: the file did not exist (a Write that created it). */
  before: string | null
  after: string
}

export interface TranscriptTurn {
  /** 0-based, counted from the agent's first prompt. */
  index: number
  edits: TranscriptEdit[]
}

export interface TranscriptAgent {
  /** `main`, or the subagent's id. */
  agent: string
  turns: TranscriptTurn[]
  /** Edits of a file under the root whose content before them could not be rebuilt. */
  unknown: number
}

export interface TranscriptSession {
  session: string
  /** The transcript's last change, epoch ms. */
  modified: number
  agents: TranscriptAgent[]
}

/** `CLAUDE_CONFIG_DIR` replaces `~/.claude` for Claude Code, so it does here. */
export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  return env.CLAUDE_CONFIG_DIR ?? path.join(env.HOME ?? homedir(), ".claude")
}

/** Claude Code names a project's directory after its path, every other character a `-`. */
export async function projectTranscriptDir(root: string, configDir: string): Promise<string> {
  const real = await realpath(root)
  return path.join(configDir, "projects", real.replace(/[^A-Za-z0-9]/g, "-"))
}

/** The newest `limit` sessions, newest first, by when their transcript last changed. */
export async function listSessions(
  dir: string,
  limit: number,
): Promise<{ session: string; file: string; modified: number }[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const sessions = await Promise.all(
    names
      .filter((name) => name.endsWith(".jsonl"))
      .map(async (name) => {
        const file = path.join(dir, name)
        return { session: name.slice(0, -".jsonl".length), file, modified: (await stat(file)).mtimeMs }
      }),
  )
  return sessions.sort((a, b) => b.modified - a.modified).slice(0, limit)
}

/** One session, with each of its subagents as an agent of its own. */
export async function readSession(
  entry: { session: string; file: string; modified: number },
  root: string,
): Promise<TranscriptSession> {
  const real = await realpath(root)
  const agents = [{ agent: "main", ...(await readAgent(entry.file, real)) }]
  const subagents = path.join(path.dirname(entry.file), entry.session, "subagents")
  let names: string[] = []
  try {
    names = (await readdir(subagents)).filter((name) => name.endsWith(".jsonl")).sort()
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
  for (const name of names) {
    const agent = name.replace(/^agent-/, "").replace(/\.jsonl$/, "")
    agents.push({ agent, ...(await readAgent(path.join(subagents, name), real)) })
  }
  return { session: entry.session, modified: entry.modified, agents }
}

interface ToolResult {
  type?: string
  filePath?: string
  structuredPatch?: unknown
  content?: string
  originalFile?: string | null
  oldString?: string
  newString?: string
  replaceAll?: boolean
  file?: { filePath?: string; content?: string; startLine?: number; numLines?: number; totalLines?: number }
}

interface TranscriptRecord {
  type?: string
  isMeta?: boolean
  message?: { content?: unknown }
  toolUseResult?: unknown
}

/** A prompt the person typed: not a tool result, not injected (`isMeta`), not a command or notification (`<…>`). */
function isPrompt(record: TranscriptRecord): boolean {
  if (record.type !== "user" || record.toolUseResult !== undefined || record.isMeta === true) return false
  const content = record.message?.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.some((part) => (part as { type?: string })?.type === "tool_result")
          ? null
          : ((content.find((part) => (part as { type?: string })?.type === "text") as { text?: string } | undefined)
              ?.text ?? null)
        : null
  return text !== null && !text.trimStart().startsWith("<")
}

/** Edit's own semantics: the first occurrence, or every one with `replaceAll`; null when it is not there. */
function applyEdit(content: string, result: ToolResult): string | null {
  const { oldString, newString } = result
  if (oldString === undefined || newString === undefined || !content.includes(oldString)) return null
  return result.replaceAll === true
    ? content.split(oldString).join(newString)
    : content.replace(oldString, () => newString)
}

/** Lines are streamed: a long session's transcript can pass V8's largest string (abide #21). */
async function readAgent(file: string, root: string): Promise<Omit<TranscriptAgent, "agent">> {
  const turns: TranscriptTurn[] = []
  const known = new Map<string, string | null>()
  let unknown = 0
  let turn: TranscriptTurn | null = null
  const relative = (absolute: string | undefined): string | null => {
    if (absolute === undefined) return null
    const inside = path.relative(root, absolute)
    return inside === "" || inside.startsWith("..") || path.isAbsolute(inside) ? null : inside
  }
  const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    let record: TranscriptRecord
    try {
      record = JSON.parse(line) as TranscriptRecord
    } catch {
      continue
    }
    if (isPrompt(record)) {
      turn = { index: turns.length, edits: [] }
      turns.push(turn)
      continue
    }
    const result = record.toolUseResult
    if (record.type !== "user" || typeof result !== "object" || result === null) continue
    const tool = result as ToolResult
    // A complete Read: the file as the agent saw it.
    if (tool.type === "text" && tool.file !== undefined) {
      const read = relative(tool.file.filePath)
      const whole = tool.file.startLine === 1 && tool.file.numLines === tool.file.totalLines
      if (read !== null && whole && typeof tool.file.content === "string") known.set(read, tool.file.content)
      continue
    }
    if (tool.structuredPatch === undefined) continue
    const edited = relative(tool.filePath)
    if (edited === null) continue
    const before = typeof tool.originalFile === "string" ? tool.originalFile : known.get(edited)
    let after: string | null
    if (tool.type === "create" || tool.type === "update") after = tool.content ?? null
    else after = before === undefined || before === null ? null : applyEdit(before, tool)
    if (after === null || (before === undefined && tool.type !== "create")) {
      // Not judged, but a Write still says what the file is now.
      unknown++
      if (after === null) known.delete(edited)
      else known.set(edited, after)
      continue
    }
    known.set(edited, after)
    if (turn === null) {
      turn = { index: 0, edits: [] }
      turns.push(turn)
    }
    turn.edits.push({ file: edited, before: tool.type === "create" ? null : (before ?? null), after })
  }
  return { turns: turns.filter((candidate) => candidate.edits.length > 0), unknown }
}
