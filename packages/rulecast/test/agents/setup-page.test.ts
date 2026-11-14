import { readFile } from "node:fs/promises"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { beforeAll, describe, expect, test } from "vitest"

import { setupPageDocument } from "../../scripts/sync-version"
import { REPO_ROOT } from "../helpers/catalog"
import { themeBlocks } from "./theme"

/** agents/setup-page.html, run without a browser: its render(data) is a pure function of the data. */
let page: string
let renderScript: string
let sample: Record<string, unknown>

beforeAll(async () => {
  page = await readFile(path.join(REPO_ROOT, "agents/setup-page.html"), "utf8")
  renderScript = /<script id="render">([\s\S]*?)<\/script>/.exec(page)![1]!
  sample = JSON.parse(/<script type="application\/json" id="setup-data">([\s\S]*?)<\/script>/.exec(page)![1]!)
})

const render = (data: unknown): string => runInNewContext(`${renderScript}\nrender(data)`, { data }) as string
const count = (html: string, needle: string) => html.split(needle).length - 1

describe("setup page", () => {
  test("the sample renders two questions, six numbered rules, seven rows, two candidates and the footer", () => {
    const html = render(sample)
    expect(html).toContain("rulecast for <b>tidewater</b>")
    expect(count(html, 'class="q"')).toBe(2)
    expect(count(html, '<div class="rule ')).toBe(6)
    expect(count(html, '<details class="row')).toBe(7)
    expect(html).toContain("off · say 15 to turn on")
    expect(count(html, '<div class="cand ')).toBe(2)
    expect(count(html, "state-default")).toBeGreaterThanOrEqual(6)
    expect(count(html, '<span class="tag">recommended</span>')).toBe(1)
    // The questions come first, right after the header.
    expect(html.indexOf("Needs your answer")).toBeLessThan(html.indexOf("The repository"))
    expect(html).toContain('<div class="cell go">Say <b>go ahead</b>, or name numbers to strike or change.')
    expect(html).toContain("├─ ")
    expect(html).toContain("└─ ")
  })

  test("every n on the sample page is unique across rules, rows, questions and candidates", () => {
    const items = ["questions", "rules", "decisions", "candidates"].flatMap(
      (key) => (sample[key] as { n: number }[] | undefined) ?? [],
    )
    const numbers = items.map((item) => item.n)
    expect(numbers.every((n) => Number.isInteger(n))).toBe(true)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  test("a struck row keeps its number and shows its value crossed out", () => {
    const html = render({ project: "p", decisions: [{ n: 4, state: "struck", decision: "a", value: "x", lands: "c" }] })
    expect(html).toContain(">4<")
    expect(html).toContain("<del>x</del>")
    expect(html).toContain('<details class="row struck">')
  })

  test("an off item says how to turn it on", () => {
    const html = render({ project: "p", rules: [{ n: 3, state: "off", name: "ruff-format", source: "s", text: "t" }] })
    expect(html).toContain("say 3 to turn on")
  })

  test("an answered question shows the answer instead of its options", () => {
    const question = {
      n: 1,
      question: "May rules ask a model?",
      why: [],
      options: [{ text: "Yes, with Haiku", lands: "l" }],
    }
    const open = render({ project: "p", questions: [{ ...question, answer: null }] })
    expect(open).toContain("Yes, with Haiku")
    expect(open).toContain("<h2>Needs your answer</h2>")
    const answered = render({ project: "p", questions: [{ ...question, answer: "No llm rules." }] })
    expect(answered).toContain('<p class="ans">No llm rules.</p>')
    expect(answered).not.toContain("Yes, with Haiku")
  })

  test("rows without n are numbered in order, for the conventions review", () => {
    const html = render({
      project: "p",
      decisions: [
        { decision: "a", value: "b", lands: "c", state: "said" },
        { decision: "d", value: "e", lands: "f", state: "said", open: true },
      ],
    })
    expect(html).toContain('<span class="i">1</span><span class="d">a</span>')
    expect(html).toContain('<span class="i">2</span><span class="d">d</span>')
    expect(html).toContain('<span class="v state-said">b</span>')
    expect(count(html, '<details class="row" open>')).toBe(1)
    expect(html).toContain('<span class="none">nothing to find</span>')
  })

  test("every string from the data is text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>"
    const html = render({
      project: hostile,
      questionsTitle: hostile,
      questions: [
        { n: hostile, question: hostile, why: [hostile], options: [{ text: hostile, lands: hostile }], answer: null },
        { n: 2, question: hostile, why: [], options: [], answer: hostile },
      ],
      tree: [{ depth: 0, name: hostile, marks: [{ kind: hostile, text: hostile }] }],
      rules: [{ n: hostile, state: "off", name: hostile, source: hostile, text: hostile }],
      decisions: [
        {
          n: hostile,
          state: hostile,
          decision: hostile,
          found: hostile,
          value: hostile,
          lands: hostile,
          why: [hostile],
          detail: { label: hostile, code: hostile },
        },
      ],
      candidates: [{ n: hostile, state: "struck", text: hostile, source: hostile, note: hostile, sketch: hostile }],
      footer: { go: hostile, aside: hostile },
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    // An unknown mark kind falls back to a note, and an unknown state to "default", rather than becoming a class name.
    expect(html).toContain('<span class="a note">')
    expect(html).toContain('<span class="v state-default">')
  })

  test("backticks become code, also inside escaped text", () => {
    const html = render({
      project: "p",
      decisions: [{ decision: "a", value: "use `<b>` here", lands: "`x`", why: [] }],
    })
    expect(html).toContain("use <code>&lt;b&gt;</code> here")
    expect(html).toContain("<code>x</code>")
  })

  test("code blocks dim comments and mark additions", () => {
    const html = render({
      project: "p",
      decisions: [
        { decision: "a", value: "b", lands: "c", why: [], detail: { label: "L", code: "# note\n+ added\nplain" } },
      ],
    })
    expect(html).toContain('<pre><span class="c"># note</span>\n<span class="add">added</span>\nplain</pre>')
  })

  test("without a tree or candidates those sections are left out, for the conventions review", () => {
    const html = render({
      project: "p",
      decisionsTitle: "Conventions",
      decisions: [{ decision: "a", value: "b", lands: "c" }],
    })
    expect(html).not.toContain("The repository")
    expect(html).not.toContain("First rule")
    expect(html).not.toContain("sessions start here")
    expect(html).toContain("<h2>Conventions</h2>")
  })

  test("a closing script tag written as \\u003c stays inside the data block and shows as text", () => {
    const json = JSON.stringify({ project: "</script>" }).replaceAll("<", "\\u003c")
    expect(json).not.toContain("</script")
    expect(render(JSON.parse(json))).toContain("&lt;/script&gt;")
  })

  test("it loads nothing but its fonts", () => {
    const urls = [...page.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((match) => new URL(match[1]!).host)
    expect(new Set(urls)).toEqual(new Set(["fonts.googleapis.com", "fonts.gstatic.com"]))
  })

  test("the page is a fragment an artifact publisher can wrap, in the viewer's theme (#81)", () => {
    expect(page).not.toMatch(/<!DOCTYPE|<html[\s>]|<head>|<body>|<meta /i)
    expect(page.indexOf("<title>")).toBeLessThan(page.indexOf("<style>"))
    expect(page.indexOf("</style>")).toBeLessThan(page.indexOf('<main class="page" id="app">'))
    // The host's data-theme wins over the system's preference: the viewer's app theme can differ.
    const { light, dark } = themeBlocks(page)
    expect(light.get("--bg")).not.toBe(dark.get("--bg"))
  })

  test("the local copy is the fragment as a whole document", async () => {
    const local = await readFile(path.join(REPO_ROOT, "agents/setup-page.local.html"), "utf8")
    expect(local).toBe(setupPageDocument(page))
    expect(local.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(local.indexOf("<style>")).toBeGreaterThan(local.indexOf("<head>"))
    expect(local.indexOf("<main")).toBeGreaterThan(local.indexOf("<body>"))
  })
})
