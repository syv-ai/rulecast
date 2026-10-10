type JsonObject = Record<string, unknown>

export class SettingsError extends Error {}

const RULECAST_HOOK = /\brulecast\b.*\bhook claude-code\b/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRulecastHook = (hook: unknown): boolean =>
  isObject(hook) && typeof hook.command === "string" && RULECAST_HOOK.test(hook.command)

/** The hook groups rulecast needs (spec §12). Timeouts are in seconds. */
function hookGroups(verifyMs: number): { event: string; matcher?: string; timeout: number }[] {
  const verifyTimeout = Math.ceil(verifyMs / 1000) + 10
  return [
    // Before the write, for refuse_write rules. It answers nothing at all unless the project has
    // one, so the cost on an ordinary edit is starting rulecast and compiling the config.
    { event: "PreToolUse", matcher: "Edit|Write", timeout: 5 },
    { event: "PostToolUse", matcher: "Read", timeout: 5 },
    { event: "PostToolUse", matcher: "Edit|Write", timeout: 5 },
    // Around every shell call: the working tree before and after it is how rulecast sees what a
    // command wrote. After can run an edit event; a command that fails fires the Failure hook instead.
    { event: "PreToolUse", matcher: "Bash", timeout: 5 },
    { event: "PostToolUse", matcher: "Bash", timeout: 5 },
    { event: "PostToolUseFailure", matcher: "Bash", timeout: 5 },
    { event: "Stop", timeout: verifyTimeout },
    { event: "SubagentStop", timeout: verifyTimeout },
    { event: "UserPromptSubmit", timeout: 5 },
    { event: "SessionStart", matcher: "startup|resume|compact", timeout: 5 },
    // A group of its own rather than a wider matcher on the one above: an older install's group
    // would then no longer match, and upgrading it would leave two hooks firing on every startup.
    { event: "SessionStart", matcher: "clear|fork", timeout: 5 },
  ]
}

function installed(groups: unknown[], matcher: string | undefined): boolean {
  return groups.some(
    (group) =>
      isObject(group) && group.matcher === matcher && Array.isArray(group.hooks) && group.hooks.some(isRulecastHook),
  )
}

function hooksOf(settings: unknown): JsonObject {
  if (!isObject(settings)) throw new SettingsError("settings must be a JSON object")
  const hooks = settings.hooks ?? {}
  if (!isObject(hooks)) throw new SettingsError('"hooks" must be an object')
  return hooks
}

/**
 * Adds rulecast's hooks to Claude Code settings. Entries that are not rulecast's are never modified
 * or removed. rulecast's own, when their command is not the current one, are rewritten in place and
 * reported as `updated`: an entry rulecast wrote is not "an existing entry" in §12's sense. An entry
 * whose command is `keep` is current whatever `command` is.
 */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
  keep?: string,
): { settings: JsonObject; added: string[]; updated: string[] } {
  const merged: JsonObject = { ...hooksOf(settings) }
  const added: string[] = []
  const updated: string[] = []
  for (const { event, matcher, timeout } of hookGroups(verifyMs)) {
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (installed(groups, matcher)) {
      let changed = false
      const rewritten = groups.map((group) => {
        if (!isObject(group) || group.matcher !== matcher || !Array.isArray(group.hooks)) return group
        return {
          ...group,
          hooks: group.hooks.map((hook) => {
            const current = (hook as JsonObject).command
            if (!isRulecastHook(hook) || current === command || current === keep) return hook
            changed = true
            return { ...(hook as JsonObject), command }
          }),
        }
      })
      if (changed) {
        merged[event] = rewritten
        updated.push(matcher === undefined ? event : `${event} (${matcher})`)
      }
      continue
    }
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(matcher === undefined ? event : `${event} (${matcher})`)
  }
  return { settings: { ...(settings as JsonObject), hooks: merged }, added, updated }
}

/**
 * Removes the hooks rulecast added (commands running `rulecast hook claude-code`). Groups and events that only
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
