import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_FILE } from "../config/load"
import { isNotFound } from "../errors"
import type { Match } from "../types"

/**
 * What the user must be told about a session, not only the agent (spec §9, Oversight).
 *
 * An agent blocked at Stop can silence a finding two ways without fixing it: widen the config, or
 * add a `rulecast-ignore` comment. Both are sometimes right — and both are exactly what a model under
 * a block that believes it is right will reach for. Refusing them would break legitimate work
 * (`DRAFT-RULES.md` has agents edit the config), so rulecast lets them through and makes sure the
 * person who owns the rules hears about it.
 */
export function notices(input: {
  /** The config's hash at the session's first event; null for a store older than this check. */
  startConfigHash: string | null
  currentConfigHash: string | null
  /** Findings dropped by an ignore, classified as findings are: new means on a line changed this session. */
  ignored: readonly { rule: string; match: Match; reason: string; status: "new" | "preexisting" }[]
  /** Keys already told this session: each change is told once, not at every Stop after it. */
  told: ReadonlySet<string>
}): Notice[] {
  const out: Notice[] = []
  const configKey = `config:${input.currentConfigHash ?? "gone"}`
  if (
    input.startConfigHash !== null &&
    input.startConfigHash !== input.currentConfigHash &&
    !input.told.has(configKey)
  ) {
    out.push({
      key: configKey,
      text: `rulecast: ${CONFIG_FILE} changed during this session; findings may have been silenced. Review: git diff ${CONFIG_FILE}`,
    })
  }
  const keyOf = ({ rule, match }: { rule: string; match: Match }) => `ignore:${rule}:${match.file}:${match.line}`
  const added = input.ignored.filter((ignored) => ignored.status === "new" && !input.told.has(keyOf(ignored)))
  if (added.length > 0) {
    const sites = added.map(({ rule, match, reason }) => `${match.file}:${match.line} (${rule}: "${reason}")`)
    const comments = added.length === 1 ? "a rulecast-ignore comment" : `${added.length} rulecast-ignore comments`
    out.push({
      key: added.map(keyOf).join("\n"),
      text: `rulecast: the agent added ${comments} this session: ${sites.join(", ")}`,
    })
  }
  return out
}

export interface Notice {
  /** What is recorded as told; an ignores notice carries one key per site, newline-separated. */
  key: string
  text: string
}

/** sha256 of the config file's bytes; null when it is gone. */
export async function configHash(root: string): Promise<string | null> {
  try {
    return createHash("sha256")
      .update(await readFile(path.join(root, CONFIG_FILE)))
      .digest("hex")
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}
