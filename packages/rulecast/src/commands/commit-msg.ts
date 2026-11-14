import { readFile } from "node:fs/promises"
import path from "node:path"
import { type CliFormat, exitCodeFor, formatDelivery, quietly } from "../adapters/cli/format"
import { type CompiledProject, compile, diagnosticText } from "../core/compile/project"
import { isDetectorRule } from "../core/compile/rule"
import { CONFIG_FILE } from "../core/config/load"
import { combineDeliveries } from "../core/delivery/combine"
import { createReferenceResolver } from "../core/delivery/resolve"
import { detectionFor } from "../core/detection/context"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { findingIds } from "../core/finding-id"
import { git, repositoryTop } from "../core/git"
import { cacheHome, ensureProjectState } from "../core/home"
import { configRootsAbove, configRootsBelow, dedupe, displayPath } from "../core/projects"
import { fetchingRepos } from "../core/repos/provider"
import { decide } from "../core/session/decide"
import { emptyContext, emptyWork } from "../core/session/state"
import { sourceLines } from "../core/suppress"
import type { Delivery } from "../core/types"
import type { CliIo } from "./main"

/** What a commit message is called in findings: git's own name for the file. */
export const COMMIT_MESSAGE = "COMMIT_EDITMSG"

/**
 * git's scissors line, `<comment string> ------------------------ >8 ------------------------`: it
 * and everything below it is cut from the message (`commit --verbose`, `--cleanup=scissors`), in
 * every cleanup mode. It names the comment string git used, `auto` included.
 */
const SCISSORS = /^(\S+) -{24} >8 -{24}\r?$/m

/** How git cleans the message up, as far as the message file and git's config can tell. */
export interface MessageCleanup {
  /** The comment string when the message has no scissors line to name it. Default `#`. */
  comment?: string
  /** commit.cleanup is whitespace, verbatim or scissors: git records comment lines as written. */
  keepComments?: boolean
}

/**
 * The message git will record, line for line: everything from the scissors line is cut, and each
 * comment line is blanked rather than removed, so a finding's line is the line in the file.
 *
 * What the file cannot tell: whether the message came from `-m` or `-F` (git's default cleanup then
 * keeps comment lines), a `--cleanup` given on the command line, or, with core.commentChar `auto`
 * and no scissors line, which character git chose. Those are read as an editor commit under
 * commit.cleanup, with `#` for `auto`.
 */
export function messageOf(text: string, cleanup: MessageCleanup = {}): string {
  const cut = SCISSORS.exec(text)
  const kept = cut === null ? text : text.slice(0, cut.index)
  if (cleanup.keepComments === true) return kept
  const comment = cut?.[1] ?? cleanup.comment ?? "#"
  return kept
    .split("\n")
    .map((line) => (line.startsWith(comment) ? "" : line))
    .join("\n")
}

/** The comment string and cleanup mode from git's config; core.commentChar and core.commentString are one setting, the last set winning. */
export async function cleanupOf(cwd: string): Promise<MessageCleanup> {
  const result = await git(cwd, ["config", "--get-regexp", "^(core\\.comment(char|string)|commit\\.cleanup)$"])
  if (!result.ok) return {}
  const cleanup: MessageCleanup = {}
  for (const line of result.stdout.split("\n")) {
    const space = line.indexOf(" ")
    if (space === -1) continue
    const key = line.slice(0, space).toLowerCase()
    const value = line.slice(space + 1)
    if (key === "commit.cleanup") cleanup.keepComments = ["whitespace", "verbatim", "scissors"].includes(value)
    else if (value === "auto") delete cleanup.comment
    else if (value !== "") cleanup.comment = value
  }
  return cleanup
}

/**
 * The configs that judge a commit message: every one above `cwd` and every one in its repository.
 * A message belongs to the commit, not to a package, so a commit-msg rule in any config judges it.
 */
async function messageRoots(cwd: string): Promise<string[]> {
  const roots = dedupe([...configRootsAbove(cwd), ...(await configRootsBelow(await repositoryTop(cwd)))])
  if (roots.length === 0) throw new Error(`no ${CONFIG_FILE} in ${cwd}, its parents or its repository`)
  return roots
}

