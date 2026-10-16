import type { Env } from "../home"
import type { Mode } from "./schema"

/** Where the active mode came from, as `rulecast doctor` reports it. */
export type ModeSource = "env" | "config" | "ci" | "default"

export interface ActiveMode {
  mode: Mode
  source: ModeSource
  /** What decided it, for people: "RULECAST_MODE=unattended", "CI=true". Empty for the default. */
  detail: string
  /** A RULECAST_MODE value that is none of the known ones, and so was ignored. */
  ignored?: string
}

/** `interactive` is accepted for `attended`: it is the word people reach for. */
const ENV_VALUES: Record<string, Mode> = { attended: "attended", interactive: "attended", unattended: "unattended" }

/** CI systems set these to "true"; "false" (in any case) and "0" are someone switching it off. */
const CI_VARIABLES = ["CI", "GITHUB_ACTIONS"] as const

const isSet = (value: string | undefined) =>
  value !== undefined && value !== "" && value.toLowerCase() !== "false" && value !== "0"

/** The CI variable that is set, if any: what `doctor` reads to check as a CI job would (#29). */
export function ciVariable(env: Env): (typeof CI_VARIABLES)[number] | undefined {
  return CI_VARIABLES.find((name) => isSet(env[name]))
}

/**
 * RULECAST_MODE, then the config's `mode`, then CI detection, then attended.
 *
 * Never from a missing terminal: a hook's stdin is the agent's payload in every session, attended
 * or not, so "no TTY" would put every interactive session in unattended mode.
 */
export function resolveMode(configured: Mode | null, env: Env): ActiveMode {
  const raw = env.RULECAST_MODE
  const fromEnv = raw === undefined || raw === "" ? undefined : ENV_VALUES[raw.toLowerCase()]
  const ignored = raw !== undefined && raw !== "" && fromEnv === undefined ? { ignored: raw } : {}
  if (fromEnv !== undefined) return { mode: fromEnv, source: "env", detail: `RULECAST_MODE=${raw}` }
  if (configured !== null) return { mode: configured, source: "config", detail: `mode: ${configured}`, ...ignored }
  const ci = ciVariable(env)
  if (ci !== undefined) return { mode: "unattended", source: "ci", detail: `${ci}=${env[ci]}`, ...ignored }
  return { mode: "attended", source: "default", detail: "", ...ignored }
}

/** The mode of a compile that was given no environment: what every command but the hooks runs in. */
export const ATTENDED: ActiveMode = { mode: "attended", source: "default", detail: "" }
