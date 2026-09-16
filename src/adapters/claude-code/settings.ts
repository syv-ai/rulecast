type JsonObject = Record<string, unknown>

export class SettingsError extends Error {}

const RULECAST_HOOK = /\brulecast\b.*\bhook claude-code\b/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The hook groups rulecast needs (spec §12). Timeouts are in seconds. */
function hookGroups(verifyMs: number): { event: string; matcher?: string; timeout: number }[] {
  const verifyTimeout = Math.ceil(verifyMs / 1000) + 10
  return [
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
      isObject(group) &&
      group.matcher === matcher &&
      Array.isArray(group.hooks) &&
      group.hooks.some(
        (hook) => isObject(hook) && typeof hook.command === "string" && RULECAST_HOOK.test(hook.command),
      ),
  )
}

/** Adds rulecast's hooks to Claude Code settings. Existing entries are never modified or removed. */
export function mergeHooks(
  settings: unknown,
  command: string,
  verifyMs: number,
): { settings: JsonObject; added: string[] } {
  if (!isObject(settings)) throw new SettingsError("settings must be a JSON object")
  const hooks = settings.hooks ?? {}
  if (!isObject(hooks)) throw new SettingsError('"hooks" must be an object')
  const merged: JsonObject = { ...hooks }
  const added: string[] = []
  for (const { event, matcher, timeout } of hookGroups(verifyMs)) {
    const groups = merged[event] ?? []
    if (!Array.isArray(groups)) throw new SettingsError(`"hooks.${event}" must be an array`)
    if (installed(groups, matcher)) continue
    const hook = { type: "command", command, timeout }
    merged[event] = [...groups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }]
    added.push(matcher === undefined ? event : `${event} (${matcher})`)
  }
  return { settings: { ...settings, hooks: merged }, added }
}
