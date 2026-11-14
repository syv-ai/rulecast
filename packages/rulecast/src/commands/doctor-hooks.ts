import { realpathSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_FILE } from "../core/config/load"
import { commandsIn } from "../core/hook-plan"
import { configRootsAbove } from "../core/projects"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import type { Adapter } from "../core/types"
import {
  configLabel,
  hookConfigs,
  hookState,
  hooksTwice,
  leftoverPersonal,
  ownHookState,
  runIn,
  scopeConflict,
  scopeRoot,
} from "./install"

/**
 * The install command that upgrades the hooks in `file` where they are: a personal file's need
 * `--scope personal`, since a plain install there would ask for shared ones and be refused.
 */
export async function installRemedy(dir: string, adapter: Adapter, file: string | null): Promise<string> {
  const personal = adapter.install?.scopes.find((each) => each.scope === "personal")
  // Said where doctor runs: a personal install from here writes the file sessions here read.
  const scope = personal !== undefined && file?.endsWith(personal.file) === true ? "personal" : "shared"
  const install = scope === "personal" ? "rulecast install --scope personal here" : "rulecast install here"
  // Never a command that would be refused: what clears the refusal comes first.
  const conflict = await scopeConflict(dir, adapter, scope).catch(() => null)
  return conflict === null ? install : `${conflict.clear.join(", then ")}, then ${install}`
}

/** One line of doctor's hooks section, as these checks see it; doctor prints and counts it. */
export interface HookCheck {
  level: "warning" | "error" | "info"
  what: string
  detail: string
}

/**
 * What the hooks in `dir` cannot do that their settings alone do not show: refusing writes a config
 * needs refused, and running at all when a session starts below the configs. `guardRoots`: the
 * configs a session here reaches that have a refuse_write rule (install's refuseWriteRoots).
 */
export async function agentHookChecks(
  dir: string,
  adapter: Adapter,
  verifyMs: number,
  guardRoots: readonly string[],
  /** Rule repos a config here pins that are not in the cache (unfetchedRepos). */
  unfetched: readonly string[] = [],
): Promise<HookCheck[]> {
  const checks = await Promise.all([
    unfetched.length > 0
      ? unjudgedCheck(adapter, unfetched, await remedyFor(dir, adapter, verifyMs))
      : guardCheck(dir, adapter, verifyMs, guardRoots),
    launchDirCheck(dir, adapter, verifyMs),
    twiceCheck(dir, adapter),
    leftoverCheck(dir, adapter),
  ])
  return checks.filter((check): check is HookCheck => check !== null)
}

/**
 * The rule repos the configs a session in `dir` reaches pin and the cache lacks, as labels: until
 * they are fetched, whether one of their rules refuses writes is not known.
 */
export async function unfetchedRepos(dir: string, home: string): Promise<string[]> {
  const reached = await hookConfigs(dir, "doctor", undefined, () => {}).catch(() => null)
  const labels = (reached?.configs ?? []).flatMap((config) =>
    config.repos
      .filter((entry) => entry.repo !== "local" && entry.rev !== undefined)
      .filter((entry) => cachedRepo(home, entry.repo, entry.rev!) === null)
      .map((entry) => repoLabel(entry.repo, entry.rev!)),
  )
  return [...new Set(labels)]
}

/**
 * The guard the hooks in `dir` should have: wanted when a config refuses writes; while a pinned
 * repo is not in the cache, whatever is installed now, since nothing better is known.
 */
export async function judgedGuard(
  dir: string,
  adapter: Adapter,
  verifyMs: number,
  guardRoots: readonly string[],
  unfetched: readonly string[],
): Promise<boolean> {
  if (unfetched.length === 0) return guardRoots.length > 0
  if (guardRoots.length > 0) return true
  const [kept, dropped] = await Promise.all([
    hookState(dir, adapter, verifyMs, true).catch(() => null),
    hookState(dir, adapter, verifyMs, false).catch(() => null),
  ])
  // Installed now when leaving it out would change the file.
  return kept !== null && dropped !== null && dropped.stale.length > kept.stale.length
}

