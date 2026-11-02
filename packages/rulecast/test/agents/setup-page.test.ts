import { readFile } from "node:fs/promises"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { beforeAll, describe, expect, test } from "vitest"

import { REPO_ROOT } from "../helpers/catalog"

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
  test("the sample renders the tree, six rows, three candidates and the footer", () => {
    const html = render(sample)
    expect(html).toContain("rulecast for <b>tidewater</b>")
    expect(count(html, '<details class="row"')).toBe(6)
    expect(count(html, '<p class="t">')).toBe(3)
    expect(count(html, '<details class="row" open>')).toBe(1)
    expect(html).toContain('<div class="go">Say <b>go ahead</b>')
    expect(html).toContain("├─ ")
    expect(html).toContain("└─ ")
    expect(html).toContain('<span class="none">nothing to find</span>')
  })

  test("every string from the data is text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>"
    const html = render({
      project: hostile,
      tree: [{ depth: 0, name: hostile, marks: [{ kind: hostile, text: hostile }] }],
      rules: [{ name: hostile, source: hostile, text: hostile }],
      decisions: [
        {
          decision: hostile,
          found: hostile,
          said: hostile,
          lands: hostile,
          why: [hostile],
          detail: { label: hostile, code: hostile },
        },
      ],
      candidates: [{ text: hostile, source: hostile, note: hostile, sketch: hostile }],
      footer: { go: hostile, aside: hostile },
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    // An unknown mark kind falls back to a note rather than becoming a class name.
    expect(html).toContain('<span class="a note">')
  })

  test("backticks become code, also inside escaped text", () => {
    const html = render({ project: "p", decisions: [{ decision: "a", said: "use `<b>` here", lands: "`x`", why: [] }] })
    expect(html).toContain("use <code>&lt;b&gt;</code> here")
    expect(html).toContain("<code>x</code>")
  })

  test("code blocks dim comments and mark additions", () => {
    const html = render({
      project: "p",
      decisions: [
        { decision: "a", said: "b", lands: "c", why: [], detail: { label: "L", code: "# note\n+ added\nplain" } },
      ],
    })
    expect(html).toContain('<pre><span class="c"># note</span>\n<span class="add">added</span>\nplain</pre>')
  })

  test("without a tree or candidates those sections are left out, for the conventions review", () => {
    const html = render({
      project: "p",
      decisionsTitle: "Conventions",
      decisions: [{ decision: "a", said: "b", lands: "c" }],
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
})
