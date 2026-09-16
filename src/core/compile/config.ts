import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"
import { z } from "zod"

import { errorMessage, formatZodError, isNotFound } from "../errors"

export const CONFIG_PATH = ".rulecast/config.yml"

export const configSchema = z
  .object({
    rules: z.string().default(".rulecast/rules/**/*.yml"),
    context: z
      .object({
        mode: z.enum(["inject", "read"]).default("inject"),
        maxBytes: z.number().int().positive().default(32768),
      })
      .strict()
      .default({}),
    maxMatchesPerRule: z.number().int().positive().default(10),
    timeouts: z
      .object({
        editDeadlineMs: z.number().int().positive().default(350),
        verifyMs: z.number().int().positive().default(60000),
      })
      .strict()
      .default({}),
    stopGate: z.object({ maxBlocks: z.number().int().nonnegative().default(3) }).strict().default({}),
    llm: z
      .object({
        provider: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
        model: z.string().default("claude-haiku-4-5-20251001"),
        baseUrl: z.string().nullable().default(null),
        apiKeyEnv: z.string().default("ANTHROPIC_API_KEY"),
        maxFilesPerVerify: z.number().int().positive().default(10),
      })
      .strict()
      .default({}),
  })
  .strict()

export type Config = z.infer<typeof configSchema>

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string }

export function defaultConfig(): Config {
  return configSchema.parse({})
}

export async function loadConfig(root: string): Promise<ConfigResult> {
  let text: string
  try {
    text = await readFile(path.join(root, CONFIG_PATH), "utf8")
  } catch (error) {
    if (isNotFound(error)) return { ok: true, config: defaultConfig() }
    throw error
  }
  let data: unknown
  try {
    data = parse(text) ?? {}
  } catch (error) {
    return { ok: false, message: `${CONFIG_PATH}: ${errorMessage(error)}` }
  }
  const result = configSchema.safeParse(data)
  if (!result.success) return { ok: false, message: `${CONFIG_PATH}: ${formatZodError(result.error)}` }
  return { ok: true, config: result.data }
}
