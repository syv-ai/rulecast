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

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new UnknownTemplateVariable(name)
    return value
  })
}
