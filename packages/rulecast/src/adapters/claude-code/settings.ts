import { HOOK_SCRIPT_FILE } from "./hook-script"

type JsonObject = Record<string, unknown>

export class SettingsError extends Error {}

/**
 * rulecast's own hook commands: one that runs the hook script, and every older form, which ran
 * `rulecast hook claude-code` inline. The older forms are how an upgrade finds what to replace:
 * Claude Code runs every matching handler, so an entry left behind would run rulecast twice.
 */
const RULECAST_HOOK = /\brulecast\b.*\bhook claude-code\b/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRulecastHook = (hook: unknown): boolean =>
  isObject(hook) &&
  typeof hook.command === "string" &&
  (hook.command.includes(HOOK_SCRIPT_FILE) || RULECAST_HOOK.test(hook.command))

interface HookGroup {
  event: string
  matcher?: string
  timeout: number
  /** Matchers an older install wrote for this group: found and rewritten to `matcher`, never doubled. */
  was?: string[]
  /** Only when a config the hooks serve has a refuse_write rule (MergeOptions.guard). */
  guard?: true
}

/** The edit tools rulecast checks after they ran. Exact names: Claude Code's matcher lists are case-sensitive. */
const EDIT_MATCHER = "Edit|Write|MultiEdit|NotebookEdit"

/** The hook groups rulecast needs (spec §12). Timeouts are in seconds. */
function hookGroups(verifyMs: number): HookGroup[] {
  const verifyTimeout = Math.ceil(verifyMs / 1000) + 10
  return [
    // Before the write, for refuse_write rules, and only where a config has one: every edit pays for
    // starting rulecast and compiling the config here. NotebookEdit and MultiEdit are not here: what
    // they would write is not known exactly before they run, and a guard never refuses on a guess.
    { event: "PreToolUse", matcher: "Edit|Write", timeout: 5, guard: true },
    { event: "PostToolUse", matcher: "Read", timeout: 5 },
    // A file too large to read fails the read instead (test/payloads/claude-code/README.md).
    { event: "PostToolUseFailure", matcher: "Read", timeout: 5 },
    { event: "PostToolUse", matcher: EDIT_MATCHER, timeout: 5, was: ["Edit|Write"] },
    // Around every shell call: the working tree before and after it is how rulecast sees what a
    // command wrote. After can run an edit event; a command that fails fires the Failure hook instead.
    { event: "PreToolUse", matcher: "Bash", timeout: 5 },
    { event: "PostToolUse", matcher: "Bash", timeout: 5 },
    { event: "PostToolUseFailure", matcher: "Bash", timeout: 5 },
    // Auto mode: a subagent ends by handing its report back, and its stop is checked there.
    { event: "PreToolUse", matcher: "SubagentHandback", timeout: verifyTimeout },
    // The worktree the agent moves into: its projects are the agent's from then on.
    { event: "PostToolUse", matcher: "EnterWorktree|ExitWorktree", timeout: 5 },
    { event: "Stop", timeout: verifyTimeout },
    { event: "SubagentStop", timeout: verifyTimeout },
    { event: "SubagentStart", timeout: 5 },
    { event: "UserPromptSubmit", timeout: 5 },
    { event: "SessionStart", matcher: "startup|resume|compact", timeout: 5 },
    // A group of its own rather than a wider matcher on the one above: an older install's group
    // would then no longer match, and upgrading it would leave two hooks firing on every startup.
    { event: "SessionStart", matcher: "clear|fork", timeout: 5 },
  ]
}

const labelOf = ({ event, matcher }: HookGroup) => (matcher === undefined ? event : `${event} (${matcher})`)

/** A settings group that is this hook group, under its matcher or one an older install wrote. */
const isGroup = (group: unknown, { matcher, was }: HookGroup): group is JsonObject =>
  isObject(group) &&
  (group.matcher === matcher || (typeof group.matcher === "string" && (was ?? []).includes(group.matcher))) &&
  Array.isArray(group.hooks)

function installed(groups: unknown[], wanted: HookGroup): boolean {
  return groups.some((group) => isGroup(group, wanted) && (group.hooks as unknown[]).some(isRulecastHook))
}

function hooksOf(settings: unknown): JsonObject {
  if (!isObject(settings)) throw new SettingsError("settings must be a JSON object")
  const hooks = settings.hooks ?? {}
  if (!isObject(hooks)) throw new SettingsError('"hooks" must be an object')
  return hooks
}

