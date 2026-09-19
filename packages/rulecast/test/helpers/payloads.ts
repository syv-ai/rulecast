import { readFileSync } from "node:fs"
import path from "node:path"

export interface Payload {
  session_id: string
  cwd: string
  agent_id?: string
  tool_input?: { file_path?: string }
  [key: string]: unknown
}

/**
 * A payload recorded in test/payloads/claude-code, optionally pointed at a test project:
 * `root` replaces cwd, `file` (repo-relative) replaces tool_input.file_path, `sessionId` replaces session_id.
 */
export function claudeCodePayload(
  name: string,
  overrides: { root?: string; file?: string; sessionId?: string } = {},
): Payload {
  const payload: Payload = JSON.parse(
    readFileSync(new URL(`../payloads/claude-code/${name}.json`, import.meta.url), "utf8"),
  )
  if (overrides.root) payload.cwd = overrides.root
  if (overrides.file && payload.tool_input) payload.tool_input.file_path = path.join(payload.cwd, overrides.file)
  if (overrides.sessionId) payload.session_id = overrides.sessionId
  return payload
}
