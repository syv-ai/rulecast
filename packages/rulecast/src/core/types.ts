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
  /** verify from the CLI: the commit the baseline is read from (the merge base for --from-ref). */
  baseCommit?: string
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

export const LLM_PROVIDERS = ["claude-code", "opencode", "anthropic", "openai-compatible"] as const
export type LlmProviderName = (typeof LLM_PROVIDERS)[number]

/** Project-level `llm` settings from .rulecast-config.yaml (spec §6, §12). */
export interface LlmSettings {
  provider: LlmProviderName
  /** Overrides the provider's own endpoint; the only way to reach Azure OpenAI or Ollama. */
  baseUrl: string | null
  apiKeyEnv: string
  maxFilesPerVerify: number
}

/** Project settings the core passes to every detector run; only `llm` reads them today. */
export interface DetectorSettings {
  llm: LlmSettings
}

export function defaultDetectorSettings(): DetectorSettings {
  return { llm: { provider: "claude-code", baseUrl: null, apiKeyEnv: "ANTHROPIC_API_KEY", maxFilesPerVerify: 10 } }
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

export type InstallScope = "shared" | "personal"

export interface AdapterInstall {
  /** Paths whose presence means the project uses this agent (init); a trailing "/" means a directory. */
  markers: string[]
  /** Settings files, repo-relative, that hooks can be written to. */
  scopes: { scope: InstallScope; file: string }[]
  /** The hook command; local: rulecast is installed in the project's node_modules. */
  command(local: boolean): string
  merge(settings: unknown, command: string, verifyMs: number): { settings: unknown; added: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
}

export interface Adapter {
  name: string
  /** Shown to people: "Claude Code". */
  label: string
  /** Budget handed to commit (§9); null = unlimited. */
  maxContextChars: number | null
  /** Recently read or edited files the agent re-attaches to its context after compaction; reset re-delivers their touch context (§9). 0 = none. */
  restoredFiles: number
  /** null: not an input this adapter handles. */
  parse(input: unknown): AdapterInput | null
  format(delivery: Delivery, event: Event, options: { maxMatchesPerRule: number }): { stdout: string; exitCode: number }
  /** null: the agent has no hooks to install. */
  install: AdapterInstall | null
}

export function emptyDelivery(): Delivery {
  return { findings: [], preexistingSummary: [], references: [], touches: [], stop: null, warnings: [] }
}
