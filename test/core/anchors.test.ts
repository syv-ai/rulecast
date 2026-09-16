import { describe, expect, test } from "vitest"

import { scanHeadings, sectionContains, sectionRange, sectionText, slugify } from "../../src/core/anchors"

const doc = [
  "# Conventions", //                 1
  "", //                              2
  "## Frontend data flow", //         3
  "Use query hooks.", //              4
  "### Errors", //                    5
  "Map errors in the hook.", //       6
  "```md", //                         7
  "## Not a heading", //              8
  "```", //                           9
  "## State", //                     10
  "Server state in queries.", //     11
  "", //                             12
  "Forms", //                        13
  "-----", //                        14
  "Use react-hook-form.", //         15
  "## State", //                     16
].join("\n")

describe("slugify", () => {
  test("follows GitHub heading slugs", () => {
    expect(slugify("Frontend data flow")).toBe("frontend-data-flow")
    expect(slugify("API: `useQuery` & errors!")).toBe("api-usequery--errors")
    expect(slugify("Æblegrød 2")).toBe("æblegrød-2")
  })
})

describe("scanHeadings", () => {
  test("finds ATX and setext headings, skips fenced code, numbers duplicates", () => {
    expect(scanHeadings(doc).map((h) => [h.level, h.slug, h.line])).toEqual([
      [1, "conventions", 1],
      [2, "frontend-data-flow", 3],
      [3, "errors", 5],
      [2, "state", 10],
      [2, "forms", 13],
      [2, "state-1", 16],
    ])
  })

  test("strips closing hashes from ATX headings", () => {
    expect(scanHeadings("## Title ##")[0]?.text).toBe("Title")
    expect(scanHeadings("## C#")[0]?.text).toBe("C#")
  })
})

describe("sectionRange", () => {
  test("runs to the next heading of the same or higher level", () => {
    expect(sectionRange(doc, "frontend-data-flow")).toEqual({ slug: "frontend-data-flow", start: 3, end: 9 })
    expect(sectionRange(doc, "errors")).toEqual({ slug: "errors", start: 5, end: 9 })
    expect(sectionRange(doc, "state")).toEqual({ slug: "state", start: 10, end: 12 })
    expect(sectionRange(doc, "conventions")).toEqual({ slug: "conventions", start: 1, end: 16 })
    expect(sectionRange(doc, "missing")).toBeNull()
  })

  test("sectionText returns the lines without trailing blank lines", () => {
    expect(sectionText(doc, sectionRange(doc, "state")!)).toBe("## State\nServer state in queries.")
  })
})

describe("sectionContains", () => {
  test("a section contains its subsections and itself, not its parent", () => {
    expect(sectionContains(doc, "frontend-data-flow", "errors")).toBe(true)
    expect(sectionContains(doc, "errors", "errors")).toBe(true)
    expect(sectionContains(doc, "errors", "frontend-data-flow")).toBe(false)
    expect(sectionContains(doc, "state", "forms")).toBe(false)
  })
})
