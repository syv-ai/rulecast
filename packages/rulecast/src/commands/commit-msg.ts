import { readFile } from "node:fs/promises"
import path from "node:path"
import { type CliFormat, exitCodeFor, formatDelivery } from "../adapters/cli/format"
import { compile, diagnosticText } from "../core/compile/project"
import { isDetectorRule } from "../core/compile/rule"
import { createReferenceResolver } from "../core/delivery/resolve"
import { detectionFor } from "../core/detection/context"
import type { DetectorRegistry } from "../core/detection/registry"
import { runDetection } from "../core/detection/run"
import { findingIds } from "../core/finding-id"
import { cacheHome, ensureProjectState } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import { decide } from "../core/session/decide"
import { emptyContext, emptyWork } from "../core/session/state"
import { sourceLines } from "../core/suppress"
import type { CliIo } from "./main"

/** What a commit message is called in findings: git's own name for the file. */
export const COMMIT_MESSAGE = "COMMIT_EDITMSG"

/** git's scissors line: it and everything below it is cut from the message (`commit --verbose`). */
const SCISSORS = /^# -+ >8 -+$/m

/** The message git will record: without the comment lines it strips, or what follows the scissors line. */
export function messageOf(text: string): string {
  const cut = SCISSORS.exec(text)
  const kept = cut === null ? text : text.slice(0, cut.index)
  return kept
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
}

/**
 * `rulecast run --commit-msg FILE`: the project's `stages: [commit-msg]` rules over the message in
 * FILE, as the commit-msg git hook runs it (#79). Every finding is new: a message has no baseline.
 */
export async function commitMsgRun(
  root: string,
  file: string,
  format: CliFormat,
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  const text = messageOf(await readFile(path.resolve(io.cwd, file), "utf8"))
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
  for (const error of output.errors) io.stderr(`rulecast: ${error.rules.join(", ")}: ${error.message}\n`)
  for (const timedOut of output.timedOut) io.stderr(`rulecast: ${timedOut.rules.join(", ")}: timed out\n`)
  // As `rulecast run`: a rule that did not compile did not run, and "no findings" would hide it.
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  for (const diagnostic of errors) io.stderr(`rulecast: ${diagnosticText(diagnostic)}\n`)
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
  const printed = formatDelivery(decision.delivery, format, {
    maxMatchesPerRule: project.config.maxMatchesPerRule,
    checked: { files: rules.length === 0 ? 0 : 1, selection: "files" },
    complete,
  })
  if (printed) io.stdout(`${printed}\n`)
  return exitCodeFor(decision.delivery, complete)
}
