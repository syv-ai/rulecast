/**
 * What rulecast is driven with.
 *
 * Each scenario is a claim about behaviour under a load nobody meant it to take, written so the
 * claim is checkable: a `check` that fails is a finding with a number attached, not a crash. The
 * numbers are stated as limits rather than asserted equalities because the point is to find the
 * order of magnitude at which something stops holding, and that is machine-dependent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { projectStateDir } from "../../src/core/home"
import { appendRecords, readRecords } from "../../src/core/jsonl"
import { sessionDir } from "../../src/core/session/session"
import {
  check,
  compileOnly,
  homeFor,
  MAX_CONTEXT_CHARS,
  percentile,
  rawRepo,
  runEvent,
  stressRepo,
  within,
} from "./support"
import type { Scenario } from "./types"

/** The edit deadline every scenario configures, so the limits below can all refer to one number. */
const EDIT_DEADLINE_MS = 350

/** How far past the deadline a run may go before it counts as unbounded rather than merely late. */
const DEADLINE_SLACK = 4

const settings = (extra: Record<string, unknown> = {}) => ({
  timeouts: { edit_deadline_ms: EDIT_DEADLINE_MS, verify_ms: 5_000 },
  ...extra,
})

/** No agent CLI on it, but the ordinary system tools the pipeline needs are still reachable. */
const NO_AGENT_PATH = "/usr/bin:/bin"

const line = (index: number) => `const value${index} = compute(${index})\n`

/** A source file of roughly `bytes` bytes that a plain regex has real work to do over. */
function sourceOf(bytes: number): string {
  const chunks: string[] = []
  let size = 0
  for (let index = 0; size < bytes; index++) {
    const text = line(index)
    chunks.push(text)
    size += text.length
  }
  return chunks.join("")
}

// ---------------------------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------------------------

