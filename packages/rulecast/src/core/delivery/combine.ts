import path from "node:path"

import { CONFIG_FILE } from "../config/load"
import { bareContainer, displayPath, inOtherCheckout } from "../projects"
import type { DeliveredReference, Delivery, Omitted } from "../types"

/** Most complete first: content in full, then a file to read, then just the name, then not found. */
const REFERENCE_STATES: DeliveredReference["state"][] = ["full", "read", "pointer", "missing"]

/** The stop that wins when parts disagree, strongest first; `null` (not a stop) only when all are. */
const STOPS: Delivery["stop"][] = ["block", "report", "incomplete", "capReached", "allow", null]

/**
 * How several projects' results become one answer: one `Delivery` per config that judged the event,
 * in part order (nearest config first is the caller's choice). Every path in a part is already
 * relative to `displayFrom` (the pipeline rebased it), so files from different projects do not collide.
 *
 * - One part is returned as it is.
 * - `findings`, `preexisting`, `preexistingSummary`, `touches`, `refused`, `swept`, `repeated`,
 *   `overflowPaths` and `disabled`: concatenated in part order. `repeatedMore`, `repeatedCount` and `repeatedFixed`: summed.
 * - `references`: one per `(ref, location)`, the most complete state kept (REFERENCE_STATES), at the
 *   place it first appeared.
 * - A rule id two parts both deliver with different `templates`: the later part's findings, template
 *   and omitted entries carry `<id> (<config dir>)` instead, so they render as a rule of their own.
 *   With the same template they group as one rule. Display only; `preexistingSummary` and `refused`
 *   keep the plain id, since they never group by template.
 * - `stop`: the strongest (STOPS). `unattended` and `via: "shell"`: set if any part sets them.
 * - `warnings` and `notices`: concatenated, each labelled as `labels` says. `agentNotices` are about the session, not a config: unprefixed, said once.
 * - `conventionDocs`: concatenated in part order, each path once.
 * - `configs`: the config of each part with something for the agent (`forAgent`), relative to
 *   `displayFrom`, in part order: a preamble names the configs whose rules it is about, not every
 *   config the event ran.
 * - `omitted`: `findings` merged per rule and per swept/not swept (the renderer finds an entry by
 *   both), counts and files summed, `inFiles` joined; `rules` and `preexisting` summed.
 */
/**
 * How a project's warnings and notices are labelled: `config`, by its config's path (the CLI);
 * `checkout`, an agent's hooks: by `checkoutTag`, and only a project of another checkout or below the
 * agent (the developer, 2026-11-15).
 */
export type Labels = "config" | "checkout"

/** The marker around a `checkout` label, which no warning's own text holds (adapters/claude-code). */
export const TAG = "\u0001"

/**
 * The short name of a project's checkout for a line said to the user, or null for the agent's own:
 * one at or above the agent's directory, unless the agent is in a worktree under it
 * (`.claude/worktrees/<name>`), which is a checkout of its own. By the directory's name, or its path
 * when two projects share a name.
 */
export function checkoutTags(roots: readonly string[], displayFrom: string): (string | null)[] {
  const dirs = roots.map((root) => displayPath(root, displayFrom)("."))
  const own = (root: string, dir: string) => {
    if (dir !== "." && !/^\.\.(\/\.\.)*$/.test(dir)) return false
    const down = path.relative(path.resolve(root), path.resolve(displayFrom)).split(path.sep).join("/")
    // Claude Code's own worktree layout says so by its path; any other worktree, git does.
    // A bare repository's directory is no checkout: its config is each worktree's below it.
    if (bareContainer(path.resolve(root))) return true
    return !/(^|\/)\.claude\/worktrees\//.test(`${down}/`) && !inOtherCheckout(root, displayFrom)
  }
  const names = roots.map((root) => path.basename(path.resolve(root)))
  return roots.map((root, index) => {
    if (own(root, dirs[index]!)) return null
    const name = names[index]!
    const shared = names.filter((other, at) => other === name && at !== index && !own(roots[at]!, dirs[at]!))
    if (shared.length === 0) return name
    // A path above the agent has no directory to name but its own: its parent's name goes with it.
    const dir = dirs[index]!
    const below = /^\.\.(\/\.\.)*$/.test(dir) ? "" : dir.replace(/^(\.\.\/)+/, "")
    const resolved = path.resolve(root)
    return below !== "" && below !== name ? below : `${path.basename(path.dirname(resolved))}/${name}`
  })
}

