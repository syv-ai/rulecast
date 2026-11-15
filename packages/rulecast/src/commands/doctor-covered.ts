import { readFile } from "node:fs/promises"
import path from "node:path"

import { parse } from "yaml"
import type { CompiledProject } from "../core/compile/project"
import { type DetectorRule, isDetectorRule } from "../core/compile/rule"
import { filesFrom } from "../core/detection/paths"
import { runTool } from "../core/detection/tool"
import { repositoryTop } from "../core/git"
import { PRE_COMMIT_CONFIG, preCommitScope } from "../detectors/hook/resolve"
import { hookFileFilter, ruleFilterOf } from "../detectors/hook/scope"
import { resolveTool, runDirFor } from "../detectors/linter/resolve"
import type { LinterConfig } from "../detectors/linter/schema"

/**
 * A linter rule whose code the project's pre-commit already runs on the rule's files (Conductor
 * lead, 0.19.0). Said as info and never as "drop the rule": the overlap is harmless, and a rule can
 * be kept on purpose, to teach the fix at the edit, before any hook runs.
 *
 * Said only when doctor can be sure, so a line it leaves out costs little:
 * - the hook is in `.pre-commit-config.yaml` at the repository's top and runs at commit, and its
 *   files filter is known and carried over whole (a remote hook's manifest read from pre-commit's
 *   clone, or the config's own keys);
 * - for ruff, every one of the rule's codes is a full code, and whether it is on for a file is
 *   ruff's own answer for that file under the hook's args, per-file-ignores included. The answer
 *   comes from a `# noqa` naming the codes, which RUF100 reports back as unused (on) or non-enabled
 *   (off); `--show-settings` lists per-file-ignores without applying them to the file.
 *
 * eslint, gitleaks, biome and oxlint are not judged yet.
 */
export async function coveredByHooks(
  project: CompiledProject,
  files: readonly string[],
  signal: AbortSignal,
): Promise<{ rule: string; level: "info"; detail: string }[]> {
  const rules = project.rules.filter(
    (rule): rule is DetectorRule =>
      isDetectorRule(rule) &&
      rule.enabled &&
      rule.detector.kind === "linter" &&
      (rule.detector.config as LinterConfig).tool === "ruff",
  )
  if (rules.length === 0) return []
  const top = await repositoryTop(project.root).catch(() => project.root)
  const hooks = await ruffHooks(top)
  if (hooks.length === 0) return []
  const relative = path.relative(top, project.root)
  const prefix = relative === "" ? "" : `${relative.split(path.sep).join("/")}/`
  const lines: { rule: string; level: "info"; detail: string }[] = []
  for (const rule of rules) {
    const codes = (rule.detector.config as LinterConfig).rules
    // A prefix (B, E5) or the project's own config: which codes those take is not checked here.
    if (codes === undefined || !codes.every((code) => FULL_CODE.test(code))) continue
    const taken = files.filter((file) => rule.matches(file))
    if (taken.length === 0) continue
    for (const hook of hooks) {
      const args = selectionArgs(hook.args)
      if (args === null) continue
      const scope = await preCommitScope(hook.repo, hook.entry)
      if (scope.filter === null || ruleFilterOf(scope.filter, prefix).left.length > 0) continue
      const given = hookFileFilter({ ...scope, global: hook.global }, prefix, project.root)
      let on = 0
      let sure = true
      for (const file of taken) {
        if (given !== null && !given(file)) continue
        const enabled = await ruffEnables(project.root, top, file, codes, args, signal)
        if (enabled === null) {
          sure = false
          break
        }
        if (enabled) on++
      }
      if (!sure || on === 0) continue
      const where = `${hook.id} in ${PRE_COMMIT_CONFIG}`
      lines.push({
        rule: rule.id,
        level: "info",
        detail:
          on === taken.length
            ? `already covered by ${where}`
            : `covered for ${on} of ${taken.length} files by ${where}`,
      })
      break
    }
  }
  return lines
}

/** A ruff rule code with its number, as reported: E501, SLF001, PLR0913. A selector is shorter. */
const FULL_CODE = /^[A-Z]+[0-9]{3,}$/

/** pre-commit hook ids that run `ruff check` from astral-sh/ruff-pre-commit. */
const RUFF_HOOK_IDS = new Set(["ruff", "ruff-check"])

interface PreCommitHook {
  id: string
  args: string[]
  repo: Record<string, unknown>
  entry: Record<string, unknown>
  global: { files: string; exclude: string }
}

