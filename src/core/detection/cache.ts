import type { Cache } from "../types"

export function memoryCache(): Cache {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return values.has(key) ? (structuredClone(values.get(key)) as T) : undefined
    },
    async set(key, value) {
      values.set(key, structuredClone(value))
    },
  }
}
