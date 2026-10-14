export type JsonObject = Record<string, unknown>

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error("output is not JSON")
  }
}

export const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback
export const stringOr = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)

/** Every string field of `source`, for captures: a tool's own fields are the only place they can come from. */
export function stringFields(source: JsonObject): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) if (typeof value === "string") fields[key] = value
  return fields
}