/** The hooks in the top's .pre-commit-config.yaml that run `ruff check` at commit. */
async function ruffHooks(top: string): Promise<PreCommitHook[]> {
  let text: string
  try {
    text = await readFile(path.join(top, PRE_COMMIT_CONFIG), "utf8")
  } catch {
    return []
  }
  let config: unknown
  try {
    config = parse(text)
  } catch {
    return []
  }
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  if (!object(config) || !Array.isArray(config.repos)) return []
  const strings = (value: unknown) =>
    Array.isArray(value) && value.every((each) => typeof each === "string") ? (value as string[]) : null
  const regex = (value: unknown) => (typeof value === "string" ? value : "")
  const global = { files: regex(config.files), exclude: regex(config.exclude) }
  const defaults = strings(config.default_stages)
  const found: PreCommitHook[] = []
  for (const repo of config.repos) {
    if (!object(repo) || !Array.isArray(repo.hooks)) continue
    const local = repo.repo === "local"
    for (const entry of repo.hooks) {
      if (!object(entry) || typeof entry.id !== "string") continue
      const runsRuff = local
        ? typeof entry.entry === "string" && /^(\S*\/)?ruff(\s+check)?(\s|$)/.test(entry.entry)
        : RUFF_HOOK_IDS.has(entry.id) && typeof repo.repo === "string" && repo.repo.includes("ruff-pre-commit")
      if (!runsRuff) continue
      // A local entry's own words after `ruff check` are args too.
      const own = local
        ? (entry.entry as string)
            .trim()
            .split(/\s+/)
            .slice(1)
            .filter((word) => word !== "check")
        : []
      const args = strings(entry.args ?? [])
      if (args === null) continue
      const stages = strings(entry.stages) ?? defaults
      if (stages !== null && !stages.includes("pre-commit") && !stages.includes("commit")) continue
      found.push({ id: entry.id, args: [...own, ...args], repo, entry, global })
    }
  }
  return found
}

/** Args that change nothing about which codes run on which file. */
const NEUTRAL = new Set([
  "--fix",
  "--no-fix",
  "--unsafe-fixes",
  "--no-unsafe-fixes",
  "--exit-non-zero-on-fix",
  "--show-fixes",
  "--no-show-fixes",
  "--force-exclude",
  "--no-cache",
  "--quiet",
  "-q",
  "--silent",
  "-s",
])

/** Args that do, each with a value, passed on to ruff as the hook gives them. */
const SELECTING = new Set([
  "--select",
  "--extend-select",
  "--ignore",
  "--extend-ignore",
  "--per-file-ignores",
  "--extend-per-file-ignores",
  "--config",
  "--target-version",
])

/** The hook's args that decide what runs on a file, or null when one is not known here. */
function selectionArgs(args: readonly string[]): string[] | null {
  const kept: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (NEUTRAL.has(arg) || arg.startsWith("--output-format")) continue
    const [name] = arg.split("=", 1)
    if (name === undefined || !SELECTING.has(name)) return null
    if (arg.includes("=")) kept.push(arg)
    else {
      const value = args[index + 1]
      if (value === undefined) return null
      kept.push(arg, value)
      index++
    }
  }
  return kept
}

/**
 * Whether ruff has every one of `codes` on for `file`, as the hook runs it: true, false, or null
 * when ruff's answer could not be read (it failed, or RUF100 is off for the file).
 */
async function ruffEnables(
  root: string,
  top: string,
  file: string,
  codes: readonly string[],
  args: readonly string[],
  signal: AbortSignal,
): Promise<boolean | null> {
  const dir = await runDirFor("ruff", file, root, top)
  const resolved = await resolveTool("ruff", dir, undefined, top)
  const [local] = filesFrom(dir, root, [file])
  const result = await runTool(
    resolved.command,
    [
      ...resolved.prefix,
      "check",
      "--no-cache",
      "--no-fix",
      ...args,
      "--extend-select",
      "RUF100",
      "--output-format",
      "json",
      "--stdin-filename",
      local!,
      "-",
    ],
    { cwd: dir, signal, notFound: "ruff is not installed", stdin: `x = 1  # noqa: ${codes.join(", ")}\n` },
  ).catch(() => null)
  if (result === null) return null
  let findings: unknown
  try {
    findings = JSON.parse(result.stdout)
  } catch {
    return null
  }
  if (!Array.isArray(findings)) return null
  const unused = findings.find(
    (finding): finding is { code: string; message: string } =>
      typeof finding === "object" && finding !== null && (finding as { code?: unknown }).code === "RUF100",
  )
  if (unused === undefined) return null
  // "Unused `noqa` directive (unused: `E501`; non-enabled: `SLF001`)": on is what ruff lists as
  // unused, a code it would have reported had the line broken it. Off, unknown, or not named: not on.
  const on = /(?:\(|; )unused: ([^;)]*)/.exec(unused.message)?.[1] ?? ""
  return codes.every((code) => on.includes(`\`${code}\``))
}
