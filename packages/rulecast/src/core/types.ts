import type { ZodType, ZodTypeDef } from "zod"

import type { DisabledGroup } from "./disabled"

/**
 * `start`: the session began or resumed. `shell-before` / `shell-after`: around one call of the
 * agent's shell tool, whose writes rulecast finds by comparing the working tree (session/tree.ts).
 */
export type EventKind =
  | "touch"
  | "edit"
  | "verify"
  | "prompt"
  | "reset"
  | "guard"
  | "start"
  | "shell-before"
  | "shell-after"
export type DetectorEvent = "edit" | "verify"
export type Severity = "error" | "warning"
export type ReferenceMode = "inject" | "read"

/**
 * What a `guard` event's write would do, as the agent's tool call describes it and before anything
 * has touched the disk. The adapter reports the intent; the pipeline turns it into the file's
 * proposed content, because only the pipeline may read the file it will be applied to.
 */
export interface WriteIntent {
  /** The whole file, for a tool that supplies it (Write).*/
  content?: string
  /** A replacement inside the current file (Edit). */
  edit?: { find: string; replace: string; all: boolean }
}

/**
 * Where a run reads the current content of a file from. The working tree for every hook; the index
 * for `rulecast run` on staged files, so a commit is judged as it will be committed; a commit for
 * `--to-ref`, so a push is judged as it will be pushed.
 */
export type ContentSource = { kind: "worktree" } | { kind: "index" } | { kind: "commit"; ref: string }

export interface Event {
  kind: EventKind
  /** Repo-relative paths (adapters may give absolute ones; the hook command converts them). Empty for prompt, reset, start and shell events. */
  files: string[]
  /** shell events: pairs a call's before and after states when the agent's payloads carry an id. */
  toolUseId?: string
  /** shell-after: the command exited non-zero. It may still have written files; an adapter may answer it differently. */
  failed?: boolean
  /** guard only: what the agent is about to write to `files[0]`. */
  intent?: WriteIntent
  /** touch from a read: the whole file was read. */
  completeRead?: boolean
  /** verify from the CLI: the commit the baseline is read from (the merge base for --from-ref). */
  baseCommit?: string
  /** verify from the CLI: where current content is read from. Absent: the working tree. */
  content?: ContentSource
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
  /**
   * Exactly the names the detector declared for the rule, plus, on a `scope: removed` finding, its
   * counts (REMOVED_VARIABLES).
   */
  captures: Record<string, string>
  /**
   * The match is about the file as a whole (a hook would reformat it), not the lines it spans, so
   * its id (core/finding-id.ts) hashes its text and captures. A kind whose every match is the
   * whole file says so once, with `Detector.wholeFile`.
   */
  wholeFile?: true
  /**
   * The source at the match is itself sensitive (a secret) and `text` was redacted: its id hashes
   * the text and captures, never the source line.
   */
  redacted?: true
  /**
   * Captures that are not part of what the finding *is*, only of what its message says: a removed
   * finding's counts, which change with every further deletion while the finding stays the same.
   * Whatever identifies a finding across runs (the stop gate's `findingKey`, a finding id) leaves
   * them out, as it does a detector's own volatile captures.
   */
  volatileCaptures?: readonly string[]
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
  /**
   * The file's content, null when it no longer exists. A detector that can read a file itself must
   * use this instead: before a write, the content that matters is the one the agent proposed, which
   * is not on disk and never will be if the write is refused.
   */
  read(file: string): Promise<string | null>
  /**
   * False when the files are not as they are on disk — a staged run reads the index, `--to-ref` a
   * commit — and this detector declared `takesContent`: it must read through `read` and hand the
   * text to its tool under the file's path, never let the tool open the path. Absent: true.
   */
  fromDisk?: boolean
  /** File absent = no baseline, the whole file is new. */
  changes: ReadonlyMap<string, ChangeSet>
  cache: Cache
  /** Project settings from .rulecast-config.yaml; a detector that needs none ignores them. */
  settings: DetectorSettings
  cwd: string
  signal: AbortSignal
  /**
   * `Date.now()` after which this run's results are discarded (§13). A detector whose work is
   * synchronous must bound itself against this: `signal` cannot help it, because the timer that
   * fires it only runs when the event loop is free, and synchronous work is what keeps it busy.
   */
  deadlineAt: number
  /**
   * Attach each finding's `fix`, for a rule whose config carries one. Set only by `rulecast fix`
   * and `rulecast test`, never on a hook's path: rulecast never rewrites an agent's file behind its
   * back (detectors/hook/modified.ts). Absent: false, and a detector computes no edit.
   */
  fixes?: boolean
}

/**
 * One replacement in a file: the text `read` returned, from `start` to `end` (UTF-16 code units,
 * the indexes a JavaScript string uses; end exclusive), becomes `text`.
 */
export interface TextEdit {
  start: number
  end: number
  text: string
}

