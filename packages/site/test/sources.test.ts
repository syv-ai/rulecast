import { describe, expect, it } from "vitest"
import {
  assertPlaced,
  exampleBinding,
  LEAD,
  PAGES,
  pageBody,
  readme,
  readmeSections,
  splitTitle,
} from "../scripts/sources"

describe("readmeSections", () => {
  it("splits on ## outside fenced code, and drops the README's own title", () => {
    const sections = readmeSections("# rulecast\n\nLead.\n\n## One\n\n```md\n## not a heading\n```\n\n## Two\n\nText.")
    expect([...sections.keys()]).toEqual([LEAD, "One", "Two"])
    expect(sections.get(LEAD)).toBe("Lead.")
    expect(sections.get("One")).toContain("## not a heading")
  })

  it("drops the README's pointer to the site", () => {
    const sections = readmeSections("# rulecast\n\nDocs: https://syv-ai.github.io/rulecast/\n\nLead.")
    expect(sections.get(LEAD)).toBe("Lead.")
  })
})

describe("assertPlaced", () => {
  it("passes on the real README", () => {
    expect(() => assertPlaced(readme())).not.toThrow()
  })

  it("names a README section that no page places", () => {
    const sections = new Map(readme())
    sections.set("Brand new", "text")
    expect(() => assertPlaced(sections)).toThrow(/README section "Brand new" is on no page/)
  })

  it("names a placed section the README no longer has", () => {
    const sections = new Map(readme())
    sections.delete("Commands")
    expect(() => assertPlaced(sections)).toThrow(/places README section "Commands"/)
  })
})

describe("pageBody", () => {
  const sections = readme()
  const page = (route: string) => PAGES.find((candidate) => candidate.route === route)!

  it("drops a section heading that is the page title and keeps the others", () => {
    const body = pageBody(page("getting-started"), sections)
    expect(body).not.toMatch(/^## Getting started/m)
    expect(body).toMatch(/^## Install$/m)
    expect(body).toContain("npx @syv-ai/rulecast init")
  })

  it("follows README sections with the agents/ file, whose title is dropped", () => {
    const body = pageBody(page("reference/detectors"), sections)
    expect(body).not.toMatch(/^# /m)
    expect(body.indexOf("| Detector | Catches |")).toBeLessThan(body.indexOf("## `regex`"))
  })

  it("splits a title off a Markdown file", () => {
    expect(splitTitle("# Title\n\nBody")).toEqual({ title: "Title", body: "Body" })
  })
})

describe("exampleBinding", () => {
  it("finds the line the README's example rule produces in its opening output", () => {
    const binding = exampleBinding()
    expect(binding.values).toMatchObject({ file: "app/services/users.py", line: "2", args: "404" })
  })

  it("throws when the rule's message produces no output line", () => {
    const sections = new Map(readme())
    sections.set("A rule", (sections.get("A rule") ?? "").replace(/message: ".*"/, 'message: "{{file}} is wrong."'))
    expect(() => exampleBinding(sections)).toThrow(/produces no line of the opening output/)
  })
})