const hugeFileRegex: Scenario = {
  name: "huge-file-regex",
  about: "One 8 MB source file through a plain regex rule on the edit path, against a 350 ms deadline.",
  target: "scale",
  timeoutMs: 60_000,
  async run() {
    const text = sourceOf(8 * 1024 * 1024)
    const root = await stressRepo(
      [
        {
          id: "scale/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      { "src/huge.ts": text },
      settings(),
    )
    const { result, elapsedMs } = await runEvent(root, { kind: "edit", files: ["src/huge.ts"], session: { id: "s" } })
    return {
      metrics: { fileBytes: text.length, elapsedMs, findings: result.delivery.findings.length },
      checks: [
        check(
          "the rule actually fired",
          result.delivery.findings.length > 0,
          `${result.delivery.findings.length} findings`,
        ),
        within("edit stays near its deadline", elapsedMs, EDIT_DEADLINE_MS * DEADLINE_SLACK),
        check(
          "a missed deadline is reported",
          elapsedMs <= EDIT_DEADLINE_MS * DEADLINE_SLACK || result.deadlineMissed.length > 0,
          `deadlineMissed=[${result.deadlineMissed.join(", ")}]`,
        ),
      ],
      notes: [],
    }
  },
}

const manyMatches: Scenario = {
  name: "many-matches",
  about: "A rule that fires 50,000 times in one file: what the budget does with far more than it can show.",
  target: "scale",
  timeoutMs: 60_000,
  async run() {
    const text = sourceOf(50_000 * 30)
    const root = await stressRepo(
      [
        {
          id: "scale/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      { "src/many.ts": text },
      settings(),
    )
    const { result, elapsedMs } = await runEvent(root, { kind: "edit", files: ["src/many.ts"], session: { id: "s" } })
    const delivered = JSON.stringify(result.delivery).length
    return {
      metrics: {
        elapsedMs,
        deliveredChars: delivered,
        findings: result.delivery.findings.length,
        omittedFindings: result.delivery.omitted.findings.reduce((sum, one) => sum + one.count, 0),
      },
      checks: [
        check(
          "the rule actually fired",
          result.delivery.findings.length > 0,
          `${result.delivery.findings.length} findings`,
        ),
        within("edit stays near its deadline", elapsedMs, EDIT_DEADLINE_MS * DEADLINE_SLACK),
        within("the delivery stays inside the context budget", delivered, MAX_CONTEXT_CHARS * 2, "chars"),
      ],
      notes: [],
    }
  },
}

const manyRules: Scenario = {
  name: "many-rules",
  about: "500 regex rules over 200 files on one verify — the compile and the fan-out, not one slow rule.",
  target: "scale",
  timeoutMs: 120_000,
  async run() {
    const rules = Array.from({ length: 500 }, (_, index) => ({
      id: `scale/rule-${index}`,
      name: `Rule ${index}`,
      files: "\\.ts$",
      detect: { regex: { pattern: `compute\\(${index}\\)` } },
      message: `{{file}}:{{line}} calls compute(${index})`,
    }))
    const files: Record<string, string> = {}
    for (let index = 0; index < 200; index++) files[`src/file-${index}.ts`] = sourceOf(4_000)
    const root = await stressRepo(rules, files, settings())

    const compiled = await compileOnly(root)
    const { result, elapsedMs } = await runEvent(root, {
      kind: "verify",
      files: Object.keys(files),
      session: { id: "s" },
    })
    return {
      metrics: {
        rules: compiled.rules,
        compileMs: compiled.elapsedMs,
        verifyMs: elapsedMs,
        findings: result.delivery.findings.length,
        omittedRules: result.delivery.omitted.rules,
      },
      checks: [
        check(
          "rules actually fired",
          result.delivery.findings.length > 0,
          `${result.delivery.findings.length} findings`,
        ),
        within("compiling 500 rules", compiled.elapsedMs, 2_000),
        within("one verify over 500 rules × 200 files", elapsedMs, 30_000),
        check("the run reports no internal failure", !result.failed, `failed=${result.failed}`),
      ],
      notes: [],
    }
  },
}

const warningFlood: Scenario = {
  name: "warning-flood",
  about: "80 rules that fail to compile alongside one that fires: do warnings crowd the finding out?",
  target: "scale",
  timeoutMs: 60_000,
  async run() {
    const broken = Array.from({ length: 80 }, (_, index) => ({
      id: `broken/rule-${index}`,
      name: `Broken ${index}`,
      files: "\\.ts$",
      // An unparseable pattern is a compile diagnostic, which becomes one warning per rule.
      detect: { regex: { pattern: `([unclosed-${index}` } },
      message: "never",
    }))
    const working = {
      id: "works/compute",
      name: "No bare compute",
      files: "\\.ts$",
      detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
      message: "{{file}}:{{line}} calls compute({{n}}). This is the finding that must survive.",
    }
    const root = await stressRepo([...broken, working], { "src/app.ts": sourceOf(200) }, settings())

    const { result, elapsedMs } = await runEvent(root, { kind: "edit", files: ["src/app.ts"], session: { id: "s" } })
    const warningChars = result.delivery.warnings.reduce((sum, one) => sum + one.length, 0)
    return {
      metrics: {
        elapsedMs,
        warnings: result.delivery.warnings.length,
        warningChars,
        findings: result.delivery.findings.length,
        omittedRules: result.delivery.omitted.rules,
      },
      checks: [
        check(
          "the working rule's finding still reaches the agent",
          result.delivery.findings.length > 0,
          `${result.delivery.findings.length} findings, ${result.delivery.warnings.length} warnings, ${warningChars} warning chars against a ${MAX_CONTEXT_CHARS} char budget`,
        ),
        within("warnings do not exceed the whole budget on their own", warningChars, MAX_CONTEXT_CHARS, "chars"),
      ],
      notes: [],
    }
  },
}

const largeRepo: Scenario = {
  name: "large-repo",
  about: "5,000 files in the tree, 300 of them edited in one verify: selection and change sets at repo scale.",
  target: "scale",
  timeoutMs: 180_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 5_000; index++) files[`src/mod-${index % 50}/file-${index}.ts`] = sourceOf(600)
    const root = await stressRepo(
      [
        {
          id: "scale/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\(7\\)" } },
          message: "{{file}}:{{line}} calls compute(7)",
        },
      ],
      files,
      settings(),
    )
    const edited = Object.keys(files).slice(0, 300)
    const { result, elapsedMs } = await runEvent(root, { kind: "verify", files: edited, session: { id: "s" } })
    return {
      metrics: {
        treeFiles: Object.keys(files).length,
        editedFiles: edited.length,
        verifyMs: elapsedMs,
        findings: result.delivery.findings.length,
      },
      checks: [
        check(
          "the rule actually fired",
          result.delivery.findings.length > 0,
          `${result.delivery.findings.length} findings`,
        ),
        within("one verify over 300 changed files in a 5,000 file tree", elapsedMs, 30_000),
        check("the run reports no internal failure", !result.failed, `failed=${result.failed}`),
      ],
      notes: [],
    }
  },
}

