import { renderAgentText } from "../../core/delivery/render-agent"
import { type Adapter, type Delivery, type Event, emptyDelivery } from "../../core/types"
import { parseClaudeCode } from "./parse"
import { mergeHooks, removeHooks } from "./settings"

/** Claude Code replaces longer additionalContext with a pointer to a file (test/payloads/claude-code/README.md). */
export const CONTEXT_LIMIT = 10_000

/** Budget handed to commit: far enough below the limit that rendering overhead never crosses it. */
const CONTEXT_BUDGET = 9_000

const BLOCK_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) found problems in code changed in this session. Fix them before you finish. " +
  'If you believe a finding is wrong, say so to the user rather than changing .rulecast-config.yaml; add a "rulecast-ignore: <rule> <reason>" comment only if they agree.'

const CAP_PREAMBLE = "rulecast: the agent stopped with these findings unresolved (stop gate limit reached)."

const SWEPT_PREAMBLE =
  "rulecast: files changed outside the agent's tool calls this session have findings (not blocking the agent)."

const DENY_PREAMBLE =
  "This project's rulecast rules (.rulecast-config.yaml) refuse this write. Change what you are writing, or the file you are writing it to, and try again."

/**
 * What the user sees, once per session, when the project's hooks are committed and rulecast is not
 * installed yet — a fresh clone before `npm install`. Every other event says nothing.
 */
export const NOT_INSTALLED =
  "rulecast is configured in this project but not installed. Run npm install (or pnpm install), then rulecast doctor."

/**
 * The committed hook command, guarded. A bare path to `node_modules/.bin/rulecast` exits 127 in a
 * clone that has not installed yet, which Claude Code shows as a hook error on every Read and Edit
 * (recorded in test/payloads/claude-code/README.md). Guarded, it runs rulecast when it is there and
 * otherwise exits 0, after telling the user on `SessionStart` only. stdin is read only on that
 * branch; `exec` hands it to rulecast untouched. One string for every event, so the plugin API's
 * `command(local)` is unchanged, and it still contains "rulecast hook claude-code", which is how
 * settings.ts recognises its own hooks.
 */
export const LOCAL_COMMAND =
  'B="$CLAUDE_PROJECT_DIR"/node_modules/.bin/rulecast; [ -x "$B" ] && exec "$B" hook claude-code; ' +
  `grep -q '"hook_event_name": *"SessionStart"' && printf '%s' '${JSON.stringify({ systemMessage: NOT_INSTALLED })}'; exit 0`

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
    const text = renderAgentText(delivery, { ...options, notices: false, warnings: false })
    // For the user, never the model: config changes and ignores added this session (spec §9,
    // Oversight), and rule or detector problems, which only the human can fix (§11).
    const problems =
      delivery.warnings.length === 0 ? [] : ["rulecast problems:", ...delivery.warnings.map((w) => `  - ${w}`)]
    const notices = [...(delivery.notices ?? []), ...problems].join("\n")
    const userOnly = event.kind === "guard" ? NONE : json({ systemMessage: notices })
    if (text === "") return notices === "" ? NONE : userOnly
    const withNotices = (value: Record<string, unknown>) =>
      notices === "" ? value : { ...value, systemMessage: notices }
    switch (event.kind) {
      case "guard":
        // The write has not happened: permissionDecisionReason is what the model is shown instead
        // of the tool's result, so it carries the rule and the section that explains it.
        return json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: withinLimit(`${DENY_PREAMBLE}\n\n${text}`, delivery, event),
          },
        })
      case "touch":
      case "edit":
      case "shell-after":
        return json(
          withNotices({
            hookSpecificOutput: {
              // A command that failed fired PostToolUseFailure, which takes context only under its own name.
              hookEventName: event.failed === true ? "PostToolUseFailure" : "PostToolUse",
              additionalContext: withinLimit(text, delivery, event),
            },
          }),
        )
      case "reset":
        return json(
          withNotices({
            hookSpecificOutput: {
              hookEventName: "SessionStart",
              additionalContext: withinLimit(text, delivery, event),
            },
          }),
        )
      case "verify":
        if (delivery.stop === "block")
          return json(
            withNotices({ decision: "block", reason: withinLimit(`${BLOCK_PREAMBLE}\n\n${text}`, delivery, event) }),
          )
        if (delivery.stop === "capReached") {
          const cap = withinLimit(`${CAP_PREAMBLE}\n\n${text}`, delivery, event)
          return json({ systemMessage: notices === "" ? cap : `${notices}\n\n${cap}` })
        }
        // Findings in files changed outside the agent's tool calls never block, and a Stop hook
        // reaches the agent only by blocking: the user is the one left to tell.
        // Only those findings: the agent's own warnings were told at its edits and are not news here.
        if ((delivery.swept ?? []).length > 0) {
          const swept = new Set(delivery.swept)
          const onlySwept: Delivery = {
            ...emptyDelivery(),
            findings: delivery.findings.filter((finding) => swept.has(finding.file)),
            templates: delivery.templates,
            omitted: { ...delivery.omitted, findings: delivery.omitted.findings.filter((cut) => cut.swept === true) },
            swept: delivery.swept,
          }
          const sweptText = renderAgentText(onlySwept, { ...options, notices: false, warnings: false })
          const outside = withinLimit(`${SWEPT_PREAMBLE}\n\n${sweptText}`, delivery, event)
          return json({ systemMessage: notices === "" ? outside : `${notices}\n\n${outside}` })
        }
        return notices === "" ? NONE : json({ systemMessage: notices })
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
    command: (local) => (local ? LOCAL_COMMAND : "rulecast hook claude-code"),
    // The guarded command is never rewritten to the bare one. It is right with or without
    // node_modules, and `install` in a clone that has not installed yet would otherwise swap the
    // committed command for one that exits 127 on every hook.
    merge: (settings, command, verifyMs) => mergeHooks(settings, command, verifyMs, LOCAL_COMMAND),
    remove: removeHooks,
  },
}
