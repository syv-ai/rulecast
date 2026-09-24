/**
 * What a stress scenario is, and what it is allowed to say about itself.
 *
 * Kept apart from `scenarios.ts` so the parent process can import the shape of a result without
 * importing the scenarios themselves — the scenarios build multi-megabyte fixtures at module scope
 * in some cases, and the parent only ever forks them.
 */

export const TARGETS = ["scale", "concurrency", "adversarial", "session"] as const
export type Target = (typeof TARGETS)[number]

/** One thing the scenario asserts about what it saw. A failing check is a finding, not an error. */
export interface Check {
  name: string
  ok: boolean
  /** What was actually observed, in the units of the check. Shown whether it passed or failed. */
  detail: string
  /**
   * For a check against a numeric ceiling: what was measured, what it had to stay under, and the
   * unit. Present only on those, because they are the ones worth comparing — the share of its own
   * limit each one used is the same quantity across scenarios whose absolute numbers are not.
   */
  measured?: { value: number; limit: number; unit: string }
}

export interface Observation {
  /** Numbers worth carrying into the report. Free-form per scenario. */
  metrics: Record<string, number>
  checks: Check[]
  notes: string[]
}

export interface Scenario {
  name: string
  /** One sentence: what this drives, and what would be a defect. */
  about: string
  target: Target
  /**
   * The watchdog. The parent SIGKILLs the child at this point and records `hung`, which is the only
   * way to measure a scenario that blocks its own event loop — the case this harness exists for.
   */
  timeoutMs: number
  run(): Promise<Observation>
}

export type Outcome =
  /** Ran, and every check held. */
  | "ok"
  /** Ran to completion, but a check failed: a finding with a number attached. */
  | "violated"
  /** Threw, or the child exited non-zero. */
  | "crashed"
  /** Still running at `timeoutMs`; killed. */
  | "hung"

export interface ScenarioResult {
  name: string
  about: string
  target: Target
  outcome: Outcome
  /** Wall clock in the parent, so a hang reports its watchdog rather than nothing. */
  elapsedMs: number
  timeoutMs: number
  observation: Observation | null
  /** Non-null for `crashed`: the child's stderr, trimmed. */
  error: string | null
}

/** The line the child prints its observation on; everything else it writes is diagnostics. */
export const RESULT_PREFIX = "__stress__"
