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
    { event: "Stop", timeout: verifyTimeout },
    { event: "SubagentStop", timeout: verifyTimeout },
    { event: "UserPromptSubmit", timeout: 5 },
    { event: "SessionStart", matcher: "startup|resume|compact", timeout: 5 },
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

/** Adds rulecast's hooks to Claude Code settings. Existing entries are never modified or removed. */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
): { settings: JsonObject; added: string[] } {
  const merged: JsonObject = { ...hooksOf(settings) }
  const added: string[] = []
  for (const { event, matcher, timeout } of hookGroups(verifyMs)) {
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (installed(groups, matcher)) continue
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(matcher === undefined ? event : `${event} (${matcher})`)
  }
  return { settings: { ...(settings as JsonObject), hooks: merged }, added }
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
