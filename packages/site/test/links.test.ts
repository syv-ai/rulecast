import { describe, expect, it } from "vitest"
import { dropSelfPointers, rewriteLinks } from "../scripts/links"
import { PAGES, readme } from "../scripts/sources"
import { pageMarkdown } from "../scripts/sync"

describe("rewriteLinks", () => {
  it("sends a link to a published file to its page, anchor included", () => {
    expect(rewriteLinks("[f](agents/reference/rule-format.md#keys)", "README.md")).toBe(
      "[f](/rulecast/reference/rule-format/#keys)",
    )
  })

  it("resolves against the source file's own directory", () => {
    expect(rewriteLinks("[d](reference/detectors.md)", "agents/DRAFT-RULES.md")).toBe(
      "[d](/rulecast/reference/detectors/)",
    )
    expect(rewriteLinks("[d](DRAFT-RULES.md)", "agents/SETUP.md")).toBe("[d](/rulecast/agents/draft-rules/)")
  })

  it("sends an unpublished file to GitHub", () => {
    expect(rewriteLinks("[LICENSE](LICENSE)", "README.md")).toBe(
      "[LICENSE](https://github.com/syv-ai/rulecast/blob/main/LICENSE)",
    )
  })

  it("sends a link to a README heading to the page that section is on", () => {
    // Performance is a fragment, imported by how-it-works under its own heading.
    expect(rewriteLinks("[p](README.md#performance)", "README.md")).toBe("[p](/rulecast/how-it-works/#performance)")
    expect(rewriteLinks("[g](README.md#getting-started)", "README.md")).toBe("[g](/rulecast/getting-started/)")
    expect(rewriteLinks("[i](../README.md#install)", "guides/advanced.md")).toBe(
      "[i](/rulecast/getting-started/#install)",
    )
    expect(rewriteLinks("[r](README.md)", "README.md")).toBe("[r](/rulecast/)")
  })

  it("sends a link to a guide to its page, anchor kept", () => {
    expect(rewriteLinks("[f](../../guides/advanced.md#fresh-environments)", "agents/reference/loops.md")).toBe(
      "[f](/rulecast/guides/advanced/#fresh-environments)",
    )
    expect(rewriteLinks("[a](guides/advanced.md)", "README.md")).toBe("[a](/rulecast/guides/advanced/)")
    expect(rewriteLinks("[b](advanced.md#a-committed-baseline)", "guides/adopting-rules.md")).toBe(
      "[b](/rulecast/guides/advanced/#a-committed-baseline)",
    )
  })

  it("leaves absolute URLs and same-page anchors alone", () => {
    const markdown = "[a](https://example.com/x.md) [b](#errors)"
    expect(rewriteLinks(markdown, "README.md")).toBe(markdown)
  })
})

describe("pages made of a README section and a file", () => {
  const sections = readme()
  const body = (route: string) => pageMarkdown(PAGES.find((page) => page.route === route)!, sections)

  it("drop the sentences that point from one part to the other, which is the page itself", () => {
    const writing = body("guides/writing-rules")
    expect(writing).not.toContain("More in [Writing rules]")
    expect(writing).not.toContain("The README's [A rule]")
    expect(writing).toContain("This guide covers the rest")
    const commands = body("reference/commands")
    expect(commands).not.toContain("The commands most projects use are in")
    expect(commands).toContain("`rulecast <command> --help` prints a command's flags.")
    const detectors = body("reference/detectors")
    expect(detectors).not.toMatch(/See \[`agents\/reference\/detectors\.md`\]/)
    expect(detectors).toContain("a rule can opt into the edit hook with `stages: [edit, verify]`.")
  })

  it("keep a sentence that links to another page", () => {
    expect(
      dropSelfPointers("Read [Writing rules](guides/writing-rules.md). Then stop.", "README.md", "guides/git-hooks-ci"),
    ).toBe("Read [Writing rules](guides/writing-rules.md). Then stop.")
  })

  it("leave lists, code and the part's own anchors alone", () => {
    const markdown =
      "- More in [Writing rules](guides/writing-rules.md).\n\n```md\nMore in [Writing rules](guides/writing-rules.md).\n```\n\nSee [below](#turning-a-rule-off)."
    expect(dropSelfPointers(markdown, "README.md", "guides/writing-rules")).toBe(markdown)
  })
})
