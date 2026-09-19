/**
 * The prompt init hands the developer for their own coding agent (spec §12, Agent docs). `doc` is the detected
 * primary doc. The URL stays one literal so test/agents-docs.test.ts can check that the file it names exists.
 */
export function draftPrompt(tag: string, doc: string | null): string {
  return [
    `Read https://raw.githubusercontent.com/syv-ai/rulecast/${tag}/agents/DRAFT-RULES.md`,
    `and follow it to draft rulecast rules for this project from ${doc ?? "the project's docs"}.`,
  ].join("\n")
}