// ---------------------------------------------------------------------------------------------
// Adversarial
// ---------------------------------------------------------------------------------------------

/** `(a+)+$` against a string of `a`s and no match is the textbook exponential backtrack. */
const CATASTROPHIC = "(a+)+$"
const BACKTRACK_SUBJECT = `${"a".repeat(30)}b\n`

const catastrophicEdit: Scenario = {
  name: "catastrophic-regex-edit",
  about: "A rule whose pattern backtracks exponentially, on the edit path, against a 350 ms deadline.",
  target: "adversarial",
  timeoutMs: 30_000,
  async run() {
    const root = await stressRepo(
      [
        {
          id: "evil/backtrack",
          name: "Catastrophic backtracking",
          files: "\\.txt$",
          detect: { regex: { pattern: CATASTROPHIC } },
          message: "{{file}}:{{line}}",
        },
      ],
      { "victim.txt": BACKTRACK_SUBJECT },
      settings(),
    )
    const { result, elapsedMs } = await runEvent(root, { kind: "edit", files: ["victim.txt"], session: { id: "s" } })
    return {
      metrics: { elapsedMs, deadlineMs: EDIT_DEADLINE_MS },
      checks: [
        within("the edit deadline bounds a synchronous detector", elapsedMs, EDIT_DEADLINE_MS * DEADLINE_SLACK),
        check(
          "a missed deadline is reported rather than passed off as a clean run",
          elapsedMs <= EDIT_DEADLINE_MS * DEADLINE_SLACK || result.deadlineMissed.length > 0,
          `${elapsedMs.toFixed(0)} ms elapsed, deadlineMissed=[${result.deadlineMissed.join(", ")}]`,
        ),
      ],
      notes: [],
    }
  },
}

const catastrophicGuard: Scenario = {
  name: "catastrophic-regex-guard",
  about: "The same pattern on the PreToolUse path, where the hook holds up the agent's write.",
  target: "adversarial",
  timeoutMs: 30_000,
  async run() {
    const root = await stressRepo(
      [
        {
          id: "evil/backtrack",
          name: "Catastrophic backtracking",
          files: "\\.txt$",
          refuse_write: true,
          detect: { regex: { pattern: CATASTROPHIC } },
          message: "{{file}}:{{line}}",
        },
      ],
      { "victim.txt": "placeholder\n" },
      settings(),
    )
    const { elapsedMs } = await runEvent(root, {
      kind: "guard",
      files: ["victim.txt"],
      intent: { content: BACKTRACK_SUBJECT },
      session: { id: "s" },
    })
    return {
      metrics: { elapsedMs, deadlineMs: EDIT_DEADLINE_MS },
      checks: [within("the guard cannot be made to hold a write open", elapsedMs, EDIT_DEADLINE_MS * DEADLINE_SLACK)],
      notes: ["A guard that does not return is a write the agent never gets to make."],
    }
  },
}

