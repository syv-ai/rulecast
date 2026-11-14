import { z } from "zod"

export const TOOL_NAMES = ["biome", "eslint", "gitleaks", "oxlint", "ruff"] as const

/**
 * Why `id` is not a rule id the tool reports, or null. Biome takes `--only=noDebugger` too, but
 * reports `suspicious/noDebugger`: a bare name would run and never match a finding.
 */
export function ruleIdProblem(tool: string, id: string): string | null {
  if (tool === "ruff" && !/^[A-Z]+[0-9]+$/.test(id)) return "ruff reports rule codes such as B006, not names"
  if (tool === "biome" && !/^[a-z0-9]+\/[A-Za-z0-9]+$/.test(id)) {
    return "biome reports rules as group/rule, such as suspicious/noDebugger"
  }
  return null
}

/** A ruff code or selector: its linter's letters, then digits (`B006`, `B`, `E5`, `PLR09`). */
const RUFF_CODE = /^([A-Z]+)([0-9]*)$/

/**
 * Selectors ruff has renamed, from ruff's rule_redirects table (crates/ruff_linter/src/
 * rule_redirects.rs), as ruff 0.17 applies them: each pair was checked with `ruff check --select
 * <old> --show-settings`. ruff still takes the old name but reports the new code. Codes whose new
 * code is not the old one under a renamed prefix are listed one by one; the renamed prefixes after.
 */
const RUFF_RENAMED_CODES: Readonly<Record<string, string>> = {
  IC001: "ICN001",
  IC002: "ICN001",
  IC003: "ICN001",
  IC004: "ICN001",
  M: "RUF100",
  M0: "RUF100",
  M001: "RUF100",
  PGH001: "S307",
  PGH002: "G010",
  PIE802: "C419",
  PLR1701: "SIM101",
  PLW0117: "PLW0177",
  PLW0130: "B033",
  RUF004: "B026",
  RUF011: "B035",
  RUF025: "C420",
  RUF035: "S704",
  SIM111: "SIM110",
  T001: "FIX001",
  T002: "FIX002",
  T003: "FIX003",
  T004: "FIX004",
  TCH006: "TC010",
  // flake8-trio's rules were all ASYNC1xx: bare TRIO selects exactly those.
  TRIO: "ASYNC1",
  TRY200: "B904",
  TRY302: "TRY203",
}
/** Renamed linter prefixes, followed by any digits: TCH001 is TC001, U00 is UP00, I25 is TID25. */
const RUFF_RENAMED_PREFIXES: readonly [string, string][] = [
  ["TCH", "TC"],
  ["TRIO", "ASYNC"],
  ["PDV", "PD"],
  ["IC", "ICN"],
  ["I2", "TID2"],
  ["U", "UP"],
  ["R", "RET"],
]

/** A ruff selector under its current name. */
function ruffCurrent(selector: string): string {
  const code = RUFF_RENAMED_CODES[selector]
  if (code !== undefined) return code
  for (const [old, current] of RUFF_RENAMED_PREFIXES) {
    if (selector.startsWith(old) && /^[0-9]*$/.test(selector.slice(old.length))) {
      return current + selector.slice(old.length)
    }
  }
  return selector
}

/**
 * Whether a rule's `rules` entry selects a finding's rule id. A ruff entry is a selector, as in
 * ruff's `select`: `B` takes B006 but not BLE001 (another linter), `E5` takes E501, `PL` takes
 * pylint's PLC, PLE, PLR and PLW, `ALL` takes everything, and a renamed selector takes what its
 * current name does (TCH001 takes TC001). Other tools' ids match exactly.
 */
export function ruleSelects(tool: string, selector: string, ruleId: string): boolean {
  if (tool !== "ruff") return selector === ruleId
  if (selector === "ALL") return true
  const want = RUFF_CODE.exec(ruffCurrent(selector))
  const code = RUFF_CODE.exec(ruleId)
  if (!want || !code) return selector === ruleId
  // pylint is ruff's one linter whose codes add a category letter to its prefix.
  const letters = want[1] === "PL" && /^PL[CERW]$/.test(code[1]!) && want[2] === "" ? code[1]! : want[1]!
  return letters === code[1] && code[2]!.startsWith(want[2]!)
}

export const linterSchema = z
  .object({
    tool: z.enum(TOOL_NAMES),
    /**
     * Linter rule ids to report, turned on for rulecast's run even where the project's config leaves
     * them off. Omitted: what the project's own config makes an error.
     */
    rules: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    // ruff's `rules` may also select a prefix (B, E5); a Biome rule is always group/rule.
    if (config.tool !== "biome") return
    for (const [index, id] of (config.rules ?? []).entries()) {
      const problem = ruleIdProblem(config.tool, id)
      if (problem !== null) context.addIssue({ code: "custom", path: ["rules", index], message: `${id}: ${problem}` })
    }
  })

export type LinterConfig = z.infer<typeof linterSchema>
export type ToolName = (typeof TOOL_NAMES)[number]