export function combineDeliveries(
  parts: { root: string; delivery: Delivery }[],
  displayFrom: string,
  labels: Labels = "config",
): Delivery {
  if (labels === "checkout") {
    // Even one part: a project beside or below the agent, or in another checkout, is named.
    const tags = checkoutTags(
      parts.map(({ root }) => root),
      displayFrom,
    )
    parts = parts.map((part, index) => {
      const tag = tags[index]
      if (tag === null || tag === undefined) return part
      const mark = (text: string) => `${TAG}${tag}${TAG}${text}`
      const notices = part.delivery.notices?.map(mark)
      return {
        ...part,
        delivery: { ...part.delivery, warnings: part.delivery.warnings.map(mark), ...(notices ? { notices } : {}) },
      }
    })
  }
  if (parts.length === 1) return parts[0]!.delivery

  const shown = (root: string, file: string) => displayPath(root, displayFrom)(file)
  const configLabel = (root: string) => shown(root, CONFIG_FILE)
  const ruleLabel = (root: string) => {
    const dir = shown(root, ".")
    return dir === "." ? path.basename(path.resolve(root)) || "." : dir
  }

  const combined: Delivery = {
    findings: [],
    preexistingSummary: [],
    references: [],
    touches: [],
    stop: null,
    warnings: [],
    templates: {},
    omitted: { findings: [], rules: 0, preexisting: 0 },
    overflowPaths: [],
    configs: parts.filter(({ delivery }) => forAgent(delivery)).map(({ root }) => configLabel(root)),
  }
  const firstTemplate = new Map<string, string>()
  const agentNotices = new Set<string>()
  const conventionDocs = new Set<string>()

  for (const { root, delivery } of parts) {
    // A rule id an earlier part already delivers with a different template gets this part's label.
    const relabel = new Map<string, string>()
    for (const [rule, template] of Object.entries(delivery.templates)) {
      const earlier = firstTemplate.get(rule)
      if (earlier === undefined) firstTemplate.set(rule, template)
      else if (earlier !== template) relabel.set(rule, `${rule} (${ruleLabel(root)})`)
    }
    const label = (rule: string) => relabel.get(rule) ?? rule

    combined.findings.push(
      ...delivery.findings.map((finding) =>
        relabel.has(finding.rule) ? { ...finding, rule: label(finding.rule) } : finding,
      ),
    )
    for (const [rule, template] of Object.entries(delivery.templates)) {
      combined.templates[label(rule)] ??= template
    }
    if (delivery.preexisting !== undefined)
      combined.preexisting = [...(combined.preexisting ?? []), ...delivery.preexisting]
    combined.preexistingSummary.push(...delivery.preexistingSummary)
    combined.touches.push(...delivery.touches)
    if (delivery.refused !== undefined) combined.refused = [...(combined.refused ?? []), ...delivery.refused]
    if (delivery.swept !== undefined) combined.swept = [...(combined.swept ?? []), ...delivery.swept]
    if (delivery.repeated !== undefined) combined.repeated = [...(combined.repeated ?? []), ...delivery.repeated]
    if (delivery.repeatedMore !== undefined)
      combined.repeatedMore = (combined.repeatedMore ?? 0) + delivery.repeatedMore
    if (delivery.repeatedCount !== undefined) {
      const was = combined.repeatedCount ?? { count: 0, rules: [] }
      const rules = [...new Set([...was.rules, ...delivery.repeatedCount.rules])].sort()
      combined.repeatedCount = { count: was.count + delivery.repeatedCount.count, rules }
    }
    if (delivery.repeatedFixed !== undefined) {
      const was = combined.repeatedFixed ?? { fixed: 0, of: 0 }
      combined.repeatedFixed = {
        fixed: was.fixed + delivery.repeatedFixed.fixed,
        of: was.of + delivery.repeatedFixed.of,
      }
    }
    if (delivery.disabled !== undefined) combined.disabled = [...(combined.disabled ?? []), ...delivery.disabled]
    combined.overflowPaths.push(...delivery.overflowPaths)

    for (const reference of delivery.references) addReference(combined.references, reference)

    if (STOPS.indexOf(delivery.stop) < STOPS.indexOf(combined.stop)) combined.stop = delivery.stop
    if (delivery.unattended === true) combined.unattended = true
    if (delivery.via === "shell") combined.via = "shell"

    // `checkout` labels were put on above.
    const prefix = labels === "checkout" ? "" : `${configLabel(root)}: `
    combined.warnings.push(...delivery.warnings.map((warning) => prefix + warning))
    if (delivery.notices !== undefined) {
      combined.notices = [...(combined.notices ?? []), ...delivery.notices.map((notice) => prefix + notice)]
    }
    for (const notice of delivery.agentNotices ?? []) agentNotices.add(notice)
    for (const doc of delivery.conventionDocs ?? []) conventionDocs.add(doc)

    mergeOmitted(combined.omitted, delivery.omitted, label)
  }

  if (agentNotices.size > 0) combined.agentNotices = [...agentNotices]
  if (conventionDocs.size > 0) combined.conventionDocs = [...conventionDocs]
  return combined
}

/** The delivery puts something before the agent: a finding, a section, a stop to act on, a refused or swept file. */
function forAgent(delivery: Delivery): boolean {
  return (
    delivery.findings.length > 0 ||
    delivery.preexistingSummary.length > 0 ||
    delivery.references.length > 0 ||
    delivery.touches.length > 0 ||
    (delivery.stop !== null && delivery.stop !== "allow") ||
    (delivery.refused ?? []).length > 0 ||
    (delivery.swept ?? []).length > 0 ||
    (delivery.disabled ?? []).length > 0 ||
    delivery.omitted.findings.length > 0 ||
    delivery.omitted.rules > 0 ||
    delivery.omitted.preexisting > 0 ||
    delivery.overflowPaths.length > 0
  )
}

function addReference(references: DeliveredReference[], reference: DeliveredReference): void {
  const at = references.findIndex((kept) => kept.ref === reference.ref && kept.location === reference.location)
  if (at === -1) references.push(reference)
  else if (REFERENCE_STATES.indexOf(reference.state) < REFERENCE_STATES.indexOf(references[at]!.state)) {
    references[at] = reference
  }
}

function mergeOmitted(into: Omitted, from: Omitted, label: (rule: string) => string): void {
  into.rules += from.rules
  into.preexisting += from.preexisting
  for (const cut of from.findings) {
    const rule = label(cut.rule)
    const swept = cut.swept === true
    const entry = into.findings.find((kept) => kept.rule === rule && (kept.swept === true) === swept)
    if (entry === undefined) into.findings.push({ ...cut, rule })
    else {
      entry.count += cut.count
      entry.files += cut.files
      // Parts' files are distinct (each is relative to displayFrom), but a union costs nothing.
      if (entry.inFiles === undefined || cut.inFiles === undefined) delete entry.inFiles
      else entry.inFiles = [...new Set([...entry.inFiles, ...cut.inFiles])]
    }
  }
}