/** installRemedy for the hooks sessions in `dir` run. */
async function remedyFor(dir: string, adapter: Adapter, verifyMs: number): Promise<string> {
  return installRemedy(dir, adapter, (await hookState(dir, adapter, verifyMs).catch(() => null))?.file ?? null)
}

function unjudgedCheck(adapter: Adapter, unfetched: readonly string[], remedy: string): HookCheck {
  return {
    level: "warning",
    what: `${adapter.label} write guard`,
    detail: `can't be judged until ${unfetched.join(", ")} ${unfetched.length === 1 ? "is" : "are"} fetched: a rule there may refuse writes; run ${remedy} (it fetches them)`,
  }
}

const configsText = (dir: string, roots: readonly string[]) =>
  roots.map((root) => path.join(configLabel(dir, root), CONFIG_FILE)).join(", ")

/**
 * A config refuses writes, and the hooks here have no hook before an edit: nothing is refused, and
 * the rule only reports after the write. An error: the config says a write must not happen.
 */
/**
 * Hooks are installed in `dir`, and the write guard is not among them: a refuse_write rule there
 * refuses nothing until `rulecast install` adds it.
 */
export async function guardMissing(dir: string, adapter: Adapter, verifyMs: number): Promise<boolean> {
  const [needed, without] = await Promise.all([
    hookState(dir, adapter, verifyMs, true).catch(() => null),
    hookState(dir, adapter, verifyMs, false).catch(() => null),
  ])
  return needed !== null && without !== null && needed.missing.length > without.missing.length
}

async function guardCheck(
  dir: string,
  adapter: Adapter,
  verifyMs: number,
  guardRoots: readonly string[],
): Promise<HookCheck | null> {
  // Not installed at all, or unreadable: doctor's hooks line says so.
  if (guardRoots.length === 0 || !(await guardMissing(dir, adapter, verifyMs))) return null
  const configs = configsText(dir, guardRoots)
  return {
    level: "error",
    what: `${adapter.label} write guard`,
    detail:
      `${configs} ${guardRoots.length === 1 ? "has" : "have"} refuse_write rules, but no hook runs rulecast before an edit, ` +
      `so no write is refused; run ${await remedyFor(dir, adapter, verifyMs)}`,
  }
}

/**
 * Claude Code reads `.claude/settings.json` only in the directory a session starts in; above it,
 * only `settings.local.json` at the checkout's top, with $CLAUDE_PROJECT_DIR still the start
 * directory. So a session started here, below configs, runs no rulecast unless this directory's
 * own settings have its hooks. A directory that is a checkout's top with its own settings (a linked
 * worktree under `.claude/worktrees`, say) is judged by those, like any other.
 */
async function launchDirCheck(dir: string, adapter: Adapter, verifyMs: number): Promise<HookCheck | null> {
  const install = adapter.install
  if (install === null) return null
  const here = await ownHookState(dir, adapter, verifyMs).catch(() => null)
  if (here !== null) return null
  const start = path.resolve(dir)
  // In this checkout and above it; another checkout of the repository is not this one's (projects.ts).
  const above = configRootsAbove(start).filter((root) => path.resolve(root) !== start)
  if (above.length === 0) return null
  const what = `${adapter.label} sessions started here`
  // checkoutOf answers in real paths: compared and named from this directory's real path.
  const real = realpathSync(start)
  // Where the agent reads the personal file for sessions here: the checkout's top, or the main checkout's.
  const top = realpathSync(scopeRoot(start, adapter, "personal"))
  const personal = install.scopes.find((scope) => scope.scope === "personal")
  if (top !== real && personal !== undefined) {
    const local = await readJson(path.join(top, personal.file))
    if (local !== null && install.remove(local).removed.length > 0) {
      const file = path.join(configLabel(real, top), personal.file)
      const absolute = commandsIn(local).some((command) => install.dirOf?.(command) != null)
      // Doctor's hooks line names them; only a command that cannot run from here needs saying.
      if (absolute) return null
      return {
        level: "warning",
        what,
        detail:
          `read the personal hooks in ${file}, which run their script from the directory a session starts in, ` +
          `so every hook fails here; run rulecast install --scope personal in ${configLabel(real, top)}`,
      }
    }
  }
  const withHooks: string[] = []
  for (const ancestor of ancestorsUpTo(start, above[above.length - 1]!)) {
    if ((await hookState(ancestor, adapter, verifyMs).catch(() => null)) !== null) withHooks.push(ancestor)
  }
  const remedy =
    withHooks.length > 0
      ? `start it in ${configLabel(start, withHooks[0]!)}, or run rulecast install here`
      : "run rulecast install here, or where sessions start"
  return {
    level: "warning",
    what,
    detail:
      `run no rulecast hooks: ${configsText(start, above)} ${above.length === 1 ? "is" : "are"} above this directory, ` +
      `and ${adapter.label} reads its project settings only where a session starts; ${remedy}`,
  }
}

