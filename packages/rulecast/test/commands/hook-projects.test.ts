import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { claudeCodeAdapter } from "../../src/adapters/claude-code/adapter"
import {
  FINDINGS_LOG,
  FINDINGS_LOG_MAX_BYTES,
  FINDINGS_LOG_ROTATED,
  FINDINGS_WEEKLY,
  readFindingsLog,
  readWeeklyRollup,
} from "../../src/core/stats/log"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { compileAt, fixtureFiles } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { stateDirFor, testEnv } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"
import { pipelineAt } from "../helpers/pipeline"
import { stopVerdict } from "../helpers/stop"

/** Rule A, in the top config: every Python file in the repository. */
const TOP_RULES = [
  {
    id: "top/no-print",
    name: "No print",
    files: "\\.py$",
    detect: { regex: { pattern: "print\\(" } },
    message: "{{file}}:{{line}} prints.",
  },
  {
    id: "top/no-generated",
    name: "Generated",
    files: "/gen/",
    detect: { path: {} },
    message: "{{file}} is generated.",
    refuse_write: true,
  },
]
const TOP = localConfig(TOP_RULES)

/** Rule B, in backend's config: every Python file in backend. */
const BACKEND = localConfig([
  {
    id: "backend/no-todo",
    name: "No TODO",
    files: "\\.py$",
    detect: { regex: { pattern: "TODO" } },
    message: "{{file}}:{{line}} has a TODO.",
  },
  {
    id: "backend/no-vendor",
    name: "Vendored",
    files: "^vendor/",
    detect: { path: {} },
    message: "{{file}} is vendored.",
    refuse_write: true,
  },
])

const FRONTEND = localConfig([
  { id: "frontend/no-any", name: "No any", files: "\\.ts$", detect: { regex: { pattern: ": any" } }, message: "m" },
])

const BASE = { "backend/app/x.py": "x = 1\n", "tools/y.py": "y = 1\n", "frontend/a.ts": "export const a = 1\n" }

/**
 * A Claude Code session in `repo`, started in `launch` (CLAUDE_PROJECT_DIR) and working in `cwd`, both
 * relative to the repo. Each session has its own id, so no other test's recorded roots join it.
 */
function agent(repo: string, launch = ".", cwd = launch) {
  const sessionId = randomUUID()
  const env = { ...testEnv, CLAUDE_PROJECT_DIR: path.join(repo, launch) }
  const hook = (name: string, file?: string) => {
    const payload = claudeCodePayload(name, { root: path.join(repo, cwd), file, sessionId })
    return runCli(path.join(repo, cwd), ["hook", "claude-code"], JSON.stringify(payload), env)
  }
  /** Writes `content` to `file` (relative to cwd) and runs the edit hook: what the agent was told, or "". */
  const edit = async (file: string, content: string): Promise<string> => {
    await writeFile(path.join(repo, cwd, file), content)
    const { stdout } = await hook("post-tool-use.edit", file)
    return stdout === "" ? "" : JSON.parse(stdout).hookSpecificOutput.additionalContext
  }
  const stop = async () => {
    const { stdout } = await hook("stop")
    return stopVerdict(stdout)
  }
  /** The guard's decision on writing `file` (relative to cwd): "deny", or null when it lets it through. */
  const guard = async (file: string): Promise<string | null> => {
    const { stdout } = await hook("pre-tool-use.write", file)
    return stdout === "" ? null : (JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? null)
  }
  /** Runs `write` as the agent's shell command between its pre and post hooks: what the agent was told, or "". */
  const shell = async (write: () => Promise<void>): Promise<string> => {
    await hook("pre-tool-use.bash")
    await write()
    const { stdout } = await hook("post-tool-use.bash")
    return stdout === "" ? "" : JSON.parse(stdout).hookSpecificOutput.additionalContext
  }
  return { sessionId, env, hook, edit, stop, guard, shell }
}

