const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export const CORE_VARIABLES = ["file", "line", "column", "text", "rule"] as const

export class UnknownTemplateVariable extends Error {
  constructor(readonly variable: string) {
    super(`template variable "${variable}" has no value`)
  }
}

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((match) => match[1]!))]
}

/**
 * A message is one line: every renderer — terminal, agent, json, sarif — and every adapter's
 * output format assumes it. A matched value need not be, and often is not: an ast-grep rule
 * matching `style={{ … }}` spans several lines, and so does an llm rule's reason. Collapsing here
 * rather than in each renderer means there is one place it can be got wrong.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new UnknownTemplateVariable(name)
    return oneLine(value)
  })
}
