import path from "node:path"

import { CONFIG_FILE } from "../config/load"
import { displayPath } from "../projects"
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
 * - `findings`, `preexisting`, `preexistingSummary`, `touches`, `refused`, `swept`, `overflowPaths`
 *   and `disabled`: concatenated in part order.
 * - `references`: one per `(ref, location)`, the most complete state kept (REFERENCE_STATES), at the
 *   place it first appeared.
 * - A rule id two parts both deliver with different `templates`: the later part's findings, template
 *   and omitted entries carry `<id> (<config dir>)` instead, so they render as a rule of their own.
 *   With the same template they group as one rule. Display only; `preexistingSummary` and `refused`
 *   keep the plain id, since they never group by template.
 * - `stop`: the strongest (STOPS). `unattended` and `via: "shell"`: set if any part sets them.
 * - `warnings` and `notices`: concatenated, each prefixed with its config's path relative to
 *   `displayFrom`. `agentNotices` are about the session, not a config: unprefixed, said once.
 * - `configs`: each part's config, relative to `displayFrom`, in part order.
 * - `omitted`: `findings` merged per rule and per swept/not swept (the renderer finds an entry by
 *   both), counts and files summed; `rules` and `preexisting` summed.
 */
export function combineDeliveries(parts: { root: string; delivery: Delivery }[], displayFrom: string): Delivery {
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
    configs: parts.map(({ root }) => configLabel(root)),
  }
  const firstTemplate = new Map<string, string>()
  const agentNotices = new Set<string>()

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
    if (delivery.disabled !== undefined) combined.disabled = [...(combined.disabled ?? []), ...delivery.disabled]
    combined.overflowPaths.push(...delivery.overflowPaths)

    for (const reference of delivery.references) addReference(combined.references, reference)

    if (STOPS.indexOf(delivery.stop) < STOPS.indexOf(combined.stop)) combined.stop = delivery.stop
    if (delivery.unattended === true) combined.unattended = true
    if (delivery.via === "shell") combined.via = "shell"

    const prefix = `${configLabel(root)}: `
    combined.warnings.push(...delivery.warnings.map((warning) => prefix + warning))
    if (delivery.notices !== undefined) {
      combined.notices = [...(combined.notices ?? []), ...delivery.notices.map((notice) => prefix + notice)]
    }
    for (const notice of delivery.agentNotices ?? []) agentNotices.add(notice)

    mergeOmitted(combined.omitted, delivery.omitted, label)
  }

  if (agentNotices.size > 0) combined.agentNotices = [...agentNotices]
  return combined
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
    }
  }
}
