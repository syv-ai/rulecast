import { readFile } from "node:fs/promises"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { beforeAll, describe, expect, test } from "vitest"

import { setupPageDocument } from "../../scripts/sync-version"
import { REPO_ROOT } from "../helpers/catalog"

/** agents/conventions-review.html, run without a browser: render(data, decisions, view) is pure (#82). */
let page: string
let renderScript: string
let sample: { conflicts: { id: string }[]; topics: { id: string; candidates: { id: string; text: string }[] }[] }

beforeAll(async () => {
  page = await readFile(path.join(REPO_ROOT, "agents/conventions-review.html"), "utf8")
  renderScript = /<script id="render">([\s\S]*?)<\/script>/.exec(page)![1]!
  sample = JSON.parse(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(page)![1]!)
})

const call = (expression: string, context: Record<string, unknown>) =>
  runInNewContext(`${renderScript}\n${expression}`, context) as unknown
const render = (decisions: Record<string, unknown> = {}, view: Record<string, unknown> = {}) =>
  call("render(data, decisions, view)", { data: sample, decisions, view }) as string
const count = (html: string, needle: string) => html.split(needle).length - 1

describe("conventions review page", () => {
  test("opens on the conflicts, the first undecided one open, with a step per topic and a finish", () => {
    const html = render()
    expect(html).toContain("Conventions for <b>tidewater</b>")
    expect(count(html, '<button class="step')).toBe(2 + sample.topics.length)
    expect(html).toContain('aria-current="step">Conflicts')
    expect(count(html, '<details class="card')).toBe(sample.conflicts.length)
    expect(html).toContain(`data-card="${sample.conflicts[0]!.id}" open`)
    expect(html).toContain("0 of 6 decided")
    expect(html).toContain("Saved in this browser only")
  })

  test("a decided card closes, and the next undecided one opens", () => {
    const [first, second] = sample.conflicts
    const html = render({ [first!.id]: { kind: "conflict", choice: "Error" } })
    expect(html).toContain(`data-card="${second!.id}" open`)
    expect(html).not.toContain(`data-card="${first!.id}" open`)
    expect(html).toContain("1 of 6 decided")
  })

  test("a reword needs words and a decline needs a reason before it counts", () => {
    const complete = (decision: unknown) => call("complete(decision)", { decision }) as boolean
    expect(complete({ kind: "candidate", choice: "keep" })).toBe(true)
    expect(complete({ kind: "candidate", choice: "reword", words: " " })).toBe(false)
    expect(complete({ kind: "candidate", choice: "reword", words: "Mine." })).toBe(true)
    expect(complete({ kind: "candidate", choice: "decline", note: "" })).toBe(false)
    expect(complete({ kind: "candidate", choice: "decline", note: "Not here." })).toBe(true)
    expect(complete({ kind: "conflict", choice: "Error" })).toBe(true)
  })

  test("a reworded convention shows the developer's words; the box starts from the convention", () => {
    const topic = sample.topics[0]!
    const candidate = topic.candidates[1]!
    const chosen = render({ [candidate.id]: { kind: "candidate", choice: "reword", words: "" } }, { step: topic.id })
    expect(chosen).toContain(`data-words="${candidate.id}">${candidate.text}</textarea>`)
    const worded = render(
      { [candidate.id]: { kind: "candidate", choice: "reword", words: "In my words." } },
      { step: topic.id },
    )
    expect(worded).toContain('<span class="text">In my words.</span>')
  })

  test("text is escaped, and only backticks become code", () => {
    const data = {
      project: "x<y",
      topics: [
        {
          id: "t",
          title: "T",
          candidates: [{ id: "c", text: "Use `a<b` and <script>alert(1)</script>", recommend: "keep" }],
        },
      ],
    }
    const html = call("render(data)", { data }) as string
    expect(html).toContain("x&lt;y")
    expect(html).toContain("<code>a&lt;b</code>")
    expect(html).not.toContain("<script>")
  })

  test("the finish step tallies the decisions and gives them as JSON, in the page's order", () => {
    const [kept, reworded] = sample.topics[0]!.candidates
    const decisions = {
      [reworded!.id]: { kind: "candidate", choice: "reword", words: "Mine." },
      [kept!.id]: { kind: "candidate", choice: "keep" },
    }
    const html = render(decisions, { step: "finish" })
    expect(html).toContain("<b>1</b>kept</span><span><b>1</b>reworded</span><span><b>0</b>declined")
    expect(html).toContain("4 still undecided")
    expect(html).toContain("Copy decisions")
    const json = call("decisionsJson(data, decisions)", { data: sample, decisions }) as string
    expect(Object.keys(JSON.parse(json))).toEqual([kept!.id, reworded!.id])
    expect(render(decisions, { step: "finish", store: "db" })).toContain("Your decisions are saved with this page")
  })

  test("a fragment for artifact publishers, and a local copy that is the same page as a document", async () => {
    expect(page).not.toMatch(/<!DOCTYPE|<html[\s>]|<head>|<body>|<meta /i)
    expect(page).toMatch(/@media \(prefers-color-scheme: light\) \{\s*:root \{/)
    const local = await readFile(path.join(REPO_ROOT, "agents/conventions-review.local.html"), "utf8")
    expect(local).toBe(
      setupPageDocument(page).replace(
        "Generated from agents/setup-page.html by",
        "Generated from agents/conventions-review.html by",
      ),
    )
  })
})
