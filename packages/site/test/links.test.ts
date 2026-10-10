import { describe, expect, it } from "vitest"
import { rewriteLinks } from "../scripts/links"

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

  it("leaves absolute URLs and same-page anchors alone", () => {
    const markdown = "[a](https://example.com/x.md) [b](#errors)"
    expect(rewriteLinks(markdown, "README.md")).toBe(markdown)
  })
})