describe("rulecast hook claude-code: configs anywhere", () => {
  test("an agent at the top editing a backend file gets both configs' findings, at its own path", async () => {
    const repo = await createRepo({ ...BASE, ".rulecast-config.yaml": TOP, "backend/.rulecast-config.yaml": BACKEND })
    const told = await agent(repo).edit("backend/app/x.py", "print('x')  # TODO\n")
    expect(told).toContain("top/no-print")
    expect(told).toContain("backend/no-todo")
    expect(told).toContain("backend/app/x.py:1 prints.")
    expect(told).toContain("backend/app/x.py:1 has a TODO.")
    expect(told).not.toMatch(/(^|\s)app\/x\.py/)
  })

  test("an agent at the top with only the package's config gets the package's findings", async () => {
    const repo = await createRepo({ ...BASE, "backend/.rulecast-config.yaml": BACKEND })
    const told = await agent(repo).edit("backend/app/x.py", "x = 1  # TODO\n")
    expect(told).toContain("backend/app/x.py:1 has a TODO.")
  })

  test("a stop at the top runs both projects' gates, and a block in either blocks", async () => {
    const repo = await createRepo({ ...BASE, ".rulecast-config.yaml": TOP, "backend/.rulecast-config.yaml": BACKEND })
    const onlyBackend = agent(repo)
    await onlyBackend.edit("backend/app/x.py", "x = 1  # TODO\n")
    const blocked = await onlyBackend.stop()
    expect(blocked.decision).toBe("block")
    expect(blocked.reason).toContain("backend/app/x.py:1 has a TODO.")

    const repo2 = await createRepo({ ...BASE, ".rulecast-config.yaml": TOP, "backend/.rulecast-config.yaml": BACKEND })
    const both = agent(repo2)
    await both.edit("backend/app/x.py", "x = 1  # TODO\n")
    await both.edit("tools/y.py", "print('y')\n")
    const stop = await both.stop()
    expect(stop.decision).toBe("block")
    expect(stop.reason).toMatch(
      /^rulecast rules \(these configs: \.rulecast-config\.yaml, backend\/\.rulecast-config\.yaml\)/,
    )
    expect(stop.reason).toContain("backend/app/x.py:1 has a TODO.")
    expect(stop.reason).toContain("tools/y.py:1 prints.")
  })

  test("a session launched in frontend/ that edits ../backend/x.py is blocked on it at its stop", async () => {
    const repo = await createRepo({
      ...BASE,
      "backend/.rulecast-config.yaml": BACKEND,
      "frontend/.rulecast-config.yaml": FRONTEND,
    })
    const session = agent(repo, "frontend")
    await session.hook("session-start.startup")
    expect(await session.edit("../backend/app/x.py", "x = 1  # TODO\n")).toContain("../backend/app/x.py:1 has a TODO.")
    const stop = await session.stop()
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain("../backend/app/x.py:1 has a TODO.")
  })

  test("a write either project refuses is denied", async () => {
    const repo = await createRepo({ ...BASE, ".rulecast-config.yaml": TOP, "backend/.rulecast-config.yaml": BACKEND })
    await mkdir(path.join(repo, "backend", "gen"), { recursive: true })
    const session = agent(repo)
    expect(await session.guard("backend/gen/a.py")).toBe("deny")
    expect(await session.guard("backend/vendor/b.py")).toBe("deny")
    expect(await session.guard("backend/app/c.py")).toBeNull()
  })

  test("each config's own doc section is named from the agent, and a rule past its cap counts its files", async () => {
    const cites = (id: string, pattern: string) => ({
      id,
      name: id,
      files: "\\.py$",
      detect: { regex: { pattern } },
      message: "{{file}}:{{line}} broke it.",
      context: ["@conventions/code.md#topic-1"],
    })
    const section = (who: string) => `# Code\n\n## Topic 1\n\nThe ${who} way.\n`
    const repo = await createRepo({
      ...BASE,
      ".rulecast-config.yaml": localConfig([cites("top/no-print", "print\\(")]),
      "conventions/code.md": section("top"),
      "backend/.rulecast-config.yaml": localConfig([cites("backend/no-todo", "TODO")]),
      "backend/conventions/code.md": section("backend"),
    })
    const told = await agent(repo).edit("backend/app/x.py", `print('x')\n${"x = 1  # TODO\n".repeat(11)}`)
    expect(told).toContain("--- conventions/code.md#topic-1 ---\n## Topic 1\n\nThe top way.")
    expect(told).toContain("--- backend/conventions/code.md#topic-1 ---\n## Topic 1\n\nThe backend way.")
    expect(told).toContain("…and 1 more in 1 file")
    expect(told).not.toContain("in 0 files")
  })

  test("with six configs and findings in one, that one gets the whole budget and is the only config named", async () => {
    // A section longer than a sixth of the budget: delivered in full only if the share is not split six ways.
    const body = Array.from({ length: 40 }, (_, i) => `Rule of thumb ${i}: keep the handler thin.`).join(" ")
    const packages = ["a", "b", "c", "d", "e"]
    const files: Record<string, string> = {
      ...BASE,
      ".rulecast-config.yaml": FRONTEND,
      "pkg/c/conventions/code.md": `# Code\n\n## Handlers\n\n${body}\n`,
    }
    for (const name of packages) {
      files[`pkg/${name}/.rulecast-config.yaml`] = localConfig([
        {
          id: `${name}/no-todo`,
          name: "No TODO",
          files: "\\.py$",
          detect: { regex: { pattern: "TODO" } },
          message: "{{file}}:{{line}} has a TODO.",
          ...(name === "c" ? { context: ["@conventions/code.md#handlers"] } : {}),
        },
      ])
      files[`pkg/${name}/x.py`] = "x = 1\n"
    }
    const repo = await createRepo(files)
    const session = agent(repo)
    await session.hook("session-start.startup")
    const told = await session.shell(() => writeFile(path.join(repo, "pkg/c/x.py"), "x = 1  # TODO\n"))
    expect(told).toContain("pkg/c/x.py:1 has a TODO.")
    expect(told).toContain(body)
    const stop = await session.stop()
    expect(stop.decision).toBe("block")
    expect(stop.reason).toMatch(/^rulecast rules \(pkg\/c\/\.rulecast-config\.yaml\) found problems/)
  })

  test("a config whose pre-existing findings are already summarised does not take a share of the budget", async () => {
    // A section longer than half the budget: delivered in full only if the top config does not claim half.
    const body = Array.from({ length: 130 }, (_, i) => `Rule of thumb ${i}: keep the handler thin.`).join(" ")
    const repo = await createRepo({
      ...BASE,
      "backend/app/x.py": "print('x')\n",
      ".rulecast-config.yaml": TOP,
      "backend/.rulecast-config.yaml": localConfig([
        {
          id: "backend/no-todo",
          name: "No TODO",
          files: "\\.py$",
          detect: { regex: { pattern: "TODO" } },
          message: "{{file}}:{{line}} has a TODO.",
          context: ["@conventions/code.md#handlers"],
        },
      ]),
      "backend/conventions/code.md": `# Code\n\n## Handlers\n\n${body}\n`,
    })
    const session = agent(repo)
    await session.hook("session-start.startup")
    // The first edit gives the top config's pre-existing print its summary.
    expect(await session.edit("backend/app/x.py", "print('x')\ny = 2\n")).toContain("top/no-print")
    const told = await session.edit("backend/app/x.py", "print('x')\ny = 2  # TODO\n")
    expect(told).toContain("backend/app/x.py:2 has a TODO.")
    expect(told).not.toContain("top/no-print")
    expect(told).toContain(body)
  })

  test("run --session checks every project the session ran, from where it is run", async () => {
    const repo = await createRepo({
      ...BASE,
      "backend/.rulecast-config.yaml": BACKEND,
      "frontend/.rulecast-config.yaml": FRONTEND,
    })
    const session = agent(repo, "frontend")
    await session.hook("session-start.startup")
    await session.edit("../backend/app/x.py", "x = 1  # TODO\n")
    await session.edit("a.ts", "export const a: any = 1\n")
    const run = await runCli(
      path.join(repo, "frontend"),
      ["run", "--session", session.sessionId, "--format", "json"],
      "",
      session.env,
    )
    expect(run.code).toBe(1)
    const found = JSON.parse(run.stdout).findings.map(
      (finding: { rule: string; file: string }) => `${finding.rule} ${finding.file}`,
    )
    expect(found.sort()).toEqual(["backend/no-todo ../backend/app/x.py", "frontend/no-any a.ts"])
  })

  test("two configs, one with the summary on: only its log gets one", async () => {
    const repo = await createRepo({
      ...BASE,
      ".rulecast-config.yaml": localConfig(TOP_RULES, { stats: { weekly_summary: true } }),
      "backend/.rulecast-config.yaml": BACKEND,
    })
    const record = (at: string, rule: string) =>
      `${JSON.stringify({ v: 1, at, s: "old", a: "main", ev: "edit", files: ["x.py"], ran: { [rule]: [0] }, found: [], ign: [] })}\n`
    const roots = [repo, path.join(repo, "backend")]
    for (const [root, rule] of [
      [roots[0]!, "top/no-print"],
      [roots[1]!, "backend/no-todo"],
    ] as const) {
      const stateDir = stateDirFor(root)
      await mkdir(stateDir, { recursive: true })
      const full = record("2026-10-01T00:00:00.000Z", rule)
      await writeFile(path.join(stateDir, FINDINGS_LOG), full.repeat(Math.ceil(FINDINGS_LOG_MAX_BYTES / full.length)))
      await writeFile(path.join(stateDir, FINDINGS_LOG_ROTATED), record("2026-09-24T00:00:00.000Z", rule))
    }
    await agent(repo).edit("backend/app/x.py", "print('x')  # TODO\n")

    const top = await readWeeklyRollup(stateDirFor(roots[0]!))
    expect(top.rows).toMatchObject([{ week: "2026-09-21", rule: "top/no-print", runs: 1 }])
    expect(existsSync(path.join(stateDirFor(roots[1]!), FINDINGS_WEEKLY))).toBe(false)
    // The package's log rotated all the same.
    expect((await readFindingsLog(stateDirFor(roots[1]!))).records.at(0)?.at).toBe("2026-10-01T00:00:00.000Z")
  })

  test("a single-project repository gets exactly what one pipeline run delivers", async () => {
    const USERS = "app/services/users.py"
    const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"
    const [viaHook, direct] = [await createRepo(fixtureFiles), await createRepo(fixtureFiles)]
    const session = agent(viaHook)
    await writeFile(path.join(viaHook, USERS), VIOLATION)
    await writeFile(path.join(direct, USERS), VIOLATION)
    const hooked = [(await session.hook("post-tool-use.edit", USERS)).stdout, (await session.hook("stop")).stdout]

    const sessionId = randomUUID()
    const options = { maxContextChars: claudeCodeAdapter.maxContextChars, restoredFiles: 5, recordMode: true }
    const { maxMatchesPerRule } = (await compileAt(direct)).config
    const formatted: string[] = []
    for (const kind of ["edit", "verify"] as const) {
      const event = { kind, files: kind === "edit" ? [USERS] : [], cwd: direct, session: { id: sessionId } }
      const result = await pipelineAt(direct, event, { ...options, stopGate: kind === "verify" })
      formatted.push(claudeCodeAdapter.format(result.delivery, event, { maxMatchesPerRule }).stdout)
    }
    expect(stopVerdict(hooked[1]!).decision).toBe("block")
    expect(hooked).toEqual(formatted)
  })
})