export interface DetectorResult {
  /** `fix`: only when the run asked for `fixes` and the rule's config has one. */
  findings: { rule: string; match: Match; fix?: TextEdit }[]
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

export interface DetectorCheck<Config> {
  /** Every rule of this detector kind in the project. */
  rules: { id: string; config: Config }[]
  /** Project settings from .rulecast-config.yaml; the same value a run gets. */
  settings: DetectorSettings
  /** The process environment, so a check can look for credentials without reaching for process.env. */
  env: Readonly<Record<string, string | undefined>>
  cwd: string
  signal: AbortSignal
}

/** One thing `rulecast doctor` asked a detector about, and the answer (spec §5). */
export interface CheckResult {
  /** What was checked, as a person would name it: "ruff", "ast-grep", `model "haiku"`. */
  what: string
  level: "ok" | "warning" | "error"
  /** Why: a resolved path when it worked, the reason when it did not. */
  detail: string
  /** The rules this result decides the fate of; empty when it is about the kind as a whole. */
  rules: string[]
}

export interface Detector<Config> {
  kind: string
  /** Input is unknown: schemas may apply defaults and refinements. */
  schema: ZodType<Config, ZodTypeDef, unknown>
  captures(config: Config): string[]
  events(config: Config): DetectorEvent[]
  /**
   * Whether this detector reads only through `read`, and so can judge a write before it happens
   * (`refuse_write`). False for anything that hands a path to another program: the proposed file is
   * not on disk, so ruff, eslint, ast-grep's CLI or a `command` script would judge the old one.
   */
  guards?: boolean
  /**
   * Each file costs money or a third party sees it (§6, Consent). The core never preselects such a
   * rule in `init`, never runs it as a side effect — no container measurement on `touch`, no `doctor` dry
   * run, no `rulecast test` without a rule id — and budgets the files it is given per event.
   *
   * The core asks this rather than a kind name, the way it asks `guards`, so a second metered
   * detector needs no edit to the core.
   */
  metered?: boolean
  /** For `init`'s consent line: what one rule of this kind costs and where the file goes. */
  cost?(config: Config): string
  /**
   * Most files this detector is given in one verify; the most recently edited are kept (§6).
   * `setting` names the config key that raises it, because a warning that does not name its lever
   * leaves nobody knowing what to do.
   */
  fileBudget?(settings: DetectorSettings): { max: number; setting: string }
  /** Added to a verify timeout's warning, when this kind can legitimately need far longer. */
  timeoutHint?: string
  /**
   * A match is the whole file rather than a range in it, so any write to a matching file is
   * evidence for `refuse_write`, not only a write that inserts the matched text.
   */
  wholeFile?: boolean
  /**
   * This rule's tool can be handed a file's content under its real path (ruff `--stdin-filename`,
   * a model prompt). When the content is not the working tree, such a rule is run with
   * `fromDisk: false`; one that cannot is given a scratch copy instead, which configuration keyed
   * on the file's path no longer matches (spec §12).
   */
  takesContent?(config: Config): boolean
  /**
   * This rule's tool reads the whole project (imports, a venv, node_modules), so a scratch copy of
   * the files breaks it. When the content is not the working tree, such a rule runs on the working
   * tree if its files there equal the content, and is skipped with a warning otherwise: rulecast
   * never stashes to make them equal (spec §12).
   */
  wholeProject?(config: Config): boolean
  /**
   * Its tool may change files while it runs and puts them back after (a formatter run as a hook).
   * The core runs such a kind after every other kind, alone, so nothing reads a file mid-change.
   */
  changesFiles?: boolean
  /**
   * Captures whose value differs between two runs over the same content (a model's `reason`). A
   * finding's id (core/finding-id.ts) leaves them out, so it stays the same from run to run.
   */
  volatileCaptures?: readonly string[]
  /**
   * This rule's config carries a fix that `rulecast fix` may apply: with `DetectorRun.fixes`, its
   * findings come with a `fix`. A detector that declares it must read only through `read`, because
   * fixes are applied over several passes in memory before anything is written. The core asks this
   * rather than a kind name, so `fix` on any other detector is refused with no edit to the core.
   */
  fixable?(config: Config): boolean
  run(input: DetectorRun<Config>): Promise<DetectorResult>
  /** Optional: build expensive caches ahead of events (rulecast warm, §13). */
  warm?(input: DetectorWarm<Config>): Promise<void>
  /**
   * Optional: static checks of rules against the project's own files, for `rulecast validate` —
   * a hook id its .pre-commit-config.yaml does not declare. Nothing is run and the environment is
   * not asked; that is `check`'s job.
   */
  validate?(input: {
    rules: { id: string; config: Config }[]
    cwd: string
  }): Promise<{ rule: string; message: string }[]>
  /** Optional: report what this detector's rules need from the environment (rulecast doctor, §5). */
  check?(input: DetectorCheck<Config>): Promise<CheckResult[]>
}

export interface Finding {
  /**
   * Stable across runs (core/finding-id.ts): the same violation keeps it when lines above it move.
   * A merged finding (`count` > 1) carries the id of the match it shows, the earliest in the file.
   */
  id: string
  rule: string
  severity: Severity
  status: "new" | "preexisting"
  file: string
  line: number
  endLine: number
  column: number
  message: string
  count: number
  /** The detector's captures and the matched text, for a grouped rendering's per-site line. */
  captures?: Record<string, string>
  /** `rulecast fix` can apply this rule's fix. Present only when true. */
  fixable?: true
}

export interface DeliveredReference {
  ref: string
  state: "full" | "pointer" | "read" | "missing"
  content?: string
  reason?: "mode" | "budget" | "tooLarge"
  /** State "read" of a reference from a rule repo: the absolute path of the file to read. */
  location?: string
}

/** What the context budget left out. A renderer says how much is missing; it never recomputes it. */
export interface Omitted {
  /** Findings of a rule that is still delivered, and how many files they were in. */
  findings: { rule: string; count: number; files: number; swept?: true }[]
  /** Rules dropped whole, with their findings: only when the floor itself did not fit. */
  rules: number
  preexisting: number
}

export interface Delivery {
  findings: Finding[]
  /**
   * Pre-existing findings in full, for `rulecast run`'s JSON and SARIF (PipelineOptions.listPreexisting).
   * Absent under a hook: an agent is given `preexistingSummary` instead.
   */
  preexisting?: Finding[]
  preexistingSummary: { rule: string; file: string; count: number }[]
  references: DeliveredReference[]
  touches: string[]
  /**
   * At an agent's stop. `report`: unattended only — the gate will not block for these findings
   * again, so the agent is held once more to record them as unresolved (session/decide.ts `gate`).
   * `incomplete`: unattended only — nothing blocks, but configured rules did not run, so the main
   * agent is held once per prompt to say in its report that those checks did not happen.
   */
  stop: "block" | "allow" | "capReached" | "report" | "incomplete" | null
  /** Decided in unattended mode: nobody answers the agent, so the adapter words its stop for that. */
  unattended?: true
  warnings: string[]
  /** `message` template per rule with findings: the skeleton a grouped rendering prints once. */
  templates: Record<string, string>
  omitted: Omitted
  /** Absolute path of the untrimmed delivery, written when even the floor did not fit; null when it did. */
  overflowPath: string | null
  /** The findings are in files the agent's shell command changed: the title says so. Absent: an edit tool. */
  via?: "shell"
  /**
   * Files with findings that changed outside the agent's tool calls (spec §9, Shell edits): printed
   * under their own heading, after the agent's own, and never blocking. Set at a stop.
   */
  swept?: string[]
  /**
   * Findings of `refuse_write` rules in files the agent changed with its shell (spec §9, Shell
   * edits): the write could not be refused before it happened, so the agent is told to revert it.
   * `dirtyAtStart`: the file had the user's uncommitted changes, so reverting the whole file is wrong.
   * `shared`: another agent's shell call ran at the same time, so part of the change may be theirs
   * and reverting the whole file is wrong too.
   */
  refused?: { file: string; rule: string; dirtyAtStart: boolean; shared?: true }[]
  /**
   * For the user, not the agent (spec §9, Oversight): the config changed this session, ignores were
   * added. Attached after the budget is spent and never part of agent context under a hook adapter.
   */
  notices?: string[]
  /**
   * Configured rules that did not run (#29), grouped by why. Set at every stop in unattended mode —
   * not once per context, as warnings are — and on every `rulecast run`. Never priced into the budget.
   */
  disabled?: DisabledGroup[]
  /**
   * For the agent, each said once per session: what changes how it should read this delivery, such
   * as another agent's shell call running alongside its own. Printed first, so a cut never drops it.
   */
  agentNotices?: string[]
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
  /**
   * Adds the hooks. `updated` (optional, for adapters that can tell): the adapter's own hooks whose
   * command differed from `command` and were rewritten — an older install upgraded in place.
   */
  merge(
    settings: unknown,
    command: string,
    verifyMs: number,
  ): { settings: unknown; added: string[]; updated?: string[] }
  remove(settings: unknown): { settings: unknown; removed: string[] }
  /**
   * Whether the installed hooks run only the project's own rulecast (node_modules/.bin), so one on
   * the PATH does not count (`doctor`). Absent: the adapter cannot tell.
   */
  local?(settings: unknown): boolean
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
  return {
    findings: [],
    preexistingSummary: [],
    references: [],
    touches: [],
    stop: null,
    warnings: [],
    templates: {},
    omitted: { findings: [], rules: 0, preexisting: 0 },
    overflowPath: null,
  }
}
