import { renderAgentText } from "../../core/delivery/render-agent"
import type { Adapter, Delivery, Event } from "../../core/types"
import { parseClaudeCode } from "./parse"
import { mergeHooks, removeHooks } from "./settings"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish."

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

/** Where the rest of a cut delivery can be read: the file commit wrote, else the CLI. */
function cutNotice(delivery: Delivery, event: Event): string {
  if (delivery.overflowPath !== null) {
    return `\n\n…cut to fit Claude Code's hook output limit. The whole delivery is in ${delivery.overflowPath}.`
  }
  const session = event.session ? `--session ${event.session.id} ` : ""
  return `\n\n…cut to fit Claude Code's hook output limit. Run \`rulecast run ${session}--format agent\` for the full list.`
}

/**
 * The last resort. The budget in decide() measures what the renderer will produce, so text reaching
 * this point means the estimate was beaten — by a preamble, or by a message longer than any measure
 * of it. Cut at a line, never mid-word: the tail of a delivery is a doc section, and half a sentence
 * of documentation is worse than none.
 */
function withinLimit(text: string, delivery: Delivery, event: Event): string {
  if (text.length <= CONTEXT_LIMIT) return text
  const notice = cutNotice(delivery, event)
  const room = CONTEXT_LIMIT - notice.length
  const cut = text.slice(0, room)
  const lastLine = cut.lastIndexOf("\n")
  return (lastLine > room / 2 ? cut.slice(0, lastLine) : cut.trimEnd()) + notice
}

const NONE = { stdout: "", exitCode: 0 }
const json = (value: unknown) => ({ stdout: JSON.stringify(value), exitCode: 0 })

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  label: "Claude Code",
  maxContextChars: CONTEXT_BUDGET,
  /** Recorded from 2.1.278: /compact re-attaches the 5 most recently read, edited or written files. */
  restoredFiles: 5,
  parse: parseClaudeCode,
  format(delivery, event, options) {
    const text = renderAgentText(delivery, options)
    if (text === "") return NONE
    switch (event.kind) {
      case "touch":
      case "edit":
        return json({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text, delivery, event) },
        })
      case "reset":
        return json({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: withinLimit(text, delivery, event) },
        })
      case "verify":
        if (delivery.stop === "block")
          return json({ decision: "block", reason: withinLimit(`${BLOCK_PREAMBLE}\n\n${text}`, delivery, event) })
        if (delivery.stop === "capReached")
          return json({ systemMessage: withinLimit(`${CAP_PREAMBLE}\n\n${text}`, delivery, event) })
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
