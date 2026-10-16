import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { AGENT_DIR } from "../delivery/persist"
import { errorMessage, formatZodError } from "../errors"
import { FINDING_ID_VERSION } from "../finding-id"
import { git } from "../git"
import { VERSION } from "../version"

/**
 * The committed baseline: the findings a project has agreed to carry, by id (core/finding-id.ts),
 * so a full-repository run with no ref to diff against can still say "nothing got worse".
 *
 * It is the last resort of the three baselines. A session's start snapshots win, then a ref's merge
 * base, and this file only fills in when an event has neither (`rulecast run --all-files`,
 * `--files`, a staged run before the first commit). Hooks never read it.
 *
 * Only `rulecast baseline` writes it, and `--prune` only ever removes entries, so the file shrinks
 * as violations are fixed and never quietly grows into an amnesty.
 */
export const BASELINE_FILE = `${AGENT_DIR}/baseline.json`

const FORMAT_VERSION = 1

const ID = /^[0-9a-f]{16}$/

const documentSchema = z.object({
  version: z.literal(FORMAT_VERSION),
  findingIdVersion: z.number().int().positive(),
  rulecast: z.string(),
  total: z.number().int().nonnegative(),
  rules: z.record(
    z.object({
      count: z.number().int().nonnegative(),
      files: z.record(z.array(z.string().regex(ID, "not a finding id"))),
    }),
  ),
})

/** Rule id → file → ids. The nesting is what a partial run's staleness needs, and what keeps diffs readable. */
export type BaselineEntries = Map<string, Map<string, Set<string>>>

export interface CommittedBaseline {
  /** A different version from FINDING_ID_VERSION: no id in the file can match one computed now. */
  findingIdVersion: number
  /** The rulecast that last wrote the file; diagnostic only. */
  rulecast: string
  rules: BaselineEntries
}

/** The file is there and is not a baseline: never treated as absent, which would fail every legacy finding unexplained. */
export class BaselineFileError extends Error {
  constructor(problem: string) {
    super(`${BASELINE_FILE}: ${problem} (regenerate it with rulecast baseline --force)`)
  }
}

/** The file under `root`, or null when there is none. */
export async function readCommittedBaseline(root: string): Promise<CommittedBaseline | null> {
  let text: string
  try {
    text = await readFile(path.join(root, BASELINE_FILE), "utf8")
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null
    throw error
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new BaselineFileError(`not JSON (${errorMessage(error)})`)
  }
  const parsed = documentSchema.safeParse(data)
  if (!parsed.success) {
    throw new BaselineFileError(formatZodError(parsed.error, { schema: documentSchema }))
  }
  const rules: BaselineEntries = new Map()
  for (const [rule, entry] of Object.entries(parsed.data.rules)) {
    rules.set(rule, new Map(Object.entries(entry.files).map(([file, ids]) => [file, new Set(ids)])))
  }
  return { findingIdVersion: parsed.data.findingIdVersion, rulecast: parsed.data.rulecast, rules }
}

export function baselineHas(baseline: CommittedBaseline, rule: string, file: string, id: string): boolean {
  return baseline.rules.get(rule)?.get(file)?.has(id) === true
}

/** The baseline of these findings, written by this rulecast. */
export function buildBaseline(findings: readonly { id: string; rule: string; file: string }[]): CommittedBaseline {
  const rules: BaselineEntries = new Map()
  for (const { id, rule, file } of findings) {
    const files = rules.get(rule) ?? new Map<string, Set<string>>()
    rules.set(rule, files)
    const ids = files.get(file) ?? new Set<string>()
    files.set(file, ids)
    ids.add(id)
  }
  return { findingIdVersion: FINDING_ID_VERSION, rulecast: VERSION, rules }
}

export interface BaselineSize {
  entries: number
  rules: number
  files: number
}

export function baselineSize(baseline: CommittedBaseline): BaselineSize {
  let entries = 0
  const files = new Set<string>()
  for (const byFile of baseline.rules.values()) {
    for (const [file, ids] of byFile) {
      entries += ids.size
      files.add(file)
    }
  }
  return { entries, rules: baseline.rules.size, files: files.size }
}

/** Code-unit order, so the file is the same bytes on every machine whatever its locale. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The one writer. Sorted keys and ids, two-space indent and a trailing newline: the same findings
 * are the same bytes, so a prune that changed nothing leaves no diff. No timestamp, which would
 * churn every prune and conflict on every merge; `baselineAge` takes the age from git.
 */