/** One project's commit-msg rules over the message. */
async function judge(
  project: CompiledProject,
  text: string,
  registry: DetectorRegistry,
  io: CliIo,
  label: string,
): Promise<{ delivery: Delivery; complete: boolean; rules: number }> {
  const { root } = project
  const rules = project.rules
    .filter(isDetectorRule)
    .filter((rule) => rule.enabled && rule.stages.includes("commit-msg"))
  const read = async (name: string) => (name === COMMIT_MESSAGE ? text : null)
  const resolver = createReferenceResolver(root)
  const detection = detectionFor(project, registry, ensureProjectState(cacheHome(io.env), root), resolver)
  const output = await runDetection({
    detection,
    event: "verify",
    selections: rules.map((rule) => ({ rule, files: [COMMIT_MESSAGE] })),
    changes: new Map(),
    read,
    fromDisk: false,
    timeoutMs: project.config.timeouts.verifyMs,
  })
  for (const error of output.errors) io.stderr(`rulecast: ${label}${error.rules.join(", ")}: ${error.message}\n`)
  for (const timedOut of output.timedOut) io.stderr(`rulecast: ${label}${timedOut.rules.join(", ")}: timed out\n`)
  // As `rulecast run`: a commit-msg rule that did not compile did not run, and "no findings" would
  // hide it. A broken rule for files, in this config or another package's, is not this run's: it must
  // not block every commit. A rule whose stages are unknown, or a repos entry that could not be read
  // (its rules unknown), counts.
  const errors = project.diagnostics.filter(
    (diagnostic) =>
      diagnostic.level === "error" &&
      (diagnostic.rule === null || diagnostic.stages === undefined || diagnostic.stages.includes("commit-msg")),
  )
  for (const diagnostic of errors) io.stderr(`rulecast: ${label}${diagnosticText(diagnostic)}\n`)
  const complete = errors.length === 0 && output.errors.length === 0 && output.timedOut.length === 0
  const ids = await findingIds(output.findings, (kind) => registry.get(kind), sourceLines(read))
  const decision = await decide({
    agent: "main",
    findings: output.findings.map(({ rule, match }, index) => ({ id: ids[index]!, rule, match, status: "new" })),
    touches: [],
    agentRead: null,
    warnings: [],
    work: emptyWork(),
    context: emptyContext(),
    resolver,
    maxBytes: project.config.context.maxBytes,
    maxBlocks: 1,
    maxContextChars: null,
    maxMatchesPerRule: project.config.maxMatchesPerRule,
    stopGate: false,
  })
  return { delivery: decision.delivery, complete, rules: rules.length }
}

/**
 * `rulecast run --commit-msg FILE`: the `stages: [commit-msg]` rules of every config in the
 * repository over the message in FILE, as the commit-msg git hook runs it (#79). Every finding is
 * new: a message has no baseline.
 */
export async function commitMsgRun(
  file: string,
  format: CliFormat,
  registry: DetectorRegistry,
  io: CliIo,
  quiet = false,
): Promise<number> {
  const cwd = path.resolve(io.cwd)
  const roots = await messageRoots(cwd)
  const projects = await Promise.all(
    roots.map((root) => compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })),
  )
  for (const project of projects) {
    // A config that does not load hides its commit-msg rules. Named by its path: it may be any package's.
    const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
    if (fatal === undefined) continue
    const source = displayPath(project.root, cwd)(fatal.source)
    throw new Error(`${diagnosticText({ ...fatal, source })} (run ${fatal.hint ?? "rulecast validate"})`)
  }
  const text = messageOf(await readFile(path.resolve(cwd, file), "utf8"), await cleanupOf(cwd))
  const parts = await Promise.all(
    projects.map(async (project) => {
      const config = displayPath(project.root, cwd)(CONFIG_FILE)
      const label = roots.length === 1 ? "" : `${config}: `
      return { root: project.root, ...(await judge(project, text, registry, io, label)) }
    }),
  )
  const delivery = combineDeliveries(parts, cwd)
  const complete = parts.every((part) => part.complete)
  const nearest = projects[0]!
  const printed = formatDelivery(delivery, format, {
    maxMatchesPerRule: nearest.config.maxMatchesPerRule,
    checked: { files: parts.some((part) => part.rules > 0) ? 1 : 0, selection: "files" },
    complete,
  })
  const code = exitCodeFor(delivery, complete)
  if (printed && !quietly(quiet, code, [delivery])) io.stdout(`${printed}\n`)
  return code
}