export interface MergeOptions {
  /** Add nothing: for a settings file beside the one holding the full set. */
  upgradeOnly?: boolean
  /**
   * Whether the PreToolUse write guard is wanted: a config the hooks serve has a refuse_write
   * rule. Default true. False also removes rulecast's guard from an older install.
   */
  guard?: boolean
}

/**
 * Adds rulecast's hooks to Claude Code settings. Entries that are not rulecast's are never modified
 * or removed. rulecast's own, when their command is not the current one, are rewritten in place and
 * reported as `updated`: an entry rulecast wrote is not "an existing entry" in §12's sense. One
 * whose timeout is below what `verifyMs` needs gets that timeout, and is reported as `updated` too;
 * so is a group still on a matcher an older install wrote, and a guard no longer wanted, removed.
 */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
  options: MergeOptions = {},
): { settings: JsonObject; added: string[]; updated: string[] } {
  const merged: JsonObject = { ...hooksOf(settings) }
  const added: string[] = []
  const updated: string[] = []
  for (const wanted of hookGroups(verifyMs)) {
    const { event, matcher, timeout } = wanted
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (wanted.guard === true && options.guard === false) {
      if (!installed(groups, wanted)) continue
      merged[event] = groups.flatMap((group) => {
        if (!isGroup(group, wanted)) return [group]
        const others = (group.hooks as unknown[]).filter((hook) => !isRulecastHook(hook))
        return others.length === 0 ? [] : [{ ...group, hooks: others }]
      })
      updated.push(`${labelOf(wanted)} removed`)
      continue
    }
    if (installed(groups, wanted)) {
      let changed = false
      const rewritten = groups.flatMap((group): unknown[] => {
        if (!isGroup(group, wanted)) return [group]
        const hooks = group.hooks as unknown[]
        const ours = hooks.some(isRulecastHook)
        const renamed = ours && group.matcher !== matcher
        if (renamed) changed = true
        // On an older matcher with a hook of the user's in it: the user's group stays as it is, and
        // rulecast's hook moves to a group of its own. Alone there, the group is widened in place.
        if (renamed && hooks.some((hook) => !isRulecastHook(hook))) {
          return [
            { ...group, hooks: hooks.filter((hook) => !isRulecastHook(hook)) },
            {
              matcher,
              hooks: hooks.filter(isRulecastHook).map((hook) => {
                const old = (hook as JsonObject).timeout
                return {
                  ...(hook as JsonObject),
                  command,
                  timeout: typeof old === "number" && old > timeout ? old : timeout,
                }
              }),
            },
          ]
        }
        return [
          {
            ...group,
            ...(renamed ? { matcher } : {}),
            hooks: hooks.map((hook) => {
              if (!isRulecastHook(hook)) return hook
              const currentCommand = (hook as JsonObject).command === command
              // Claude Code kills a hook at its timeout. One lower than the stop check's budget skips
              // that check silently; a higher one is kept, since install sizes it for every config.
              const old = (hook as JsonObject).timeout
              const tooShort = typeof old !== "number" || old < timeout
              if (currentCommand && !tooShort) return hook
              changed = true
              return { ...(hook as JsonObject), command, ...(tooShort ? { timeout } : {}) }
            }),
          },
        ]
      })
      if (changed) {
        merged[event] = rewritten
        updated.push(labelOf(wanted))
      }
      continue
    }
    if (options.upgradeOnly) continue
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(labelOf(wanted))
  }
  return { settings: { ...(settings as JsonObject), hooks: merged }, added, updated }
}

/**
 * Removes the hooks rulecast added (any command isRulecastHook knows). Groups and events that only
 * held rulecast hooks go too, and so does a `hooks` object left empty. Everything else is kept as it is.
 */
export function removeHooks(settings: unknown): { settings: JsonObject; removed: string[] } {
  const hooks = hooksOf(settings)
  const source = settings as JsonObject
  const kept: JsonObject = {}
  const removed: string[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    const remaining: unknown[] = []
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(isRulecastHook)) {
        remaining.push(group)
        continue
      }
      removed.push(typeof group.matcher === "string" ? `${event} (${group.matcher})` : event)
      const others = group.hooks.filter((hook) => !isRulecastHook(hook))
      if (others.length > 0) remaining.push({ ...group, hooks: others })
    }
    // Only events emptied here are dropped; an event that was already empty stays.
    if (remaining.length > 0 || groups.length === 0) kept[event] = remaining
  }
  if (removed.length === 0) return { settings: source, removed }
  const result: JsonObject = {}
  for (const [key, value] of Object.entries(source)) {
    if (key !== "hooks") result[key] = value
    else if (Object.keys(kept).length > 0) result[key] = kept
  }
  return { settings: result, removed }
}
