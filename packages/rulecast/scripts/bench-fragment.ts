import { writeFileSync } from "node:fs"

import { measureScenario, type ScenarioResult } from "./bench/measure"
import { renderReportFragment } from "./bench/report"
import { SCENARIOS } from "./bench/scenarios"

/**
 * The report without a document skeleton, for a host that supplies its own — publishing the same
 * numbers as a shareable page. `pnpm bench` writes the standalone file; this writes the fragment.
 */
const out = process.argv[2]
if (out === undefined) throw new Error("usage: tsx scripts/bench-fragment.ts <file>")

const results: ScenarioResult[] = []
for (const scenario of SCENARIOS) results.push(await measureScenario(scenario))
writeFileSync(out, renderReportFragment(results, null))
process.stdout.write(`wrote ${out}\n`)