const binaryFiles: Scenario = {
  name: "binary-and-encodings",
  about: "NUL bytes, lone surrogates, a BOM, CRLF and a 2 MB single line — content no rule author pictured.",
  target: "adversarial",
  timeoutMs: 60_000,
  async run() {
    const files: Record<string, string> = {
      "bin/nulls.ts": `compute(1)\u0000\u0000\u0000compute(2)\n`,
      "bin/bom.ts": `﻿compute(3)\n`,
      "bin/crlf.ts": "compute(4)\r\ncompute(5)\r\n",
      "bin/surrogate.ts": `compute(6) \uD800 tail\n`,
      "bin/oneline.ts": `${"x".repeat(2 * 1024 * 1024)}compute(7)\n`,
      "bin/emoji.ts": `compute(8) 👨‍👩‍👧‍👦 🇩🇰 é́\n`,
    }
    const root = await stressRepo(
      [
        {
          id: "evil/compute",
          name: "No bare compute",
          files: "^bin/",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      files,
      settings(),
    )
    const { result, elapsedMs } = await runEvent(root, {
      kind: "verify",
      files: Object.keys(files),
      session: { id: "s" },
    })
    const lines = result.delivery.findings.map((finding) => finding.line)
    const found = new Set(result.delivery.findings.map((finding) => finding.file))
    return {
      metrics: { elapsedMs, findings: result.delivery.findings.length, matchedFiles: found.size },
      checks: [
        check(
          "the rule fired on every file it should have",
          found.size === Object.keys(files).length,
          `matched ${found.size} of ${Object.keys(files).length}`,
        ),
        check("no rule was disabled by the content", !result.failed, `failed=${result.failed}`),
        check(
          "every finding has a sane 1-based line",
          lines.every((one) => Number.isInteger(one) && one >= 1),
          `lines=[${lines.join(", ")}]`,
        ),
        within("odd content does not blow the verify timeout", elapsedMs, 10_000),
      ],
      notes: [],
    }
  },
}

const brokenConfigs: Scenario = {
  name: "broken-configs",
  about: "Configs that are not configs: unparseable YAML, wrong types, absurd numbers, a 5 MB pattern.",
  target: "adversarial",
  timeoutMs: 60_000,
  async run() {
    const configs: Record<string, string> = {
      "unparseable YAML": "repos: [\n  - repo: local\n    rules:\n  bad indent: {",
      "not a mapping": "- just\n- a\n- list\n",
      "empty file": "",
      "repos is a string": "repos: nope\n",
      "rule is a number": "repos:\n  - repo: local\n    rules: [1, 2, 3]\n",
      "absurd max_bytes": "context:\n  max_bytes: 999999999999999999999\nrepos: []\n",
      "negative deadline": "timeouts:\n  edit_deadline_ms: -1\nrepos: []\n",
      "5 MB pattern": `repos:\n  - repo: local\n    rules:\n      - id: big/pattern\n        name: Big\n        detect:\n          regex:\n            pattern: "${"a".repeat(5 * 1024 * 1024)}"\n`,
      "deep nesting": `repos:\n  - repo: local\n    rules:\n      - id: deep/one\n        name: Deep\n        detect:\n          regex:\n            pattern: "${"(".repeat(400)}a${")".repeat(400)}"\n`,
    }
    const survived: string[] = []
    const threw: string[] = []
    let slowest = 0
    for (const [label, text] of Object.entries(configs)) {
      const root = await rawRepo(text, { "src/app.ts": "compute(1)\n" })
      try {
        const { elapsedMs } = await runEvent(root, { kind: "edit", files: ["src/app.ts"], session: { id: "s" } })
        slowest = Math.max(slowest, elapsedMs)
        survived.push(label)
      } catch (error) {
        threw.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      metrics: { configs: Object.keys(configs).length, survived: survived.length, slowestMs: slowest },
      checks: [
        check(
          "every malformed config is a diagnostic, never an exception",
          threw.length === 0,
          threw.length === 0 ? `${survived.length} configs, all handled` : threw.join(" | "),
        ),
        within("no config makes compilation pathological", slowest, 5_000),
      ],
      notes: [],
    }
  },
}

const awkwardPaths: Scenario = {
  name: "awkward-paths",
  about: "Spaces, quotes, unicode, a 200-character name and a leading dash in paths a rule has to match.",
  target: "adversarial",
  timeoutMs: 60_000,
  async run() {
    const names = [
      "src/with space.ts",
      "src/with'quote.ts",
      'src/with"double.ts',
      "src/með-þorn.ts",
      "src/日本語.ts",
      `src/${"n".repeat(200)}.ts`,
      "src/-leading-dash.ts",
      "src/dollar$brace{}.ts",
      "src/percent%20.ts",
    ]
    const files = Object.fromEntries(names.map((name) => [name, "compute(1)\n"]))
    const root = await stressRepo(
      [
        {
          id: "evil/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      files,
      settings(),
    )
    const { result, elapsedMs } = await runEvent(root, { kind: "verify", files: names, session: { id: "s" } })
    const found = new Set(result.delivery.findings.map((finding) => finding.file))
    const missing = names.filter((name) => !found.has(name))
    return {
      metrics: { paths: names.length, matched: found.size, elapsedMs },
      checks: [
        check("no path shape breaks the run", !result.failed, `failed=${result.failed}`),
        check(
          "every awkward path is still matched",
          missing.length === 0,
          missing.length === 0 ? `all ${names.length}` : `missed ${missing.join(", ")}`,
        ),
      ],
      notes: [],
    }
  },
}

// ---------------------------------------------------------------------------------------------
// Concurrency and session state
// ---------------------------------------------------------------------------------------------

const parallelHooks: Scenario = {
  name: "parallel-hooks",
  about: "16 hooks firing at once on one session id — the shape a parallel agent actually produces.",
  target: "concurrency",
  timeoutMs: 120_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 16; index++) files[`src/file-${index}.ts`] = "compute(1)\n"
    const root = await stressRepo(
      [
        {
          id: "conc/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      files,
      settings(),
    )
    const outcomes = await Promise.allSettled(
      Object.keys(files).map((file) => runEvent(root, { kind: "edit", files: [file], session: { id: "one" } })),
    )
    const rejected = outcomes.filter((one) => one.status === "rejected")
    const runs = outcomes.flatMap((one) => (one.status === "fulfilled" ? [one.value] : []))
    const lockWarned = runs.filter((run) =>
      run.result.delivery.warnings.some((warning) => warning.includes("locked")),
    ).length

    // Every edit must be in the work log afterwards: a lost append is a silently forgotten edit.
    const records = await readRecords<{ t: string; file?: string }>(
      path.join(sessionDir(projectStateDir(homeFor(), root), "one"), "work.jsonl"),
    )
    const edited = new Set(records.filter((one) => one.t === "edited").map((one) => one.file))

    return {
      metrics: {
        hooks: 16,
        rejected: rejected.length,
        lockFallbacks: lockWarned,
        editsRecorded: edited.size,
        slowestMs: Math.max(...runs.map((run) => run.elapsedMs)),
      },
      checks: [
        check(
          "no parallel hook throws",
          rejected.length === 0,
          rejected.length === 0
            ? "16 of 16 completed"
            : rejected.map((one) => String((one as PromiseRejectedResult).reason)).join(" | "),
        ),
        check("every edit reaches the work log", edited.size === 16, `${edited.size} of 16 edits recorded`),
        check("the session store is still readable", records.length > 0, `${records.length} records`),
      ],
      notes: [`${lockWarned} of 16 fell back to running without session memory.`],
    }
  },
}

const staleLock: Scenario = {
  name: "stale-lock",
  about: "A lock directory left behind by a killed hook: does the next one wait it out or give up?",
  target: "concurrency",
  timeoutMs: 60_000,
  async run() {
    const root = await stressRepo(
      [
        {
          id: "conc/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      { "src/app.ts": "compute(1)\n" },
      settings(),
    )
    const dir = sessionDir(projectStateDir(homeFor(), root), "one")
    await mkdir(path.join(dir, ".lock"), { recursive: true })

    const { result, elapsedMs } = await runEvent(root, { kind: "edit", files: ["src/app.ts"], session: { id: "one" } })
    const fellBack = result.delivery.warnings.some((warning) => warning.includes("locked"))
    return {
      metrics: { elapsedMs, warnings: result.delivery.warnings.length },
      checks: [
        check("a hook behind a stale lock still answers", true, `${elapsedMs.toFixed(0)} ms`),
        check(
          "it either waits the lock out or says it ran without memory",
          fellBack || result.delivery.findings.length > 0,
          fellBack ? "fell back, with a warning" : "acquired the lock",
        ),
        within("a stale lock costs at most its stale window plus the run", elapsedMs, 10_000),
      ],
      notes: [],
    }
  },
}

const corruptStore: Scenario = {
  name: "corrupt-session-store",
  about: "A half-written record in the middle of work.jsonl, not at its end — the case the store excludes.",
  target: "concurrency",
  timeoutMs: 60_000,
  async run() {
    const root = await stressRepo(
      [
        {
          id: "conc/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      { "src/app.ts": "compute(1)\n" },
      settings(),
    )
    await runEvent(root, { kind: "edit", files: ["src/app.ts"], session: { id: "one" } })

    const work = path.join(sessionDir(projectStateDir(homeFor(), root), "one"), "work.jsonl")
    const original = await readFile(work, "utf8")
    await writeFile(work, `${original.trimEnd()}\n{"t":"edited","fi\n{"t":"prompt","agent":"main"}\n`)

    let threw: string | null = null
    let recovered = false
    try {
      const { result } = await runEvent(root, { kind: "edit", files: ["src/app.ts"], session: { id: "one" } })
      recovered = result.delivery.findings.length > 0 || result.delivery.warnings.length > 0
    } catch (error) {
      threw = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
    }
    return {
      metrics: { recovered: recovered ? 1 : 0 },
      checks: [
        check(
          "a corrupt store degrades the hook rather than failing it",
          threw === null,
          threw ?? "handled without throwing",
        ),
      ],
      notes: ["§14 says an unreadable store runs without session state; this checks the hook honours that."],
    }
  },
}

const jsonlRace: Scenario = {
  name: "jsonl-append-race",
  about: "64 concurrent appenders on one work.jsonl: does every record survive and stay parseable?",
  target: "concurrency",
  timeoutMs: 60_000,
  async run() {
    const dir = path.join(homeFor(), "race")
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, "work.jsonl")

    const writers = 64
    const perWriter = 8
    await Promise.all(
      Array.from({ length: writers }, (_, writer) =>
        appendRecords(
          file,
          Array.from({ length: perWriter }, (_, index) => ({ t: "edited", writer, index })),
        ),
      ),
    )
    let records: unknown[] = []
    let threw: string | null = null
    try {
      records = await readRecords(file)
    } catch (error) {
      threw = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
    }
    const expected = writers * perWriter
    return {
      metrics: { expected, actual: records.length },
      checks: [
        check("the store stays parseable", threw === null, threw ?? `${records.length} records read`),
        check(
          "no record is lost to a concurrent append",
          records.length === expected,
          `${records.length} of ${expected}`,
        ),
      ],
      notes: [],
    }
  },
}

const interleavedCompaction: Scenario = {
  name: "compaction-mid-edit",
  about: "A reset (compaction) landing between edits on the same session, repeatedly.",
  target: "concurrency",
  timeoutMs: 120_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 12; index++) files[`src/file-${index}.ts`] = "compute(1)\n"
    const root = await stressRepo(
      [
        {
          id: "conc/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
          context: ["@conventions.md#rules"],
        },
      ],
      { ...files, "conventions.md": "# Conventions\n\n## Rules\n\nDo not call compute directly.\n" },
      settings(),
    )
    const names = Object.keys(files)
    const outcomes = await Promise.allSettled([
      ...names.map((file) => runEvent(root, { kind: "edit", files: [file], session: { id: "one" } })),
      ...[0, 1, 2].map(() =>
        runEvent(root, { kind: "reset", files: [], session: { id: "one" } }, { restoredFiles: 5 }),
      ),
    ])
    const rejected = outcomes.filter((one) => one.status === "rejected")
    return {
      metrics: { events: outcomes.length, rejected: rejected.length },
      checks: [
        check(
          "edits and compaction interleave without throwing",
          rejected.length === 0,
          rejected.length === 0
            ? `${outcomes.length} events`
            : rejected.map((one) => String((one as PromiseRejectedResult).reason)).join(" | "),
        ),
      ],
      notes: [],
    }
  },
}

const subagents: Scenario = {
  name: "subagents",
  about: "A main agent and eight subagents committing to one session at once.",
  target: "concurrency",
  timeoutMs: 120_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 9; index++) files[`src/file-${index}.ts`] = "compute(1)\n"
    const root = await stressRepo(
      [
        {
          id: "conc/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
        },
      ],
      files,
      settings(),
    )
    const agents = ["main", ...Array.from({ length: 8 }, (_, index) => `sub-${index}`)]
    const outcomes = await Promise.allSettled(
      agents.map((agent, index) =>
        runEvent(root, { kind: "edit", files: [`src/file-${index}.ts`], session: { id: "one", agentId: agent } }),
      ),
    )
    const rejected = outcomes.filter((one) => one.status === "rejected")
    return {
      metrics: { agents: agents.length, rejected: rejected.length },
      checks: [
        check(
          "no subagent's hook throws",
          rejected.length === 0,
          rejected.length === 0
            ? `${agents.length} agents`
            : rejected.map((one) => String((one as PromiseRejectedResult).reason)).join(" | "),
        ),
      ],
      notes: [],
    }
  },
}

// ---------------------------------------------------------------------------------------------
// Long sessions
// ---------------------------------------------------------------------------------------------

const longSession: Scenario = {
  name: "long-session",
  about: "400 turns on one session: whether per-event cost grows as the session's stores do.",
  target: "session",
  timeoutMs: 300_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 40; index++) files[`src/file-${index}.ts`] = "compute(1)\n"
    const root = await stressRepo(
      [
        {
          id: "long/compute",
          name: "No bare compute",
          files: "\\.ts$",
          detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
          message: "{{file}}:{{line}} calls compute({{n}})",
          context: ["@conventions.md#rules"],
        },
      ],
      { ...files, "conventions.md": "# Conventions\n\n## Rules\n\nDo not call compute directly.\n" },
      settings(),
    )
    const names = Object.keys(files)
    const turns = 400
    const timings: number[] = []
    for (let turn = 0; turn < turns; turn++) {
      const file = names[turn % names.length]!
      await writeFile(path.join(root, file), `compute(${turn})\n`)
      const kind = turn % 10 === 9 ? "verify" : "edit"
      const { elapsedMs } = await runEvent(root, { kind, files: [file], session: { id: "long" } })
      timings.push(elapsedMs)
    }
    const first = timings.slice(0, 20)
    const last = timings.slice(-20)
    const mean = (values: number[]) => values.reduce((sum, one) => sum + one, 0) / values.length
    const growth = mean(last) / mean(first)

    const dir = sessionDir(projectStateDir(homeFor(), root), "long")
    const storeBytes = (
      await Promise.all(
        ["work.jsonl", "context.jsonl", "baseline.jsonl"].map(async (name) => {
          try {
            return (await readFile(path.join(dir, name), "utf8")).length
          } catch {
            return 0
          }
        }),
      )
    ).reduce((sum, one) => sum + one, 0)

    return {
      metrics: {
        turns,
        firstTwentyMeanMs: mean(first),
        lastTwentyMeanMs: mean(last),
        growthFactor: growth,
        p95Ms: percentile(timings, 95),
        storeBytes,
      },
      checks: [
        check(
          "per-event cost does not grow with session length",
          growth <= 3,
          `last 20 turns are ${growth.toFixed(2)}× the first 20 (${mean(first).toFixed(0)} ms → ${mean(last).toFixed(0)} ms)`,
        ),
        within("p95 across 400 turns", percentile(timings, 95), 2_000),
      ],
      notes: [`Session stores reached ${(storeBytes / 1024).toFixed(0)} KiB over ${turns} turns.`],
    }
  },
}

const astGrepHugeFile: Scenario = {
  name: "ast-grep-huge-file",
  about: "The other synchronous detector on a 2.6 MB file: native parsing that no vm timeout can interrupt.",
  target: "scale",
  timeoutMs: 120_000,
  async run() {
    // Valid TypeScript, so the parse is real work rather than an early error.
    const text = Array.from(
      { length: 60_000 },
      (_, index) => `export const value${index} = fetch("/a/${index}")\n`,
    ).join("")
    const root = await stressRepo(
      [
        {
          id: "scale/no-fetch",
          name: "No bare fetch",
          files: "\\.ts$",
          detect: { "ast-grep": { language: "typescript", rule: { pattern: "fetch($$$ARGS)" } } },
          message: "{{file}}:{{line}} calls fetch directly",
        },
      ],
      { "src/huge.ts": text },
      settings(),
    )

    // verify, where the budget is seconds rather than the edit deadline, is where the rule has to
    // produce its findings at all.
    const verify = await runEvent(root, { kind: "verify", files: ["src/huge.ts"], session: { id: "v" } })
    // edit, where the 350 ms deadline cannot be met on a file this size. Dropping the results is
    // the specified behaviour (§13); the point of measuring is that it is *reported* as dropped
    // rather than delivered late, and how far past the deadline the hook still ran.
    const edit = await runEvent(root, { kind: "edit", files: ["src/huge.ts"], session: { id: "e" } })

    return {
      metrics: {
        fileBytes: text.length,
        verifyMs: verify.elapsedMs,
        editMs: edit.elapsedMs,
        findings: verify.result.delivery.findings.length,
      },
      checks: [
        check(
          "the rule fires when it is given a verify's budget",
          verify.result.delivery.findings.length > 0,
          `${verify.result.delivery.findings.length} findings, failed=${verify.result.failed}`,
        ),
        check(
          "an edit that cannot meet the deadline reports it rather than delivering late",
          edit.result.deadlineMissed.includes("ast-grep"),
          `deadlineMissed=[${edit.result.deadlineMissed.join(", ")}] after ${edit.elapsedMs.toFixed(0)} ms`,
        ),
        within("a 2.6 MB file through ast-grep", verify.elapsedMs, 20_000),
      ],
      notes: [
        "ast-grep parses in native code, which the vm timeout that bounds `regex` cannot interrupt. " +
          "The edit measurement is how far past a 350 ms deadline this file still runs.",
      ],
    }
  },
}

const llmUnavailable: Scenario = {
  name: "llm-provider-missing",
  about: "Twelve llm rules whose provider binary is not installed — §14's one warning, not twelve.",
  target: "adversarial",
  timeoutMs: 120_000,
  async run() {
    const rules = Array.from({ length: 12 }, (_, index) => ({
      id: `llm/rule-${index}`,
      name: `LLM rule ${index}`,
      files: "\\.ts$",
      stages: ["verify"],
      detect: { llm: { model: "haiku", question: `Does this file do thing ${index}?` } },
      message: "{{file}}:{{line}} {{reason}}",
    }))
    const root = await stressRepo(rules, { "src/app.ts": "export const a = 1\n" }, settings())

    // A PATH without an agent CLI: the provider is unavailable, which is the case being driven,
    // while the rest of the pipeline keeps the tools it needs for change sets.
    const path0 = process.env.PATH
    process.env.PATH = NO_AGENT_PATH
    let threw: string | null = null
    let elapsed = 0
    let warnings: string[] = []
    let failed = false
    try {
      const run = await runEvent(root, { kind: "verify", files: ["src/app.ts"], session: { id: "s" } })
      elapsed = run.elapsedMs
      warnings = run.result.delivery.warnings
      failed = run.result.failed
    } catch (error) {
      threw = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
    } finally {
      process.env.PATH = path0
    }
    const warningChars = warnings.reduce((sum, one) => sum + one.length, 0)
    return {
      metrics: { rules: rules.length, elapsedMs: elapsed, warnings: warnings.length, warningChars },
      checks: [
        check("an unavailable provider does not throw out of the hook", threw === null, threw ?? "handled"),
        check(
          "one warning disables every llm rule, not one per rule",
          warnings.length <= 1,
          `${warnings.length} warnings for ${rules.length} rules`,
        ),
        check("the run is reported as a rulecast failure", failed, `failed=${failed}`),
        within("a missing provider is detected quickly", elapsed, 30_000),
      ],
      notes: [],
    }
  },
}

const llmFileBudget: Scenario = {
  name: "llm-file-budget",
  about: "A verify over 40 files against llm.max_files_per_verify 10: the cut, and the warning it costs.",
  target: "scale",
  timeoutMs: 120_000,
  async run() {
    const files: Record<string, string> = {}
    for (let index = 0; index < 40; index++) files[`src/file-${index}.ts`] = `export const a${index} = ${index}\n`
    const root = await stressRepo(
      [
        {
          id: "llm/one",
          name: "An llm rule",
          files: "\\.ts$",
          stages: ["verify"],
          detect: { llm: { model: "haiku", question: "Does this file do the thing?" } },
          message: "{{file}}:{{line}} {{reason}}",
        },
      ],
      files,
      settings(),
    )
    const path0 = process.env.PATH
    process.env.PATH = NO_AGENT_PATH
    let warnings: string[] = []
    let threw: string | null = null
    try {
      const run = await runEvent(root, { kind: "verify", files: Object.keys(files), session: { id: "s" } })
      warnings = run.result.delivery.warnings
    } catch (error) {
      threw = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
    } finally {
      process.env.PATH = path0
    }
    const budgetWarning = warnings.find((one) => one.includes("max_files_per_verify"))
    return {
      metrics: { files: Object.keys(files).length, warnings: warnings.length },
      checks: [
        check("the budget does not throw", threw === null, threw ?? "handled"),
        check(
          "the files left unchecked are named once, not per file",
          budgetWarning !== undefined && warnings.length <= 2,
          `${warnings.length} warnings: ${warnings.map((one) => one.slice(0, 40)).join(" | ")}`,
        ),
      ],
      notes: ["No model is called: the provider is absent on purpose, so this stays hermetic and free."],
    }
  },
}

export const SCENARIOS: readonly Scenario[] = [
  hugeFileRegex,
  manyMatches,
  manyRules,
  warningFlood,
  largeRepo,
  astGrepHugeFile,
  llmFileBudget,
  catastrophicEdit,
  catastrophicGuard,
  binaryFiles,
  brokenConfigs,
  awkwardPaths,
  llmUnavailable,
  parallelHooks,
  staleLock,
  corruptStore,
  jsonlRace,
  interleavedCompaction,
  subagents,
  longSession,
]
