import { parse } from "yaml"

import { PRE_COMMIT_CONFIG } from "../detectors/hook/resolve"

/** A hook the project already declares, as init offers it. */
export interface DetectedHook {
  /** The rule id init would give it: `hook/mypy`, `hook/pre-commit-typecheck`. */
  id: string
  /** The hook's own name. */
  name: string
  /** The `detect.hook` config that runs it. */
  detect: { "pre-commit": string } | { lefthook: string }
  /** The rule's `files`, from a lefthook job's glob; null: every file, and the runner filters. */
  files: string | null
  /** It looks like a formatter or a fixer: offered, never ticked, since it would change files. */
  modifies: boolean
  /** The config that declares it, which the rule cites until the developer names a convention. */
  source: string
}

const LEFTHOOK_CONFIGS = ["lefthook.yml", ".lefthook.yml", "lefthook.yaml", ".lefthook.yaml"]

/** Names that say "I rewrite files": the hook is a formatter or a fixer. */
const FIXER_NAME =
  /format|fmt|fix|prettier|black|isort|autopep8|yapf|trailing-whitespace|end-of-file|mixed-line-ending|pretty/i
/** Flags that turn a checker into a fixer. */
const FIXER_FLAG = /(^|\s)(--fix\b|--write\b|-w\b|--in-place\b|format\b)/

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** A hook that runs rulecast would run rulecast from inside rulecast. */
const runsRulecast = (command: string) => /(^|[\s/])rulecast(\s|$)/.test(command) || /src\/cli\.ts\s+run/.test(command)

function load(source: string | null): unknown {
  if (source === null) return null
  try {
    return parse(source)
  } catch {
    return null
  }
}

function preCommitHooks(config: unknown): DetectedHook[] {
  if (!isObject(config) || !Array.isArray(config.repos)) return []
  const hooks: DetectedHook[] = []
  for (const repo of config.repos) {
    // meta hooks check the config itself, not the code.
    if (!isObject(repo) || repo.repo === "meta" || !Array.isArray(repo.hooks)) continue
    for (const hook of repo.hooks) {
      if (!isObject(hook) || typeof hook.id !== "string") continue
      const args = Array.isArray(hook.args) ? hook.args.map(text).join(" ") : ""
      const entry = text(hook.entry)
      if (hook.id === "rulecast" || runsRulecast(entry)) continue
      hooks.push({
        id: `hook/${hook.id}`,
        name: text(hook.name) || hook.id,
        detect: { "pre-commit": hook.id },
        files: null,
        modifies: FIXER_NAME.test(hook.id) || FIXER_FLAG.test(` ${entry} ${args}`),
        source: PRE_COMMIT_CONFIG,
      })
    }
  }
  return hooks
}

/** lefthook's glob, where `*` crosses directories, as a rule's `files` pattern. */
export function globToRegex(glob: string): string {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === "*") {
      while (glob[i + 1] === "*") i++
      out += ".*"
    } else if (char === "?") out += "."
    else if (char === "{") out += "("
    else if (char === "}") out += ")"
    else if (char === ",") out += "|"
    else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return `^${out}$`
}

function lefthookJobs(jobs: unknown, hook: string, source: string, into: DetectedHook[]): void {
  const add = (name: string, job: JsonObject) => {
    const run = text(job.run)
    if (run === "" || runsRulecast(run)) return
    const glob = Array.isArray(job.glob) ? text(job.glob[0]) : text(job.glob)
    into.push({
      id: `hook/${hook}-${name}`,
      name,
      detect: { lefthook: `${hook}/${name}` },
      files: glob === "" ? null : globToRegex(glob),
      modifies: job.stage_fixed === true || FIXER_FLAG.test(` ${run}`),
      source,
    })
  }
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      if (!isObject(job)) continue
      if (isObject(job.group)) lefthookJobs(job.group.jobs, hook, source, into)
      else if (typeof job.name === "string") add(job.name, job)
    }
  } else if (isObject(jobs)) {
    for (const [name, job] of Object.entries(jobs)) if (isObject(job)) add(name, job)
  }
}

/**
 * The hooks a project declares in .pre-commit-config.yaml and lefthook.yml, read as files: init
 * offers them before anything is installed, so no runner is asked. husky's hooks are shell scripts
 * with nothing structured to read, so they are not offered.
 */
export async function detectHooks(read: (file: string) => Promise<string | null>): Promise<DetectedHook[]> {
  const hooks = preCommitHooks(load(await read(PRE_COMMIT_CONFIG)))
  for (const file of LEFTHOOK_CONFIGS) {
    const config = load(await read(file))
    if (!isObject(config)) continue
    for (const [hook, body] of Object.entries(config)) {
      if (!isObject(body)) continue
      lefthookJobs(body.jobs, hook, file, hooks)
      lefthookJobs(body.commands, hook, file, hooks)
    }
    break
  }
  return hooks
}

/** The local rule init writes for a hook. */
export interface LocalRule {
  id: string
  name: string
  files?: string
  detect: Record<string, unknown>
  message: string
  context: string[]
}

export function hookRule(hook: DetectedHook): LocalRule {
  const runner = "lefthook" in hook.detect ? "lefthook" : "pre-commit"
  return {
    id: hook.id,
    name: `${hook.name} (${runner})`,
    ...(hook.files === null ? {} : { files: hook.files }),
    detect: { hook: hook.detect },
    message: "{{file}}:{{line}}: {{message}}",
    context: [`@${hook.source}`],
  }
}