export function serialiseBaseline(baseline: CommittedBaseline): string {
  const rules: Record<string, { count: number; files: Record<string, string[]> }> = {}
  let total = 0
  for (const rule of [...baseline.rules.keys()].sort(byCodeUnit)) {
    const byFile = baseline.rules.get(rule)!
    const files: Record<string, string[]> = {}
    let count = 0
    for (const file of [...byFile.keys()].sort(byCodeUnit)) {
      const ids = [...byFile.get(file)!].sort(byCodeUnit)
      if (ids.length === 0) continue
      files[file] = ids
      count += ids.length
    }
    if (count === 0) continue
    rules[rule] = { count, files }
    total += count
  }
  const document = {
    version: FORMAT_VERSION,
    findingIdVersion: baseline.findingIdVersion,
    rulecast: baseline.rulecast,
    total,
    rules,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

export async function writeCommittedBaseline(root: string, baseline: CommittedBaseline): Promise<void> {
  const file = path.join(root, BASELINE_FILE)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, serialiseBaseline(baseline))
}

/**
 * What a run can say about one baseline entry's rule and file:
 *
 * - `checked`: the rule ran on the file to completion, so an id it did not find is gone.
 * - `gone`: the rule or the file no longer exists, or the rule no longer applies to the file.
 * - `unchecked`: nothing is known — the rule is disabled, skipped, failed, or the file was not in
 *   this run. Its entries are kept.
 */
export type EntryVerdict = "checked" | "gone" | "unchecked"

export interface EntryRemoved {
  rule: string
  file: string
  id: string
}

/**
 * The entries a run shows are no longer there, and the baseline without them. `found` holds every
 * id the run saw, ignored ones included: an ignore on a baselined line is not a fix, and taking it
 * off again must not make the finding new.
 *
 * Only ever removes: the result is a subset of `baseline`, whatever the run found. New findings
 * are never added here; that is `rulecast baseline --force`, which is meant to be a visible step.
 */
export function pruneBaseline(
  baseline: CommittedBaseline,
  found: ReadonlySet<string>,
  verdict: (rule: string, file: string) => EntryVerdict,
): { next: CommittedBaseline; removed: EntryRemoved[] } {
  const rules: BaselineEntries = new Map()
  const removed: EntryRemoved[] = []
  for (const [rule, byFile] of baseline.rules) {
    const files = new Map<string, Set<string>>()
    for (const [file, ids] of byFile) {
      const state = verdict(rule, file)
      const kept = new Set<string>()
      for (const id of ids) {
        if (state === "gone" || (state === "checked" && !found.has(id))) removed.push({ rule, file, id })
        else kept.add(id)
      }
      if (kept.size > 0) files.set(file, kept)
    }
    if (files.size > 0) rules.set(rule, files)
  }
  return { next: { ...baseline, rules }, removed }
}

/**
 * The verdict for a run: `rules` are the project's rules, `ran` the pipeline's (rule → files it
 * completed), `exists` whether a file is still in the project.
 *
 * A rule the config no longer has is gone only when everything compiled: a rule repo that could not
 * be fetched, or a rule with an error, is missing from `rules` without having been removed.
 */
export function entryVerdict(options: {
  rules: readonly { id: string; enabled: boolean; matches(file: string): boolean }[]
  compiledCleanly: boolean
  ran: ReadonlyMap<string, readonly string[]>
  exists: (file: string) => boolean
}): (rule: string, file: string) => EntryVerdict {
  const byId = new Map(options.rules.map((rule) => [rule.id, rule]))
  const ran = new Map([...options.ran].map(([rule, files]) => [rule, new Set(files)]))
  return (id, file) => {
    const rule = byId.get(id)
    if (rule === undefined) return options.compiledCleanly ? "gone" : "unchecked"
    if (!options.exists(file)) return "gone"
    if (!rule.enabled) return "unchecked"
    if (!rule.matches(file)) return "gone"
    return ran.get(id)?.has(file) === true ? "checked" : "unchecked"
  }
}

/** Whether `file` (project-relative) is on disk under `root`. */
export function fileExists(root: string): (file: string) => boolean {
  return (file) => existsSync(path.join(root, file))
}

export interface BaselineAge {
  /** The first commit that touched the file; null when it was never committed. */
  added: Date | null
  /** The last one. */
  changed: Date | null
  /** The working tree differs from the last commit of it. */
  dirty: boolean
}

/**
 * From git, not the file's mtime, which is only when it was checked out. "Added" is the first
 * commit that touched the path and "changed" the last: a baseline added long ago and pruned last
 * week is being maintained; one never changed since it was added is the amnesty file to worry about.
 */
export async function baselineAge(root: string): Promise<BaselineAge> {
  const log = await git(root, ["log", "--follow", "--format=%cI", "--", BASELINE_FILE])
  const dates = log.ok ? log.stdout.split("\n").filter((line) => line !== "") : []
  const status = await git(root, ["status", "--porcelain", "--", BASELINE_FILE])
  return {
    added: dates.length === 0 ? null : new Date(dates.at(-1)!),
    changed: dates.length === 0 ? null : new Date(dates[0]!),
    dirty: status.ok && status.stdout.trim() !== "",
  }
}
