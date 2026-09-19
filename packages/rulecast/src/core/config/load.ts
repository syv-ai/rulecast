import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

import { errorMessage, formatZodError, isNotFound } from "../errors"
import { type Config, configSchema } from "./schema"

export const CONFIG_FILE = ".rulecast-config.yaml"
export const MANIFEST_FILE = ".rulecast-rules.yaml"

export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string }

/** Reads and parses a YAML file; an empty document is null. */
export async function readYamlFile(file: string): Promise<Loaded<unknown>> {
  const name = path.basename(file)
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (isNotFound(error)) return { ok: false, message: `${name} not found` }
    throw error
  }
  try {
    return { ok: true, value: parse(text) ?? null }
  } catch (error) {
    return { ok: false, message: `${name}: ${errorMessage(error)}` }
  }
}

/** The project's config data, not yet validated. */
export function readConfigData(root: string): Promise<Loaded<unknown>> {
  return readYamlFile(path.join(root, CONFIG_FILE))
}

export function parseConfig(data: unknown): Loaded<Config> {
  const result = configSchema.safeParse(data)
  if (!result.success) return { ok: false, message: `${CONFIG_FILE}: ${formatZodError(result.error)}` }
  return { ok: true, value: result.data }
}

/** A rule repo's manifest: a list of rules, each parsed later on its own. */
export async function readManifest(dir: string): Promise<Loaded<unknown[]>> {
  const loaded = await readYamlFile(path.join(dir, MANIFEST_FILE))
  if (!loaded.ok) return loaded
  if (!Array.isArray(loaded.value)) return { ok: false, message: `${MANIFEST_FILE}: must be a list of rules` }
  return { ok: true, value: loaded.value }
}
