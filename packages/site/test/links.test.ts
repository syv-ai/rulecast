import { describe, expect, it } from "vitest"
import { dropSelfPointers, rawAgentDoc, rewriteLinks } from "../scripts/links"
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
    expect(
      rewriteLinks("[c](../../guides/git-hooks-ci.md#ci-jobs-and-cloud-agents)", "agents/reference/loops.md"),
    ).toBe("[c](/rulecast/guides/git-hooks-ci/#ci-jobs-and-cloud-agents)")
    expect(rewriteLinks("[a](guides/advanced.md)", "README.md")).toBe("[a](/rulecast/guides/advanced/)")
    expect(rewriteLinks("[b](adopting-rules.md#a-committed-baseline)", "guides/git-hooks-ci.md")).toBe(
      "[b](/rulecast/guides/adopting-rules/#a-committed-baseline)",
    )
  })

  it("gives a link whose text is the target's path the page's title instead", () => {
    expect(
      rewriteLinks(
        "See [`agents/reference/rule-format.md`](../agents/reference/rule-format.md).",
        "guides/writing-rules.md",
      ),
    ).toBe("See [Rule format](/rulecast/reference/rule-format/).")
    expect(rewriteLinks("[output.md](output.md#rulecast-test)", "agents/reference/rule-format.md")).toBe(
      "[Output contract](/rulecast/reference/output/#rulecast-test)",
    )
    expect(rewriteLinks("[reference/detectors.md](reference/detectors.md)", "agents/DRAFT-RULES.md")).toBe(
      "[Detectors](/rulecast/reference/detectors/)",
    )
  })

  it("keeps link text that is not the target's path, and the path of an unpublished file", () => {
    expect(rewriteLinks("[the output contract](output.md)", "agents/reference/stats.md")).toBe(
      "[the output contract](/rulecast/reference/output/)",
    )
    expect(rewriteLinks("[`detectors.md`](output.md)", "agents/reference/stats.md")).toBe(
      "[`detectors.md`](/rulecast/reference/output/)",
    )
    expect(rewriteLinks("[`LICENSE`](LICENSE)", "README.md")).toBe(
      "[`LICENSE`](https://github.com/syv-ai/rulecast/blob/main/LICENSE)",
    )
  })

  it("leaves absolute URLs and same-page anchors alone", () => {
    const markdown = "[a](https://example.com/x.md) [b](#errors)"
    expect(rewriteLinks(markdown, "README.md")).toBe(markdown)
  })

  it("rewrites a link whose text wraps onto the next line", () => {
    expect(rewriteLinks("See [the rule\nformat](agents/reference/rule-format.md#keys).", "README.md")).toBe(
      "See [the rule\nformat](/rulecast/reference/rule-format/#keys).",
    )
  })

  it("rewrites both an image and the link around it", () => {
    expect(rewriteLinks("[![x](a.svg)](guides/advanced.md)", "README.md")).toBe(
      "[![x](https://github.com/syv-ai/rulecast/blob/main/a.svg)](/rulecast/guides/advanced/)",
    )
  })

  it("rewrites a link whose text holds brackets", () => {
    expect(rewriteLinks("[`a[0]`](guides/advanced.md)", "README.md")).toBe("[`a[0]`](/rulecast/guides/advanced/)")
  })

  it("leaves a link in code alone", () => {
    const markdown = "`[a](guides/advanced.md)`\n\n```md\n[a](guides/advanced.md)\n```"
    expect(rewriteLinks(markdown, "README.md")).toBe(markdown)
  })
})

describe("rawAgentDoc", () => {
  const served = (repoPath: string) => repoPath.startsWith("agents/")

  it("sends a link out of the served tree to the file on GitHub, and keeps a link within it", () => {
    expect(
      rawAgentDoc(
        "[t](../../guides/agents.md#reading-the-trend) [d](../DRAFT-RULES.md#2-sort) [o](output.md) [w](https://x.dev)",
        "agents/reference/stats.md",
        served,
      ),
    ).toBe(
      "[t](https://github.com/syv-ai/rulecast/blob/main/guides/agents.md#reading-the-trend) [d](../DRAFT-RULES.md#2-sort) [o](output.md) [w](https://x.dev)",
    )
  })

  it("keeps the link text, a path included", () => {
    expect(rawAgentDoc("[`guides/advanced.md`](../guides/advanced.md)", "agents/SETUP.md", served)).toBe(
      "[`guides/advanced.md`](https://github.com/syv-ai/rulecast/blob/main/guides/advanced.md)",
    )
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
    const detectors = body("reference/detectors")
    expect(detectors).not.toMatch(/See \[`agents\/reference\/detectors\.md`\]/)
    expect(detectors).toContain("a rule can opt into the edit hook with `stages: [edit, verify]`.")
  })

  it("keep a sentence that links to another page", () => {
    expect(
      dropSelfPointers("Read [Writing rules](guides/writing-rules.md). Then stop.", "README.md", "guides/git-hooks-ci"),
    ).toBe("Read [Writing rules](guides/writing-rules.md). Then stop.")
  })

  it("drop a sentence whose link the old pattern missed: text over two lines, brackets in it", () => {
    expect(
      dropSelfPointers(
        "Keep this. More in [the writing\nrules guide](guides/writing-rules.md). And this.",
        "README.md",
        "guides/writing-rules",
      ),
    ).toBe("Keep this. And this.")
    expect(
      dropSelfPointers("See [`a[0]`](guides/writing-rules.md).\n\nNext.", "README.md", "guides/writing-rules"),
    ).toBe("Next.")
  })

  it("do not split a sentence inside a link's text", () => {
    expect(
      dropSelfPointers(
        "Read [e.g. this. Or that](guides/writing-rules.md) now. Kept.",
        "README.md",
        "guides/writing-rules",
      ),
    ).toBe("Kept.")
  })

  it("leave lists, code and the part's own anchors alone", () => {
    const markdown =
      "- More in [Writing rules](guides/writing-rules.md).\n\n```md\nMore in [Writing rules](guides/writing-rules.md).\n```\n\nSee [below](#turning-a-rule-off)."
    expect(dropSelfPointers(markdown, "README.md", "guides/writing-rules")).toBe(markdown)
  })
})
