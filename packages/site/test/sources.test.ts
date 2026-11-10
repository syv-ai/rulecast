import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  agentDocUrl,
  agentPrompt,
  assertPlaced,
  CONTENT_PATHS,
  exampleBinding,
  exampleSection,
  GROUPS,
  INSTALL_SCRIPT,
  LEAD,
  PAGES,
  pageBody,
  REPO_ROOT,
  readme,
  readmeSections,
  sidebar,
  splitTitle,
} from "../scripts/sources"
import { publicInstaller, sync } from "../scripts/sync"

describe("readmeSections", () => {
  it("splits on ## outside fenced code, and drops the README's own title", () => {
    const sections = readmeSections("# rulecast\n\nLead.\n\n## One\n\n```md\n## not a heading\n```\n\n## Two\n\nText.")
    expect([...sections.keys()]).toEqual([LEAD, "One", "Two"])
    expect(sections.get(LEAD)).toBe("Lead.")
    expect(sections.get("One")).toContain("## not a heading")
  })

  it("drops the README's centered header, title and badges included", () => {
    const sections = readmeSections(
      '<div align="center">\n\n<img src="logo.svg">\n\n# rulecast\n\n[![npm](https://img.shields.io/x)](https://npmjs.com)\n\n</div>\n\nLead.\n\n## One\n\nText.',
    )
    expect([...sections.keys()]).toEqual([LEAD, "One"])
    expect(sections.get(LEAD)).toBe("Lead.")
  })

  it("drops the README's pointer to the site, and keeps text that only names a page on it", () => {
    const sections = readmeSections(
      "# rulecast\n\n**Docs: [the site](https://syv-ai.github.io/rulecast/)**\n\nLead.\n\n## Agents\n\nRead https://syv-ai.github.io/rulecast/agents/SETUP.md",
    )
    expect(sections.get(LEAD)).toBe("Lead.")
    expect(sections.get("Agents")).toContain("agents/SETUP.md")
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
    expect(body).toContain("/rulecast:setup")
  })

  it("follows README sections with the agents/ file, whose title is dropped", () => {
    const body = pageBody(page("reference/detectors"), sections)
    expect(body).not.toMatch(/^# /m)
    expect(body.indexOf("| Detector | Catches |")).toBeLessThan(body.indexOf("## `regex`"))
  })

  it("leaves out an agent doc's note on its relative links, which the site rewrites", () => {
    const raw = readFileSync(path.join(REPO_ROOT, "agents/reference/output.md"), "utf8")
    expect(raw).toContain("Relative links in this file resolve")
    expect(pageBody(page("reference/output"), sections)).not.toContain("Relative links in this file resolve")
  })

  it("splits a title off a Markdown file", () => {
    expect(splitTitle("# Title\n\nBody")).toEqual({ title: "Title", body: "Body" })
  })
})

describe("the guides", () => {
  const sections = readme()
  const page = (route: string) => PAGES.find((candidate) => candidate.route === route)!

  it("hold what moved out of the README, each on its own page", () => {
    const advanced = pageBody(page("guides/advanced"), sections)
    expect(advanced).toContain("## Several agents at once")
    expect(advanced).toContain("## Git operations during a turn")
    expect(advanced).not.toMatch(/^# /m)
    expect(pageBody(page("guides/adopting-rules"), sections)).toContain("## A committed baseline")
    expect(pageBody(page("guides/git-hooks-ci"), sections)).toContain("## CI jobs and cloud agents")
    const agents = pageBody(page("guides/agents"), sections)
    for (const heading of ["## Claude Code", "## Other agents", "## What the agent gets wrong"]) {
      expect(agents).toContain(heading)
    }
    expect(agents).not.toContain("isolation: worktree")
    const commands = pageBody(page("reference/commands"), sections)
    expect(commands).toContain("## Advanced commands")
    expect(commands).toContain("`rulecast replay claude-code`")
    expect(commands).toContain("## Exit codes")
    const rules = pageBody(page("guides/writing-rules"), sections)
    expect(rules).toContain("## A rule")
    expect(rules).toContain("## Refusing a write")
  })

  it("leave the README's centered blocks off the site and unwrap its <details>", () => {
    const lead = sections.get(LEAD) ?? ""
    expect(lead).not.toMatch(/<div|<img|<details|<summary|shields\.io/)
    expect(lead).toContain("rulecast: 1 rule violated")
  })
})

describe("sidebar", () => {
  it("lists the groups in order, each page once, with the agent docs closed", () => {
    const groups = sidebar()
    expect(groups.map((group) => group.label)).toEqual([...GROUPS])
    const links = groups.flatMap((group) => group.items.map((item) => item.link))
    expect([...links].sort()).toEqual(PAGES.map((page) => `/${page.route}/`).sort())
    expect(groups.filter((group) => group.collapsed).map((group) => group.label)).toEqual(["For agents"])
    expect(groups.find((group) => group.label === "Start here")!.items.map((item) => item.label)).toEqual([
      "Getting started",
      "How it works",
    ])
    expect(groups.find((group) => group.label === "Guides")!.items.map((item) => item.label)).toEqual([
      "Writing rules",
      "Adopting rules",
      "Git hooks and CI",
      "Using it with your agent",
    ])
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

describe("agentPrompt", () => {
  it("is the README's paste-this prompt, pointing at the SETUP.md this site serves", () => {
    expect(agentPrompt()).toMatch(/^Set up rulecast in this project with me\./)
    expect(agentPrompt()).toContain(agentDocUrl("agents/SETUP.md"))
  })
})

describe("exampleSection", () => {
  it("is the doc section the opening output delivers, by file and text", () => {
    expect(exampleSection()).toEqual({
      ref: "conventions/backend.md#errors",
      file: "conventions/backend.md",
      text: expect.stringMatching(/^## Errors\n\nServices raise domain exceptions\./),
    })
  })
})

describe("install.sh", () => {
  it("is site content, taken from the release like the docs", () => {
    expect(CONTENT_PATHS).toContain(INSTALL_SCRIPT)
  })

  it("is served at the site's root, byte for byte", async () => {
    await sync()
    expect(readFileSync(publicInstaller, "utf8")).toBe(readFileSync(path.join(REPO_ROOT, INSTALL_SCRIPT), "utf8"))
  })
})
