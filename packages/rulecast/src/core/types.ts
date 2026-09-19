import type { ZodType, ZodTypeDef } from "zod"

export type EventKind = "touch" | "edit" | "verify" | "prompt" | "reset"
export type DetectorEvent = "edit" | "verify"
export type Severity = "error" | "warning"
export type ReferenceMode = "inject" | "read"

export interface Event {
  kind: EventKind
  /** Repo-relative paths (adapters may give absolute ones; the hook command converts them). Empty for prompt and reset. */
  files: string[]
  /** touch from a read: the whole file was read. */
  completeRead?: boolean
  /** verify from the CLI: --base. */
  baseRef?: string
  session?: { id: string; agentId?: string }
  cwd: string
}

export interface Match {
  file: string
  /** 1-based. */
  line: number
  endLine: number
  column: number
  text: string
  /** Exactly the names the detector declared for the rule. */
  captures: Record<string, string>
}

export interface ChangeSet {
  /** 1-based inclusive ranges in the current file. */
  changedLines: [start: number, end: number][]
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export interface ResolvedReference {
  /** "conventions/api-access.md#frontend-data-flow" */
  ref: string
  content: string
}

export interface DetectorRuleInput<Config> {
  id: string
  config: Config
  files: string[]
  context: ResolvedReference[]
}

export interface DetectorRun<Config> {
  event: DetectorEvent
  rules: DetectorRuleInput<Config>[]
  /** File absent = no baseline, the whole file is new. */
  changes: ReadonlyMap<string, ChangeSet>
  cache: Cache
  cwd: string
  signal: AbortSignal
}

export interface DetectorResult {
  findings: { rule: string; match: Match }[]
  /** rule null = the whole run failed. */
  errors: { rule: string | null; message: string }[]
}

export interface DetectorWarm<Config> {
  /** Every rule of this detector kind in the project. */
  rules: { id: string; config: Config }[]
  cache: Cache
  cwd: string
  signal: AbortSignal
}

export interface Detector<Config> {
  kind: string
  /** Input is unknown: schemas may apply defaults and refinements. */
  schema: ZodType<Config, ZodTypeDef, unknown>
  captures(config: Config): string[]
  events(config: Config): DetectorEvent[]
  run(input: DetectorRun<Config>): Promise<DetectorResult>
  /** Optional: build expensive caches ahead of events (rulecast warm, §13). */
  warm?(input: DetectorWarm<Config>): Promise<void>
}

export interface Finding {
  rule: string
  severity: Severity
  status: "new" | "preexisting"
  file: string
  line: number
  column: number
  message: string
  count: number
}

export interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string
  reason?: "mode" | "budget" | "tooLarge"
  /** State "read" of a reference from a rule repo: the absolute path of the file to read. */
  location?: string
}

export interface Delivery {
  findings: Finding[]
  preexistingSummary: { rule: string; file: string; count: number }[]
  references: DeliveredReference[]
  touches: string[]
  stop: "block" | "allow" | "capReached" | null
  warnings: string[]
}

export interface AdapterInput {
  /** The agent's directory; the project root is found from it. */
  cwd: string
  /** null: nothing to run for this input. */
  event: Event | null
  /** Start detector warm-up (§13). */
  warmup: boolean
}

export interface Adapter {
  name: string
  /** Budget handed to commit (§9); null = unlimited. */
  maxContextChars: number | null
  /** null: not an input this adapter handles. */
  parse(input: unknown): AdapterInput | null
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
}

export function emptyDelivery(): Delivery {
  return { findings: [], preexistingSummary: [], references: [], touches: [], stop: null, warnings: [] }
}
