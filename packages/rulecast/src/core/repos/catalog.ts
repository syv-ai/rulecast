import { compileManifest } from "../compile/project"
import type { CompiledRule } from "../compile/rule"
import type { DetectorRegistry } from "../detection/registry"
import { errorMessage } from "../errors"
import type { Env } from "../home"
import { ensureRepo } from "./fetch"
import { repoLabel } from "./layout"
import { latestTag, remoteTags } from "./tags"

/**
 * The rule catalog: the rulecast repository itself (spec §4, Rule repos). `rulecast list --catalog`
 * browses it and `rulecast add` adopts from it; nothing else knows where it is or how it is grouped.
 */
export const DEFAULT_CATALOG = "https://github.com/syv-ai/rulecast"

/** RULECAST_CATALOG overrides the catalog's URL, for tests and forks. */
export function catalogUrl(env: Env): string {
  return env.RULECAST_CATALOG || DEFAULT_CATALOG
}

/**
 * The config's entry for the catalog, however its URL is spelled (`.git`, a trailing slash): the one
 * lookup `list --catalog` and `add` share, so they agree on what is configured. `url` is the entry's
 * own spelling when there is one, so rules are added to it rather than to a second entry.
 */
export function catalogEntry<Entry extends { repo: string; rev?: string }>(
  repos: readonly Entry[],
  env: Env,
): { url: string; entry: Entry | null } {
  const url = catalogUrl(env)
  // The whole URL, host included, with only `.git` and trailing slashes dropped. A URL compares
  // case-insensitively, as GitHub's owners and repositories do (Syv-AI/rulecast); a path does not.
  const plain = (value: string) => {
    const trimmed = value
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
    return /^https?:\/\//i.test(trimmed) ? trimmed.toLowerCase() : trimmed
  }
  const same = (other: string) => plain(other) === plain(url)
  const entry = repos.find((repo) => repo.repo !== "local" && same(repo.repo)) ?? null
  return { url: entry?.repo ?? url, entry }
}

export interface Catalog {
  url: string
  rev: string
  /** "syv-ai/rulecast@v0.6.0". */
  label: string
  /** The checkout, where the rules' cited docs are read from. */
  dir: string
  rules: CompiledRule[]
}

/** The catalog at `rev` (the config's pin), else at its latest tag; a message when it cannot be loaded. */
export async function loadCatalog(
  url: string,
  rev: string | undefined,
  home: string,
  registry: DetectorRegistry,
): Promise<Catalog | string> {
  try {
    let pinned = rev
    if (pinned === undefined) {
      const tag = latestTag(await remoteTags(url))
      if (tag === null) return `${url} has no version tags`
      pinned = tag.name
    }
    const dir = await ensureRepo(home, url, pinned)
    const { rules } = await compileManifest(dir, registry)
    return { url, rev: pinned, label: repoLabel(url, pinned), dir, rules }
  } catch (error) {
    return errorMessage(error)
  }
}

/** A catalog rule's group: the prefix before "/", or "general". */
export const groupOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : "general")

/**
 * Packs: groups adopted as a whole, with the note that says who they are for. loop-safety matches
 * the test files of almost every project, and it is for people who run agents with nobody watching.
 */
export const PACKS: Record<string, { title: string; note: string }> = {
  "loop-safety": {
    title: "Loop safety",
    note:
      "For agents that run with nobody watching. It catches the shortcuts a loop takes to make tests " +
      "pass: skipped or focused tests, deleted assertions, new lint, type and coverage suppressions in " +
      "the code or in checker config, changed coverage thresholds, and edits to CI, git hooks or rulecast's own config. Warnings while you watch; errors, " +
      "and refused edits to that config, in unattended mode (set RULECAST_MODE=unattended or " +
      "`mode: unattended` for /goal, claude -p and scheduled runs; on by itself in CI).",
  },
}

/**
 * The catalog rules `names` select: a rule id, or a group name for every rule in it. An unknown
 * name is returned as `unknown`, so the caller can refuse before writing anything.
 */
export function selectRules(catalog: Catalog, names: readonly string[]): { rules: CompiledRule[]; unknown: string[] } {
  const known = new Set(catalog.rules.flatMap((rule) => [rule.id, groupOf(rule.id)]))
  return {
    rules: catalog.rules.filter((rule) => names.includes(rule.id) || names.includes(groupOf(rule.id))),
    unknown: names.filter((name) => !known.has(name)),
  }
}
