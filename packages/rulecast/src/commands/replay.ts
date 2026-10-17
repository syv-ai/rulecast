import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"

import { claudeConfigDir, listSessions, projectTranscriptDir, readSession } from "../adapters/claude-code/transcript"
import { compile, diagnosticText } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import { createReferenceResolver } from "../core/delivery/resolve"
import { detectionFor } from "../core/detection/context"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { meteredCalls, type ReplayResult, replay } from "../core/replay"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

const ADAPTERS = ["claude-code"]
const DEFAULT_SESSIONS = 20

interface ReplayArgs {
  sessions: number
  rules: string[]
  llm: boolean
  yes: boolean
  format: "terminal" | "json"
}

function parseReplayArgs(args: string[]): ReplayArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      sessions: { type: "string" },
      rule: { type: "string", multiple: true },
      llm: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      format: { type: "string", default: "terminal" },
    },
  })
  const [adapter, ...rest] = positionals
  if (adapter === undefined) throw new UsageError(`name the agent whose sessions to replay: ${ADAPTERS.join(", ")}`)
  if (!ADAPTERS.includes(adapter)) throw new UsageError(`no replay for "${adapter}" (use ${ADAPTERS.join(", ")})`)
  if (rest.length > 0) throw new UsageError(`unexpected arguments: ${rest.join(" ")}`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  if (values.yes && !values.llm) throw new UsageError("--yes needs --llm")
  const sessions = values.sessions === undefined ? DEFAULT_SESSIONS : Number(values.sessions)
  if (!Number.isInteger(sessions) || sessions < 1) {
    throw new UsageError(`--sessions takes a number of sessions, not "${values.sessions}"`)
  }
  return { sessions, rules: values.rule ?? [], llm: values.llm, yes: values.yes, format: values.format }
}

/** What `rulecast replay --format json` prints (agents/reference/output.md). */
export interface ReplayDocument extends ReplayResult {
  /** Present instead of the counts when an llm replay was asked for without --yes. */
  estimate?: { calls: number }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Characters of a finding's message shown; --format json has it whole. */
const MESSAGE_PREVIEW = 90

function terminal(result: ReplayResult): string {
  const out = [
    `${plural(result.sessions, "session")}: ${plural(result.edits, "edit")} and ${plural(result.turns, "turn")} judged` +
      (result.unknownEdits > 0
        ? `, ${result.unknownEdits} more edits not (the file before them is not in the transcript)`
        : ""),
    "",
  ]
  if (result.rules.length > 0) {
    const width = Math.max(4, ...result.rules.map((rule) => rule.rule.length))
    out.push(`${"rule".padEnd(width)}  edits fired  turns fired  would block`)
    for (const rule of result.rules) {
      const edits = rule.edits === 0 ? "-" : `${rule.editsFired} of ${rule.edits}`
      const turns = rule.turns === 0 ? "-" : `${rule.turnsFired} of ${rule.turns}`
      const block = rule.severity === "error" && rule.turns > 0 ? String(rule.wouldBlock) : "-"
      out.push(`${rule.rule.padEnd(width)}  ${edits.padStart(11)}  ${turns.padStart(11)}  ${block.padStart(11)}`)
    }
    out.push("")
  } else out.push("no rule ran on these sessions' edits", "")
  if (result.findings.length > 0) {
    out.push("findings:")
    for (const finding of result.findings) {
      const message = finding.message.replace(/\s+/g, " ").trim()
      const shown = message.length > MESSAGE_PREVIEW ? `${message.slice(0, MESSAGE_PREVIEW)}…` : message
      out.push(`  ${finding.session.slice(0, 8)} turn ${finding.turn + 1} ${finding.stage}  ${finding.rule}  ${shown}`)
    }
    out.push("")
  }
  if (result.skippedRules.length > 0) {
    out.push(
      `not run (their tool needs the files on disk, or their scope is removed or container): ${result.skippedRules.join(", ")}`,
      "",
    )
  }
  for (const { rule, message } of result.errors) out.push(`${rule} failed: ${message}`)
  out.push("Edits made through Bash are not in a transcript, so they are not judged.", "")
  return `${out.join("\n").trimEnd()}\n`
}

/**
 * `rulecast replay claude-code [--sessions N] [--rule ID]... [--llm [--yes]] [--format terminal|json]`:
 * what the configured rules would have told the agent in its recent sessions in this project, judged
 * from Claude Code's transcripts (adapters/claude-code/transcript.ts, core/replay.ts). Reads local
 * files only; an llm rule sends what it judges to the model it names, and runs only with --llm --yes.
 */
export async function replayCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { sessions: limit, rules, llm, yes, format } = parseReplayArgs(args)
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  const fatal = project.diagnostics.find((diagnostic) => diagnostic.fatal === true)
  if (fatal !== undefined) throw new Error(`${diagnosticText(fatal)} (run ${fatal.hint ?? "rulecast validate"})`)
  const known = new Set(project.rules.map((rule) => rule.id))
  for (const rule of rules) if (!known.has(rule)) throw new UsageError(`no rule "${rule}" (see rulecast validate)`)

  const dir = await projectTranscriptDir(root, claudeConfigDir(io.env))
  const sessions = await Promise.all((await listSessions(dir, limit)).map((entry) => readSession(entry, root)))
  const metered = new Set(registry.kinds().filter((kind) => registry.get(kind)?.metered === true))
  const onlyRules = rules.length === 0 ? undefined : new Set(rules)

  if (llm && !yes) {
    const calls = meteredCalls({ project, registry, sessions, skipKinds: new Set(), onlyRules })
    if (format === "json") io.stdout(`${JSON.stringify({ estimate: { calls } }, null, 2)}\n`)
    else {
      io.stdout(
        `Replaying the llm rules over ${plural(sessions.length, "session")} takes ${plural(calls, "billed model call")}.\n` +
          "Run it again with --yes to go ahead.\n",
      )
    }
    return 0
  }

  // Detector caches go to a scratch home: a replay leaves nothing behind in the project's own.
  const scratch = await mkdtemp(path.join(tmpdir(), "rulecast-replay-"))
  try {
    const detection = detectionFor(project, registry, scratch, createReferenceResolver(root))
    const result = await replay({
      project,
      registry,
      detection,
      sessions,
      skipKinds: llm ? new Set() : metered,
      onlyRules,
      timeoutMs: project.config.timeouts.verifyMs,
    })
    io.stdout(format === "json" ? `${JSON.stringify(result satisfies ReplayDocument, null, 2)}\n` : terminal(result))
    return 0
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
