import { readFile } from "node:fs/promises"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { beforeAll, beforeEach, describe, expect, test } from "vitest"

import { setupPageDocument } from "../../scripts/sync-version"
import { createFakeStore, type FakeStore, settle } from "../helpers/artifact-db"
import { REPO_ROOT } from "../helpers/catalog"
import { themeBlocks } from "./theme"

/** agents/conventions-review.html, run without a browser: render(data, decisions, view) is pure (#82). */
let page: string
let renderScript: string
let reviewScript: string
let sample: { conflicts: { id: string }[]; topics: { id: string; candidates: { id: string; text: string }[] }[] }

beforeAll(async () => {
  page = await readFile(path.join(REPO_ROOT, "agents/conventions-review.html"), "utf8")
  renderScript = /<script id="render">([\s\S]*?)<\/script>/.exec(page)![1]!
  reviewScript = /<script id="review">([\s\S]*?)<\/script>/.exec(page)![1]!
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
    expect(themeBlocks(page)).toBeTruthy()
    const local = await readFile(path.join(REPO_ROOT, "agents/conventions-review.local.html"), "utf8")
    expect(local).toBe(
      setupPageDocument(page).replace(
        "Generated from agents/setup-page.html by",
        "Generated from agents/conventions-review.html by",
      ),
    )
  })

  test("only the card being decided stays shown under 'undecided only', so it doesn't vanish while typed in", () => {
    const topic = sample.topics[0]!
    const id = topic.candidates[0]!.id
    const decisions = { [id]: { kind: "candidate", choice: "decline", note: "Too vague." } }
    const view = { step: topic.id, undecidedOnly: true }
    expect(render(decisions, view)).not.toContain(`data-card="${id}"`)
    expect(render(decisions, { ...view, open: id })).toContain(`data-card="${id}" open`)
  })

  test("a choice the page doesn't offer is never drawn, and never as markup", () => {
    const topic = sample.topics[1]!
    const id = topic.candidates[0]!.id
    const html = render(
      { [id]: { kind: "candidate", choice: 'keep"><img src=x onerror=alert(1)>' } },
      { step: topic.id },
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("recommend keep")
  })
})

type Decision = { id?: string; kind: string; choice: string | null; words: string; note: string; at: string }
type Review = {
  decisions(): Record<string, Decision>
  status(): { store: string; unsaved: number; problem: string | null }
  choose(id: string, value: string): Promise<void>
  type(id: string, field: "words" | "note", value: string): void
  pause(id: string): { redraw: boolean; saved: Promise<void> }
  drawn(): void
  connect(db: unknown): void
}

/** The page's review script, as the page runs it, with what it keeps in the browser collected. */
function openReview(data: unknown = sample, saved: unknown = undefined, wait: () => Promise<void> = async () => {}) {
  const persisted: { decisions: Record<string, Decision>; unsaved: string[] }[] = []
  const changes: string[] = []
  const review = runInNewContext(
    `${renderScript}\n${reviewScript}\ncreateReview(data, { saved, persist: (state) => persisted.push(JSON.parse(JSON.stringify(state))), onChange: (why) => changes.push(why), wait })`,
    { data, saved, persisted, changes, wait },
  ) as Review
  return { review, persisted, changes }
}

const docId = (id: string) => call("docId(id)", { id }) as string