/**
 * The shared settings here and the personal file the agent reads for a session here both run
 * rulecast: Claude Code merges identical handlers only, so it runs twice on every event. An error.
 */
async function twiceCheck(dir: string, adapter: Adapter): Promise<HookCheck | null> {
  const twice = await hooksTwice(dir, adapter).catch(() => null)
  if (twice === null) return null
  return {
    level: "error",
    what: `${adapter.label} hooks twice`,
    detail:
      `${twice.shared} and ${twice.personal} both run rulecast for sessions here, so it runs twice on every event; ` +
      `keep one: rulecast uninstall --scope personal ${runIn(dir, path.dirname(path.dirname(path.resolve(dir, twice.personal))))} removes ${twice.personal}'s, ` +
      `rulecast uninstall --scope shared here removes ${twice.shared}'s`,
  }
}

/**
 * A personal settings file here, below the checkout's top, with rulecast's hooks: Claude Code reads
 * that file only at the top (the main checkout's, from a worktree), so these never run.
 */
async function leftoverCheck(dir: string, adapter: Adapter): Promise<HookCheck | null> {
  const file = await leftoverPersonal(dir, adapter).catch(() => null)
  if (file === null) return null
  const read = path.relative(realpathSync(dir), path.join(realpathSync(scopeRoot(dir, adapter, "personal")), file))
  return {
    level: "warning",
    what: `${adapter.label} leftover hooks`,
    detail:
      `${file} here has rulecast's hooks, but Claude Code never reads it: the personal file it reads for sessions here is ${read}; ` +
      "clean this one up with rulecast uninstall --scope personal here",
  }
}

/** The directories strictly above `start`, nearest first, up to and including `last`. */
function ancestorsUpTo(start: string, last: string): string[] {
  const stop = path.resolve(last)
  const found: string[] = []
  for (let current = path.dirname(start); ; current = path.dirname(current)) {
    found.push(current)
    if (current === stop || path.dirname(current) === current) break
  }
  return found
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown
  } catch {
    return null
  }
}

/**
 * Doctor where no config is at or above `dir`: the hooks sessions started here still run, and what
 * is wrong with them, so a directory whose configs are all below it is not left unexplained.
 */
export async function hooksWithoutProject(dir: string, adapter: Adapter): Promise<HookCheck[]> {
  const verifyMs = (await hookConfigs(dir, "doctor", undefined, () => {}).catch(() => null))?.verifyMs ?? 60_000
  const state = await hookState(dir, adapter, verifyMs).catch(() => null)
  const checks = await Promise.all([twiceCheck(dir, adapter), leftoverCheck(dir, adapter)])
  return [
    ...(state === null
      ? []
      : [
          {
            level: "info" as const,
            what: adapter.label,
            detail: `${state.file} runs rulecast for sessions started here`,
          },
        ]),
    ...checks.filter((check): check is HookCheck => check !== null),
  ]
}
