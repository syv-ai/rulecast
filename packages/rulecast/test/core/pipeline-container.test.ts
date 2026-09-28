import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { readBaseline } from "../../src/core/baseline/store"
import { headCommit } from "../../src/core/git"
import { sessionDir } from "../../src/core/session/session"
import type { Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

const ROUTES = "app/api/routes.py"

/**
 * A container rule in the shape of the measured one: the match is the whole function, and what the
 * convention is about — "this route reaches the database directly" — is a property of the function,
 * not of the `crud.` call inside it.
 */
const containerRule = (scope?: "instance" | "container") => ({
  id: "routes/no-crud",
  name: "Routes do not call crud directly",
  files: "^app/api/",
  ...(scope ? { scope } : {}),
  detect: {
    "ast-grep": {
      language: "python",
      rule: { kind: "function_definition", has: { pattern: "crud.$FN($$$ARGS)", stopBy: "end" } },
    },
  },
  message: "{{file}}:{{line}} calls crud.{{FN}} from a route. Go through the service layer.",
})

/** A route function: a def, a crud call or not, then `filler` lines of body. */
const route = (name: string, options: { crud: boolean; filler: number }) =>
  [
    `def ${name}():`,
    ...(options.crud ? [`    return crud.fetch_${name}()`] : ["    return service.fetch()"]),
    ...Array.from({ length: options.filler }, (_, index) => `    log("${name}_${index}")`),
  ].join("\n")

async function scenario(rules: Record<string, unknown>[], content: string) {
  const root = await createRepo({ ".rulecast-config.yaml": localConfig(rules), [ROUTES]: `${content}\n` })
  const send = async (event: Omit<Event, "cwd" | "session">) =>
    (await pipelineAt(root, { ...event, cwd: root, session: { id: "s1" } })).delivery
  const write = (text: string) => writeFile(path.join(root, ROUTES), `${text}\n`)
  const baseline = () => readBaseline(sessionDir(stateDirFor(root), "s1"))
  return { root, send, write, baseline }
}

describe("pipeline: container scope", () => {
  test("an edit inside a route that already called crud reports nothing new", async () => {
    const before = route("list_users", { crud: true, filler: 6 })
    const { send, write } = await scenario([containerRule("container")], before)

    await send({ kind: "touch", files: [ROUTES], completeRead: true })
    await write(`${before}\n    log("one more")`)
    const delivery = await send({ kind: "edit", files: [ROUTES] })

    expect(delivery.findings).toEqual([])
    expect(delivery.preexistingSummary).toEqual([{ rule: "routes/no-crud", file: ROUTES, count: 1 }])
  })

  test("an edit that makes a clean route call crud is new", async () => {
    const before = route("list_users", { crud: false, filler: 6 })
    const { send, write } = await scenario([containerRule("container")], before)

    await send({ kind: "touch", files: [ROUTES], completeRead: true })
    await write(before.replace("return service.fetch()", "return crud.fetch_users()"))
    const delivery = await send({ kind: "edit", files: [ROUTES] })

    expect(delivery.findings.map((finding) => finding.message)).toEqual([
      "app/api/routes.py:1 calls crud.fetch_users from a route. Go through the service layer.",
    ])
    expect(delivery.preexistingSummary).toEqual([])
  })

  test("the same edit without scope reports it, which is what instance rules have always done", async () => {
    const before = route("list_users", { crud: true, filler: 6 })
    const { send, write } = await scenario([containerRule()], before)

    await send({ kind: "touch", files: [ROUTES], completeRead: true })
    await write(`${before}\n    log("one more")`)
    const delivery = await send({ kind: "edit", files: [ROUTES] })

    // The match spans the whole function, so it overlaps the changed line: precision 0.62.
    expect(delivery.findings).toHaveLength(1)
  })

  test("a route added whole is new while the one that was already there is not", async () => {
    const existing = route("list_users", { crud: true, filler: 4 })
    const { send, write } = await scenario([containerRule("container")], existing)

    await send({ kind: "touch", files: [ROUTES], completeRead: true })
    await write(`${existing}\n\n${route("list_orders", { crud: true, filler: 4 })}`)
    const delivery = await send({ kind: "edit", files: [ROUTES] })

    // The first route is lines 1–6, then a blank line: the added one starts at 8.
    expect(delivery.findings.map((finding) => finding.line)).toEqual([8])
    expect(delivery.preexistingSummary).toEqual([{ rule: "routes/no-crud", file: ROUTES, count: 1 }])
  })

  test("a touch records one fingerprint per container rule, empty when the file is clean", async () => {
    const { send, baseline } = await scenario(
      [containerRule("container")],
      route("list_users", { crud: false, filler: 2 }),
    )
    await send({ kind: "touch", files: [ROUTES], completeRead: true })

    expect(await baseline().then((state) => state.fingerprints.get(ROUTES))).toEqual(new Map([["routes/no-crud", []]]))
  })

  test("a project with no container rule takes no fingerprint run", async () => {
    const { root, send, baseline } = await scenario([containerRule()], route("list_users", { crud: true, filler: 2 }))
    await send({ kind: "touch", files: [ROUTES], completeRead: true })

    expect((await baseline()).fingerprints).toEqual(new Map())
    const store = await readFile(path.join(sessionDir(stateDirFor(root), "s1"), "baseline.jsonl"), "utf8")
    expect(store).not.toContain("fingerprint")
  })

  test("a verify against a base commit measures the fingerprints it is missing", async () => {
    const before = route("list_users", { crud: true, filler: 6 })
    const { root, send, write } = await scenario([containerRule("container")], before)
    const base = (await headCommit(root))!

    await write(`${before}\n    log("one more")`)
    const delivery = await send({ kind: "verify", files: [ROUTES], baseCommit: base })

    // No touch happened, so nothing was recorded at snapshot time; the verify measured it.
    expect(delivery.findings).toEqual([])
    expect(delivery.preexistingSummary).toEqual([{ rule: "routes/no-crud", file: ROUTES, count: 1 }])
  })

  test("a verify against a base commit still reports a route the branch broke", async () => {
    const before = route("list_users", { crud: false, filler: 6 })
    const { root, send, write } = await scenario([containerRule("container")], before)
    const base = (await headCommit(root))!

    await write(before.replace("return service.fetch()", "return crud.fetch_users()"))
    const delivery = await send({ kind: "verify", files: [ROUTES], baseCommit: base })

    expect(delivery.findings.map((finding) => finding.line)).toEqual([1])
  })

  test("an edit with no snapshot falls back to instance classification", async () => {
    const before = route("list_users", { crud: true, filler: 6 })
    const { send, write } = await scenario([containerRule("container")], before)

    // No touch: the file's baseline is the session-start commit, which leaves no fingerprint.
    await write(`${before}\n    log("one more")`)
    const delivery = await send({ kind: "edit", files: [ROUTES] })

    expect(delivery.findings).toHaveLength(1)
  })
})