describe("conventions review page, published with the db capability", () => {
  let store: FakeStore
  const python = () => sample.topics[1]!.candidates[0]!.id
  const principle = () => sample.topics[0]!.candidates[0]!.id

  beforeEach(() => {
    store = createFakeStore()
  })

  test("a decision is one document in decisions, with the id in its body, and the viewer's choice", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    await review.choose(python(), "keep")
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ id: python(), kind: "candidate", choice: "keep" })
    expect(review.status()).toEqual({ store: "db", unsaved: 0, problem: null })
  })

  test("an id the store can't take as a document id is written under an encoded one, with the id as written in its body", async () => {
    const data = JSON.parse(JSON.stringify(sample))
    data.topics[1].candidates[0].id = "python/absolute-imports"
    const { review } = openReview(data)
    review.connect(store.viewer())
    await settle()
    await review.choose("python/absolute-imports", "keep")
    await settle()
    expect(docId("python/absolute-imports")).toBe("python~2Fabsolute-imports")
    expect(store.get("decisions", "python~2Fabsolute-imports")).toMatchObject({
      id: "python/absolute-imports",
      choice: "keep",
    })
    expect(review.status().unsaved).toBe(0)
    expect(docId("..")).not.toBe("..")
    expect(docId("a~b")).toBe("a~7Eb")
  })

  test("what another viewer stored is cleaned before it is drawn: a choice the page doesn't offer is none", async () => {
    store.put("decisions", docId(python()), {
      id: python(),
      kind: "conflict",
      choice: 'keep"><img src=x onerror=alert(1)>',
      note: "<b>mine</b>",
      words: 42,
    })
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    expect(review.decisions()[python()]).toMatchObject({
      kind: "candidate",
      choice: null,
      note: "<b>mine</b>",
      words: "",
    })
    const html = render(review.decisions(), { step: sample.topics[1]!.id, open: python() })
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<b>mine</b>")
  })

  test("a write the store refuses keeps the decision here, says so in the bar, and a snapshot doesn't wipe it", async () => {
    const { review, persisted } = openReview()
    review.connect(store.viewer({ canWrite: false }))
    await settle()
    await review.choose(python(), "keep")
    await settle()
    expect(store.get("decisions", docId(python()))).toBeUndefined()
    expect(review.decisions()[python()]!.choice).toBe("keep")
    const status = review.status()
    expect(status.unsaved).toBe(1)
    expect(status.problem).toBeTruthy()
    expect(persisted.at(-1)!.unsaved).toEqual([python()])

    store.put("decisions", docId(principle()), {
      id: principle(),
      kind: "candidate",
      choice: "keep",
      words: "",
      note: "",
      at: "x",
    })
    await settle()
    expect(review.decisions()[python()]!.choice).toBe("keep")
    expect(review.decisions()[principle()]!.choice).toBe("keep")

    const bar = render(review.decisions(), { ...review.status(), step: "finish" })
    expect(bar).toContain("1 not saved with the page")
    expect(bar).toContain("Copy decisions")
  })

  test("a decision kept here because the store refused it survives a reload", async () => {
    const first = openReview()
    first.review.connect(store.viewer({ canWrite: false }))
    await settle()
    await first.review.choose(python(), "keep")
    await settle()
    const again = openReview(sample, first.persisted.at(-1))
    again.review.connect(store.viewer({ canWrite: false }))
    await settle()
    expect(again.review.decisions()[python()]!.choice).toBe("keep")
    expect(again.review.status().unsaved).toBe(1)
  })

  test("two viewers: what one types is kept until its write lands, and the other's changes still arrive", async () => {
    const a = openReview()
    const b = openReview()
    a.review.connect(store.viewer())
    b.review.connect(store.viewer())
    await settle()
    const id = principle()

    await a.review.choose(id, "keep")
    await settle()
    a.review.type(id, "note", "A's note")
    // B declines it while A is typing.
    await b.review.choose(id, "decline")
    b.review.type(id, "note", "B's reason")
    await b.review.pause(id).saved
    await settle()
    expect(a.review.decisions()[id]).toMatchObject({ choice: "decline", note: "A's note" })

    await a.review.pause(id).saved
    await settle()
    // A wrote only the field it changed: B's choice stands.
    expect(store.get("decisions", docId(id))).toMatchObject({ choice: "decline", note: "A's note" })

    // A's write landed, so B's later change reaches A.
    await b.review.choose(id, "keep")
    await settle()
    expect(a.review.decisions()[id]!.choice).toBe("keep")
  })

  test("a field whose write is still in flight is not overwritten by a snapshot", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    const id = principle()
    await review.choose(id, "decline")
    await settle()
    store.hold()
    review.type(id, "note", "Not here.")
    const { saved } = review.pause(id)
    store.put("decisions", docId(id), { ...store.get("decisions", docId(id)), choice: "decline", note: "" })
    await settle()
    expect(review.decisions()[id]!.note).toBe("Not here.")
    store.release()
    await saved
    await settle()
    expect(store.get("decisions", docId(id))!.note).toBe("Not here.")
    expect(review.decisions()[id]!.note).toBe("Not here.")
  })

  test("typing a reason redraws once it completes the decision, not on every pause", async () => {
    const { review } = openReview()
    const id = principle()
    await review.choose(id, "decline")
    review.drawn()
    review.type(id, "note", "T")
    review.type(id, "note", "To")
    review.type(id, "note", "Too vague")
    const first = review.pause(id)
    expect(first.redraw).toBe(true)
    await first.saved
    review.drawn()
    review.type(id, "note", "Too vague, and done.")
    expect(review.pause(id).redraw).toBe(false)
  })

  test("when the store stops answering, the page stops writing to it and keeps decisions here", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    store.fail()
    await settle()
    expect(review.status().store).toBe("local")
    expect(review.status().problem).toBeTruthy()
    await review.choose(python(), "keep")
    await settle()
    expect(store.get("decisions", docId(python()))).toBeUndefined()
    expect(review.decisions()[python()]!.choice).toBe("keep")
    expect(render(review.decisions(), { ...review.status(), step: "finish" })).toContain("Copy decisions")
  })

  test("a decision made before the page reached the store is written once the store answers", async () => {
    const offline = openReview()
    await offline.review.choose(python(), "keep")
    // The next visit reaches the store.
    const { review } = openReview(sample, offline.persisted.at(-1))
    expect(review.status().unsaved).toBe(1)
    review.connect(store.viewer())
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ id: python(), choice: "keep" })
    expect(review.status()).toEqual({ store: "db", unsaved: 0, problem: null })
  })

  test("a decision made after the store stopped answering is written on the next visit, unless the store's is newer", async () => {
    const first = openReview()
    first.review.connect(store.viewer())
    await settle()
    await first.review.choose(python(), "keep")
    await first.review.choose(principle(), "keep")
    await settle()
    store.fail()
    await settle()
    await first.review.choose(python(), "decline")
    first.review.type(python(), "note", "Not here.")
    await first.review.pause(python()).saved
    await first.review.choose(principle(), "decline")
    expect(first.persisted.at(-1)!.unsaved.sort()).toEqual([principle(), python()].sort())
    // Meanwhile another viewer changed one of them, later.
    store.put("decisions", docId(principle()), {
      id: principle(),
      kind: "candidate",
      choice: "reword",
      words: "Theirs.",
      note: "",
      at: "9999-01-01T00:00:00.000Z",
    })

    const { review } = openReview(sample, first.persisted.at(-1))
    review.connect(store.viewer())
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ choice: "decline", note: "Not here." })
    expect(review.decisions()[principle()]).toMatchObject({ choice: "reword", words: "Theirs." })
    expect(store.get("decisions", docId(principle()))).toMatchObject({ choice: "reword" })
    expect(review.status().unsaved).toBe(0)
  })

  test("a document deleted elsewhere leaves the page, and the next decision creates it again", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    await review.choose(python(), "keep")
    await settle()
    store.remove("decisions", docId(python()))
    await settle()
    expect(review.decisions()[python()]).toBeUndefined()
    await review.choose(python(), "decline")
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ choice: "decline" })
    expect(review.status().unsaved).toBe(0)
  })

  test("a document deleted while a write to it was in flight is written whole", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    const id = principle()
    await review.choose(id, "decline")
    await settle()
    store.hold()
    review.type(id, "note", "Not here.")
    const { saved } = review.pause(id)
    await settle()
    store.remove("decisions", docId(id))
    store.release()
    await saved
    await settle()
    expect(store.get("decisions", docId(id))).toMatchObject({ id, choice: "decline", note: "Not here." })
    expect(review.status().unsaved).toBe(0)
  })

  test("a stale copy from an earlier visit doesn't decide which documents exist", async () => {
    const { review } = openReview()
    const cached = {
      [docId(python())]: { id: python(), kind: "candidate", choice: "keep", words: "", note: "", at: "x" },
    }
    review.connect(store.viewer({ cached }))
    await settle()
    expect(review.decisions()[python()]).toBeUndefined()
    await review.choose(python(), "decline")
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ choice: "decline" })
  })

  test("a write that meets unavailable is tried once more; a second unavailable leaves it unsaved", async () => {
    const { review } = openReview()
    review.connect(store.viewer())
    await settle()
    store.failNext("unavailable")
    await review.choose(python(), "keep")
    await settle()
    expect(store.get("decisions", docId(python()))).toMatchObject({ choice: "keep" })
    store.failNext("unavailable", "unavailable")
    await review.choose(principle(), "keep")
    await settle()
    expect(store.get("decisions", docId(principle()))).toBeUndefined()
    expect(review.status().unsaved).toBe(1)
    expect(review.decisions()[principle()]!.choice).toBe("keep")
  })

  test("a snapshot held back while a box had focus is drawn when the focus leaves, after the click that took it", () => {
    const afterBlur = (state: Record<string, boolean>) => call("afterBlur(state)", { state }) as string
    const base = { deferred: true, stillTyping: false, toElementInPage: false, pointerDown: false }
    expect(afterBlur(base)).toBe("draw")
    expect(afterBlur({ ...base, pointerDown: true })).toBe("click")
    expect(afterBlur({ ...base, toElementInPage: true })).toBe("wait")
    expect(afterBlur({ ...base, stillTyping: true })).toBe("wait")
    expect(afterBlur({ ...base, deferred: false })).toBe("wait")
  })

  test("an edit the store stops answering before its pause is unsaved, and written on the next visit", async () => {
    const first = openReview()
    first.review.connect(store.viewer())
    await settle()
    const id = principle()
    await first.review.choose(id, "decline")
    await settle()
    first.review.type(id, "note", "Not here.")
    store.fail()
    await settle()
    await first.review.pause(id).saved
    expect(first.persisted.at(-1)!.unsaved).toEqual([id])

    const { review } = openReview(sample, first.persisted.at(-1))
    review.connect(store.viewer())
    await settle()
    expect(store.get("decisions", docId(id))).toMatchObject({ choice: "decline", note: "Not here." })
  })

  test("a write that lands after the store stopped answering doesn't mark a later edit saved", async () => {
    const first = openReview()
    first.review.connect(store.viewer())
    await settle()
    const id = principle()
    store.hold()
    const kept = first.review.choose(id, "keep")
    await settle()
    store.fail()
    await settle()
    const declined = first.review.choose(id, "decline")
    first.review.type(id, "note", "Not here.")
    const paused = first.review.pause(id).saved
    store.release()
    await Promise.all([kept, declined, paused])
    await settle()
    expect(store.get("decisions", docId(id))).toMatchObject({ choice: "keep" })
    expect(first.persisted.at(-1)!.unsaved).toEqual([id])

    const { review } = openReview(sample, first.persisted.at(-1))
    review.connect(store.viewer())
    await settle()
    expect(store.get("decisions", docId(id))).toMatchObject({ choice: "decline", note: "Not here." })
  })

  test("a retry after unavailable, when the store has stopped answering meanwhile, leaves the decision unsaved", async () => {
    const { review } = openReview(sample, undefined, async () => store.fail())
    review.connect(store.viewer())
    await settle()
    store.failNext("unavailable")
    await review.choose(python(), "keep")
    await settle()
    expect(review.status()).toEqual({
      store: "local",
      unsaved: 1,
      problem: "The decisions saved with the page can't be reached any more",
    })
    expect(review.decisions()[python()]!.choice).toBe("keep")
  })
})
