import { describe, expect, it } from "vitest"
import { anatomy } from "../scripts/anatomy"

describe("anatomy", () => {
  const { ruleHtml, outputHtml } = anatomy()
  const lit = (html: string) => [...html.matchAll(/rc-a-lit">(.*?)<\/span>$/gm)].map((match) => match[1])

  it("lights the rule's message and context", () => {
    expect(lit(ruleHtml).join("\n")).toMatch(/message:[\s\S]*context:[\s\S]*@conventions\/backend\.md#errors/)
    expect(ruleHtml).not.toMatch(/rc-a-lit">\s*files:/)
  })

  it("lights the output's message, with each template value marked, and the doc section", () => {
    expect(outputHtml).toContain('<span class="rc-a-value" title="{{args}}">404</span>')
    expect(outputHtml).toMatch(/rc-a-lit">--- conventions\/backend\.md#errors ---/)
    expect(outputHtml).not.toMatch(/rc-a-lit">rulecast:/)
  })
})
