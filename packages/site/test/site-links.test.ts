import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { slug } from "../scripts/links"
import { BASE, FRAGMENT_PAGE, FRAGMENTS, PAGES, REPO_ROOT, readme } from "../scripts/sources"
import { fragmentMarkdown, pageMarkdown } from "../scripts/sync"

const docsDir = fileURLToPath(new URL("../src/content/docs/", import.meta.url))

/** Every page's Markdown as sync writes it, by route; the home page is "". Hand pages are read as written. */
function siteMarkdown(): Map<string, string> {
  const sections = readme()
  const fragments = Object.values(FRAGMENTS).map((heading) => fragmentMarkdown(heading, sections))
  const pages = new Map<string, string>([["", readFileSync(path.join(docsDir, "index.mdx"), "utf8")]])
  for (const page of PAGES) {
    const markdown =
      "hand" in page.source
        ? readFileSync(path.join(docsDir, `${page.route}.mdx`), "utf8")
        : pageMarkdown(page, sections)
    pages.set(page.route, page.route === FRAGMENT_PAGE ? [markdown, ...fragments].join("\n\n") : markdown)
  }
  return pages
}

const withoutFences = (markdown: string) => markdown.replace(/^(```|~~~)[\s\S]*?^\1/gm, "")

function headingIds(markdown: string): Set<string> {
  return new Set([...withoutFences(markdown).matchAll(/^#{2,6} (.+)$/gm)].map((m) => slug(m[1]!.trim())))
}

/** The site links on each page that point at no page, file or heading: `route: target`. */
function deadLinks(pages: Map<string, string>): string[] {
  const ids = new Map([...pages].map(([route, markdown]) => [route, headingIds(markdown)]))
  const dead: string[] = []
  for (const [route, markdown] of pages) {
    for (const [, target] of withoutFences(markdown).matchAll(/\]\(([^)\s]+)\)/g)) {
      let page: string
      let anchor: string | undefined
      if (target!.startsWith("#")) [page, anchor] = [route, target!.slice(1)]
      else if (target!.startsWith(`${BASE}/`)) {
        const [file = "", hash] = target!.slice(BASE.length + 1).split("#")
        if (path.extname(file) !== "") {
          if (!existsSync(path.join(REPO_ROOT, file))) dead.push(`${route}: ${target}`)
          continue
        }
        ;[page, anchor] = [file.replace(/\/$/, ""), hash]
      } else continue
      const known = ids.get(page)
      if (known === undefined || (anchor !== undefined && !known.has(anchor))) dead.push(`${route}: ${target}`)
    }
  }
  return dead
}

describe("the site's links", () => {
  it("every link to a page, file or heading on the site resolves", () => {
    expect(deadLinks(siteMarkdown())).toEqual([])
  })

  it("names a link to a heading no page has", () => {
    const pages = new Map([
      ["a", "## Here\n\n[x](#here) [y](/rulecast/b/#gone) [z](#nowhere)"],
      ["b", "## There"],
    ])
    expect(deadLinks(pages)).toEqual(["a: /rulecast/b/#gone", "a: #nowhere"])
  })
})
