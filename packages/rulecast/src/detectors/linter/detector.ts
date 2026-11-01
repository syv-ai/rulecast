import { filesFrom } from "../../core/detection/paths"
import { pastDeadline, sourceReader } from "../../core/detection/per-rule"
import { excerpt } from "../../core/detection/positions"
import { runTool } from "../../core/detection/tool"
import { errorMessage } from "../../core/errors"
import { repositoryTop } from "../../core/git"
import type { CheckResult, Detector, DetectorResult, DetectorRuleInput, Match } from "../../core/types"
import { describeTool, resolveTool, runDirFor } from "./resolve"
import { type LinterConfig, linterSchema, type ToolName } from "./schema"
import { type LinterFinding, TOOLS } from "./tools"

/** Where one run of a tool happens: its working directory, the project root and the repository's top. */
interface RunPlace {
  dir: string
  root: string
  top: string
}

/** `files` are repo-relative; the tool is given them from `place.dir`, and its findings come back repo-relative. */
async function runLinter(
  tool: ToolName,
  files: string[],
  select: string[],
  place: RunPlace,
  signal: AbortSignal,
): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, place.dir, undefined, place.top)
  const args = [...resolved.prefix, ...TOOLS[tool].args(filesFrom(place.dir, place.root, files), select)]
  // Linters exit non-zero when they find something; the output is the answer, not the exit code.
  const { stdout } = await runTool(resolved.command, args, {
    cwd: place.dir,
    signal,
    notFound: `${tool} is not installed`,
  })
  return TOOLS[tool].parse(stdout, place.dir, place.root)
}

/**
 * Content that is not on disk (a staged run, `--to-ref`), one file per process on stdin under the
 * file's real path, so path-keyed configuration — eslint `files:` globs, ruff `per-file-ignores`,
 * a nested pyproject.toml — applies exactly as it would to the file on disk.
 */
async function runLinterOnContent(
  tool: ToolName,
  files: string[],
  select: string[],
  read: (file: string) => Promise<string | null>,
  place: RunPlace,
  signal: AbortSignal,
): Promise<LinterFinding[]> {
  const resolved = await resolveTool(tool, place.dir, undefined, place.top)
  const local = filesFrom(place.dir, place.root, files)
  const findings: LinterFinding[] = []
  for (const [index, file] of files.entries()) {
    const stdin = await read(file)
    if (stdin === null) continue
    const args = [...resolved.prefix, ...TOOLS[tool].stdinArgs!(local[index]!, select)]
    const { stdout } = await runTool(resolved.command, args, {
      cwd: place.dir,
      signal,
      notFound: `${tool} is not installed`,
      stdin,
    })
    // A tool that names no file for stdin input (gitleaks) means the file it was given.
    findings.push(
      ...TOOLS[tool]
        .parse(stdout, place.dir, place.root)
        .map((finding) => (finding.file ? finding : { ...finding, file })),
    )
  }
  return findings
}

/**
 * The files grouped by the directory the tool lints them from (`runDirFor`), in first-file order.
 * A project with its configs at the root is one group, run from the root as it always was.
 */
async function byRunDir(tool: ToolName, files: string[], root: string, top: string): Promise<Map<string, string[]>> {
  const seen = new Map<string, Promise<boolean>>()
  const dirs = await Promise.all(files.map((file) => runDirFor(tool, file, root, top, seen)))
  const groups = new Map<string, string[]>()
  for (const [index, dir] of dirs.entries()) {
    const group = groups.get(dir)
    if (group) group.push(files[index]!)
    else groups.set(dir, [files[index]!])
  }
  return groups
}

export const linterDetector: Detector<LinterConfig> = {
  kind: "linter",
  schema: linterSchema,
  captures: () => ["message", "ruleId"],
  // A copy: compileRule stores this as the rule's stages, and module-level data must not escape into it.
  events: (config) => [...TOOLS[config.tool].events],
  takesContent: (config) => TOOLS[config.tool].stdinArgs !== undefined,
  async run(input) {
    const result: DetectorResult = { findings: [], errors: [] }
    // One run per tool for the rules that name their linter rules, with those rules turned on, and
    // one for the rules that take every finding, which must see only what the project's own config
    // reports. Most configs have only one kind, so most tools still run once.
    const runs = new Map<string, { tool: ToolName; select: string[]; rules: DetectorRuleInput<LinterConfig>[] }>()
    for (const rule of input.rules) {
      const key = `${rule.config.tool}:${rule.config.rules ? "named" : "all"}`
      const group = runs.get(key)
      if (group) group.rules.push(rule)
      else runs.set(key, { tool: rule.config.tool, select: [], rules: [rule] })
    }
    for (const group of runs.values()) {
      group.select = [...new Set(group.rules.flatMap((rule) => rule.config.rules ?? []))].sort()
    }
    const onDisk = input.fromDisk !== false
    const read = onDisk ? sourceReader(input.cwd) : input.read
    const top = await repositoryTop(input.cwd)

    await Promise.all(
      [...runs.values()].map(async ({ tool, select, rules }) => {
        const files = [...new Set(rules.flatMap((rule) => rule.files))].sort()
        if (files.length === 0) return
        // Everything that can fail for this tool is inside one guard, reading the files for
        // {{text}} included: an unreadable file must not escape as a whole-run error and take the
        // other tools down with it (spec §14).
        try {
          const groups = await byRunDir(tool, files, input.cwd, top)
          const findings = (
            await Promise.all(
              [...groups].map(([dir, inDir]) => {
                const place = { dir, root: input.cwd, top }
                return onDisk
                  ? runLinter(tool, inDir, select, place, input.signal)
                  : runLinterOnContent(tool, inDir, select, read, place, input.signal)
              }),
            )
          ).flat()
          for (const finding of findings) {
            const match: Match = {
              file: finding.file,
              line: finding.line,
              endLine: finding.endLine,
              column: finding.column,
              text: TOOLS[tool].redacts ? "[redacted]" : excerpt(await read(finding.file), finding),
              captures: { message: finding.message, ruleId: finding.ruleId },
              ...(TOOLS[tool].redacts && { redacted: true }),
            }
            for (const rule of rules) {
              if (!rule.files.includes(finding.file)) continue
              if (rule.config.rules && !rule.config.rules.includes(finding.ruleId)) continue
              result.findings.push({ rule: rule.id, match })
            }
          }
        } catch (error) {
          if (pastDeadline(error, input)) throw error
          // One error per rule: a whole-run error would disable the other tools too.
          const message = errorMessage(error)
          for (const rule of rules) result.errors.push({ rule: rule.id, message })
        }
      }),
    )
    return result
  },
  async check(input) {
    // One result per tool, in first-use order: every rule naming a tool shares its fate.
    const byTool = new Map<ToolName, string[]>()
    for (const rule of input.rules) {
      const group = byTool.get(rule.config.tool)
      if (group) group.push(rule.id)
      else byTool.set(rule.config.tool, [rule.id])
    }
    // Doctor has no files, so it asks from the root, where a file with no config of its own is
    // linted from. A tool installed only in a package's node_modules shows as missing here, though
    // a run over that package's files finds it.
    const top = await repositoryTop(input.cwd)
    return Promise.all(
      [...byTool].map(async ([tool, rules]): Promise<CheckResult> => {
        const described = await describeTool(tool, input.cwd, { signal: input.signal, top })
        if (!described.found) return { what: tool, level: "error", detail: "not installed", rules }
        const detail = described.how === "path" ? `${described.command} (PATH)` : described.command
        return { what: tool, level: "ok", detail, rules: [] }
      }),
    )
  },
}
