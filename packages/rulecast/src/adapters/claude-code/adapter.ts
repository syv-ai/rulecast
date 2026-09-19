import { renderAgentText } from "../../core/delivery/render-agent"
import type { Adapter } from "../../core/types"
import { parseClaudeCode } from "./parse"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish."

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

const CUT = "\n\n…cut to fit Claude Code's hook output limit. Run `rulecast check --format agent` for the full list."

/** Only findings can push text past the limit: commit keeps references within the budget. */
function withinLimit(text: string): string {
  return text.length <= CONTEXT_LIMIT ? text : text.slice(0, CONTEXT_LIMIT - CUT.length) + CUT
}

const NONE = { stdout: "", exitCode: 0 }
const json = (value: unknown) => ({ stdout: JSON.stringify(value), exitCode: 0 })

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  maxContextChars: CONTEXT_BUDGET,
  parse: parseClaudeCode,
  format(delivery, event, options) {
    const text = renderAgentText(delivery, options)
    if (text === "") return NONE
    switch (event.kind) {
      case "touch":
      case "edit":
        return json({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: withinLimit(text) } })
      case "verify":
        if (delivery.stop === "block")
          return json({ decision: "block", reason: withinLimit(`${BLOCK_PREAMBLE}\n\n${text}`) })
        if (delivery.stop === "capReached") return json({ systemMessage: withinLimit(`${CAP_PREAMBLE}\n\n${text}`) })
        return NONE
      default:
        return NONE
    }
  },
}
