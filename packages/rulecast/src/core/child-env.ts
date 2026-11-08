/**
 * Variables rulecast sets in its own environment for itself, with the value it set, which no
 * process it starts may inherit. The binary points napi-rs's loader at its unpacked ast-grep module
 * with NAPI_RS_NATIVE_LIBRARY_PATH while that module loads. Every napi-rs tool reads the same
 * variable (rolldown, vite, vitest, oxc-resolver, tailwind's oxide), and handed ours, a project's
 * tool would load ast-grep in place of itself.
 */
const own = new Map<string, string>()

/** Records that rulecast set `name` to `value` for itself. */
export function markOwnEnv(name: string, value: string): void {
  own.set(name, value)
}

/** Forgets `name` once rulecast no longer has it set. */
export function unmarkOwnEnv(name: string): void {
  own.delete(name)
}

/**
 * The environment for a process rulecast starts: `base` without the variables rulecast set for
 * itself. A value the user set (one that differs from ours) passes through.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (own.size === 0) return base
  const env = { ...base }
  for (const [name, value] of own) if (env[name] === value) delete env[name]
  return env
}
