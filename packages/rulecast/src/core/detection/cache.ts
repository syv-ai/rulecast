import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { isNotFound } from "../errors"
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

/** One JSON file per key; writes go through a temp file and rename, so readers never see partial values. */
export function diskCache(dir: string): Cache {
  const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex")}.json`)
  return {
    async get<T>(key: string) {
      try {
        return JSON.parse(await readFile(fileFor(key), "utf8")) as T
      } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
      }
    },
    async set(key, value) {
      await mkdir(dir, { recursive: true })
      const target = fileFor(key)
      const temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(value))
      await rename(temp, target)
    },
  }
}

/** Cache directory for a detector kind in a project's state directory. */
export function detectorCacheDir(stateDir: string, kind: string): string {
  return path.join(stateDir, "cache", kind)
}
