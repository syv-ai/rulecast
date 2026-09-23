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

/** The template with its variables shown as {name}: what a grouped rendering prints once, above the sites. */
export function templateSkeleton(template: string): string {
  return template.replace(VARIABLE, (_, name: string) => `{${name}}`)
}

/**
 * How much of a template is literal text. Grouping pays for itself in proportion to this: a message
 * that is mostly prose is worth printing once, and "{{file}}:{{line}} {{text}}" is not.
 */
export function templateLiteralLength(template: string): number {
  return oneLine(template.replace(VARIABLE, "")).length
}

/** Rendered in the location prefix of a grouped site line, so never listed as one of its values. */
const LOCATION_VARIABLES = new Set(["file", "line", "column", "rule"])

/** The template's variables that vary per site: everything the location prefix does not already say. */
export function templateBindings(template: string): string[] {
  return templateVariables(template).filter((name) => !LOCATION_VARIABLES.has(name))
}
