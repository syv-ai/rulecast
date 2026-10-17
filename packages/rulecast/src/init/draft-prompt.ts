/**
 * The prompt init hands the developer for their own coding agent (spec §12, Agent docs). `doc` is the detected
 * primary doc. CONVENTIONS.md is the one door: it confirms conventions a doc already states, works out the rest
 * with the developer, and hands over to DRAFT-RULES.md. The URL stays one literal so test/agents-docs.test.ts can check that the file it names exists.
 */
export function draftPrompt(tag: string, doc: string | null): string {
  return [
    `Read https://raw.githubusercontent.com/syv-ai/rulecast/${tag}/agents/CONVENTIONS.md`,
    `and follow it with me to work out this project's conventions, starting from ${doc ?? "the project's docs"}, then draft rulecast rules for them.`,
  ].join("\n")
}
