import { renderAgentText } from "../../core/delivery/render-agent"
import type { Adapter, Event } from "../../core/types"
import { parseClaudeCode } from "./parse"
import { mergeHooks, removeHooks } from "./settings"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish."

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

/** Where the rest of a cut delivery can be read: the session's findings, from the CLI. */
function cutNotice(event: Event): string {
  const session = event.session ? `--session ${event.session.id} ` : ""
  return `\n\n…cut to fit Claude Code's hook output limit. Run \`rulecast run ${session}--format agent\` for the full list.`
}

/** Only findings can push text past the limit: commit keeps references within the budget. */
function withinLimit(text: string, event: Event): string {
  if (text.length <= CONTEXT_LIMIT) return text
  const notice = cutNotice(event)
  return text.slice(0, CONTEXT_LIMIT - notice.length) + notice
}

const NONE = { stdout: "", exitCode: 0 }
const json = (value: unknown) => ({ stdout: JSON.stringify(value), exitCode: 0 })

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  label: "Claude Code",
  maxContextChars: CONTEXT_BUDGET,
  parse: parseClaudeCode,
  format(delivery, event, options) {
    const text = renderAgentText(delivery, options)
    if (text === "") return NONE
    switch (event.kind) {
      case "touch":
      case "edit":
        return json({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text, event) },
        })
      case "verify":
        if (delivery.stop === "block")
          return json({ decision: "block", reason: withinLimit(`${BLOCK_PREAMBLE}\n\n${text}`, event) })
        if (delivery.stop === "capReached")
          return json({ systemMessage: withinLimit(`${CAP_PREAMBLE}\n\n${text}`, event) })
        return NONE
      default:
        return NONE
    }
  },
  install: {
    markers: [".claude/", "CLAUDE.md"],
    scopes: [
      { scope: "shared", file: ".claude/settings.json" },
      { scope: "personal", file: ".claude/settings.local.json" },
    ],
    command: (local) =>
      local ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast hook claude-code' : "rulecast hook claude-code",
    merge: mergeHooks,
    remove: removeHooks,
  },
}
