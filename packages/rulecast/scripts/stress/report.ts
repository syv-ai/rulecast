import type { Outcome, ScenarioResult, Target } from "./types"
import { TARGETS } from "./types"

/**
 * The stress report: one self-contained page, no network, both themes.
 *
 * Colour comes from the data-viz reference palette's **status** slots — good, warning, serious,
 * critical — because an outcome is a state, not a series. Those four are deliberately reserved and
 * never themed. Two of them (warning `#fab219` and serious `#ec835a`) sit close enough that hue
 * cannot carry the distinction alone, which is why every outcome here is spelled out in words and
 * given its own glyph, in the legend, on every bar and in the table. Nothing is gated behind colour,
 * and the table says everything the chart does.
 *
 * The one chart answers what a table is worse at: how much of its ceiling each measured check
 * actually used. Scenarios assert against limits in different units and different orders of
 * magnitude — a 350 ms edit deadline, a 30 second verify, a 9,000 character budget — and the share
 * of its own limit is the one quantity that compares across them. Elapsed wall clock is not
 * plotted: a scenario that builds a 5,000 file repository is slow by construction, and that says
 * nothing about rulecast.
 */

const html = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const OUTCOMES: Record<Outcome, { label: string; glyph: string; role: string; about: string }> = {
  ok: { label: "held", glyph: "✓", role: "good", about: "ran, and every check held" },
  violated: { label: "violated", glyph: "!", role: "warn", about: "ran, but a check failed — a finding with a number" },
  crashed: { label: "crashed", glyph: "✕", role: "serious", about: "threw, or exited non-zero" },
  hung: { label: "hung", glyph: "∞", role: "critical", about: "still running at its watchdog; killed" },
}

const TARGET_LABEL: Record<Target, string> = {
  scale: "Scale and performance",
  concurrency: "Concurrency and session state",
  adversarial: "Adversarial and malformed input",
  session: "Long agent sessions",
}

const ms = (value: number): string =>
  value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value).toLocaleString("en-US")} ms`

const ROW = 30
const BAR = 12
const LABEL_W = 234
const VALUE_W = 104
const PLOT_W = 760

interface Measured {
  scenario: string
  check: string
  ok: boolean
  share: number
  detail: string
}

function measuredChecks(results: ScenarioResult[]): Measured[] {
  const rows: Measured[] = []
  for (const result of results) {
    for (const check of result.observation?.checks ?? []) {
      if (check.measured === undefined) continue
      rows.push({
        scenario: result.name,
        check: check.name,
        ok: check.ok,
        share: check.measured.value / check.measured.limit,
        detail: check.detail,
      })
    }
  }
  return rows.sort((a, b) => b.share - a.share)
}

/**
 * Horizontal bars: what each numeric check measured, as a share of the ceiling it had to stay
 * under. 100% is the ceiling, so a bar past it is the finding. Scenarios whose absolute numbers
 * are not comparable — a 350 ms edit deadline and a 30 second verify — become comparable here.
 */
function headroomChart(rows: Measured[]): string {
  if (rows.length === 0) return ""
  const height = rows.length * ROW + 40
  const inner = PLOT_W - LABEL_W - VALUE_W
  const max = Math.max(1.5, ...rows.map((row) => row.share))
  const x = (share: number) => LABEL_W + (share / max) * inner
  const bottom = rows.length * ROW + 22

  const ticks = [0, 0.5, 1, 1.5].filter((tick) => tick <= max)
  const gridlines = ticks
    .map(
      (tick) =>
        `<line class="grid${tick === 1 ? " limit" : ""}" x1="${x(tick)}" y1="20" x2="${x(tick)}" y2="${bottom}" />
        <text class="tick" x="${x(tick)}" y="13" text-anchor="middle">${tick === 1 ? "limit" : `${tick * 100}%`}</text>`,
    )
    .join("")

  const bars = rows
    .map((row, index) => {
      const y = 22 + index * ROW
      const width = Math.max(2, x(row.share) - LABEL_W)
      const role = row.ok ? "good" : "critical"
      return `<g>
      <text class="name" x="${LABEL_W - 8}" y="${y + BAR - 2}" text-anchor="end">${html(row.scenario)}</text>
      <rect class="bar ${role}" x="${LABEL_W}" y="${y}" width="${width}" height="${BAR}" rx="4" />
      <text class="value" x="${LABEL_W + inner + 8}" y="${y + BAR - 2}">${row.ok ? "✓" : "!"} ${Math.round(
        row.share * 100,
      )}%</text>
      <text class="sublabel" x="${LABEL_W - 8}" y="${y + BAR + 10}" text-anchor="end">${html(row.check)}</text>
    </g>`
    })
    .join("")

  return `<svg viewBox="0 0 ${PLOT_W} ${height}" role="img" width="100%"
    aria-label="Each numeric check as a share of the ceiling it had to stay under">
    <title>Each numeric check as a share of its limit</title>
    ${gridlines}
    <line class="axis" x1="${LABEL_W}" y1="20" x2="${LABEL_W}" y2="${bottom}" />
    ${bars}
  </svg>`
}

function checksList(result: ScenarioResult): string {
  const checks = result.observation?.checks ?? []
  if (checks.length === 0) return `<span class="muted">no observation — the scenario did not report</span>`
  return `<ul class="checks">${checks
    .map(
      (check) =>
        `<li class="${check.ok ? "held" : "broke"}"><span class="glyph">${check.ok ? "✓" : "!"}</span>
        <span>${html(check.name)}<span class="detail">${html(check.detail)}</span></span></li>`,
    )
    .join("")}</ul>`
}

function metricsList(result: ScenarioResult): string {
  const metrics = Object.entries(result.observation?.metrics ?? {})
  if (metrics.length === 0) return ""
  return `<dl class="metrics">${metrics
    .map(([key, value]) => {
      const shown = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1)
      return `<div><dt>${html(key)}</dt><dd>${shown}</dd></div>`
    })
    .join("")}</dl>`
}

function tableRows(results: ScenarioResult[]): string {
  return results
    .map((result) => {
      const outcome = OUTCOMES[result.outcome]
      const notes = result.observation?.notes ?? []
      return `<tr>
      <th scope="row">${html(result.name)}<span class="about">${html(result.about)}</span></th>
      <td>${html(TARGET_LABEL[result.target])}</td>
      <td><span class="pill ${outcome.role}"><span class="glyph">${outcome.glyph}</span>${outcome.label}</span></td>
      <td class="num">${ms(result.elapsedMs)}<span class="detail">watchdog ${ms(result.timeoutMs)}</span></td>
      <td>${checksList(result)}${metricsList(result)}${
        result.error ? `<p class="error">${html(result.error.split("\n")[0] ?? "")}</p>` : ""
      }${notes.map((note) => `<p class="note">${html(note)}</p>`).join("")}</td>
    </tr>`
    })
    .join("")
}

export function renderReport(results: ScenarioResult[], generated = new Date()): string {
  const counts = Object.fromEntries(
    (Object.keys(OUTCOMES) as Outcome[]).map((key) => [key, results.filter((one) => one.outcome === key).length]),
  ) as Record<Outcome, number>
  const found = results.length - counts.ok
  const wall = results.reduce((sum, one) => sum + one.elapsedMs, 0)
  const driven = TARGETS.filter((target) => results.some((one) => one.target === target))

  const legend = (Object.keys(OUTCOMES) as Outcome[])
    .map((key) => {
      const outcome = OUTCOMES[key]
      return `<span class="legend-item"><span class="key ${outcome.role}"></span>
      <span class="glyph">${outcome.glyph}</span> ${outcome.label} <span class="muted">— ${outcome.about}</span></span>`
    })
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>rulecast stress</title>
<style>
  :root {
    color-scheme: light;
    --surface: #fcfcfb;
    --plane: #f9f9f7;
    --raise: #ffffff;
    --rule: #e3e3df;
    --grid: #e1e0d9;
    --ink: #0b0b0b;
    --ink-2: #52514e;
    --ink-3: #898781;
    --good: #0ca30c;
    --warn: #fab219;
    --serious: #ec835a;
    --critical: #d03b3b;
    --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface: #1a1a19;
      --plane: #0d0d0d;
      --raise: #232322;
      --rule: #34342f;
      --grid: #2c2c2a;
      --ink: #ffffff;
      --ink-2: #c3c2b7;
      --ink-3: #898781;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface: #1a1a19;
    --plane: #0d0d0d;
    --raise: #232322;
    --rule: #34342f;
    --grid: #2c2c2a;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --ink-3: #898781;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--plane); color: var(--ink);
    font-family: var(--sans); font-size: 15px; line-height: 1.55;
  }
  main { max-width: 1040px; margin: 0 auto; padding: 2.2rem 1rem 4rem; display: grid; gap: 2rem; }
  h1 { font-family: var(--mono); font-size: 1.45rem; letter-spacing: -0.02em; margin: 0; }
  h2 { font-family: var(--mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em;
       color: var(--ink-3); font-weight: 500; margin: 0 0 0.9rem; }
  p { margin: 0.5rem 0 0; }
  header { display: grid; gap: 0.45rem; border-bottom: 1px solid var(--rule); padding-bottom: 1.3rem; }
  .meta { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-3);
          display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }
  .lede { color: var(--ink-2); max-width: 64ch; }

  .hero { display: grid; gap: 0.3rem; }
  .hero-n { font-family: var(--mono); font-size: clamp(2.4rem, 7vw, 3.4rem); line-height: 1;
            letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .hero-n .unit { font-size: 0.3em; color: var(--ink-3); letter-spacing: 0.06em; text-transform: uppercase; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr));
           gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .tile { background: var(--raise); padding: 0.8rem 0.95rem; display: grid; gap: 0.2rem; }
  .tile-k { font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase;
            letter-spacing: 0.08em; color: var(--ink-3); }
  .tile-v { font-family: var(--mono); font-size: 1.32rem; font-variant-numeric: tabular-nums;
            display: flex; align-items: baseline; gap: 0.35rem; }

  figure { margin: 0; background: var(--surface); border: 1px solid var(--rule); padding: 1rem 1.1rem 0.7rem; }
  figcaption { font-family: var(--mono); font-size: 0.86rem; margin-bottom: 0.15rem; }
  .sub { font-size: 0.78rem; color: var(--ink-3); line-height: 1.4; margin: 0 0 0.9rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.3rem 1.3rem; font-size: 0.8rem;
            color: var(--ink-2); margin-bottom: 1rem; }
  .legend-item { display: flex; align-items: center; gap: 0.35rem; }
  .key { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .glyph { font-family: var(--mono); font-weight: 700; }
  .muted { color: var(--ink-3); }

  .key.good, .bar.good { background: var(--good); fill: var(--good); }
  .key.warn, .bar.warn { background: var(--warn); fill: var(--warn); }
  .key.serious, .bar.serious { background: var(--serious); fill: var(--serious); }
  .key.critical, .bar.critical { background: var(--critical); fill: var(--critical); }
  svg .grid { stroke: var(--grid); stroke-width: 1; }
  svg .axis { stroke: var(--rule); stroke-width: 1; }
  svg text { font-family: var(--mono); fill: var(--ink-2); }
  svg .name { font-size: 11px; }
  svg .sublabel { font-size: 9.5px; fill: var(--ink-3); }
  svg .grid.limit { stroke: var(--ink-3); stroke-dasharray: 3 3; }
  svg .value { font-size: 11px; fill: var(--ink-3); }
  svg .tick { font-size: 10px; fill: var(--ink-3); }

  table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
  caption { text-align: left; font-size: 0.78rem; color: var(--ink-3); padding-bottom: 0.6rem; }
  th, td { text-align: left; vertical-align: top; padding: 0.65rem 0.7rem; border-top: 1px solid var(--rule); }
  thead th { font-family: var(--mono); font-size: 0.68rem; text-transform: uppercase;
             letter-spacing: 0.07em; color: var(--ink-3); font-weight: 500; border-top: 0; }
  tbody th { font-family: var(--mono); font-weight: 600; white-space: nowrap; }
  .about { display: block; font-family: var(--sans); font-weight: 400; font-size: 0.78rem;
           color: var(--ink-3); white-space: normal; max-width: 30ch; margin-top: 0.15rem; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .detail { display: block; font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); font-weight: 400; }
  .pill { display: inline-flex; align-items: center; gap: 0.3rem; font-family: var(--mono);
          font-size: 0.72rem; padding: 0.1rem 0.45rem; border-radius: 3px; color: #0b0b0b; white-space: nowrap; }
  .pill.good { background: var(--good); color: #fff; }
  .pill.warn { background: var(--warn); }
  .pill.serious { background: var(--serious); }
  .pill.critical { background: var(--critical); color: #fff; }
  ul.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  ul.checks li { display: flex; gap: 0.4rem; }
  li.held .glyph { color: var(--good); }
  li.broke .glyph { color: var(--critical); }
  li.broke { color: var(--ink); font-weight: 500; }
  .metrics { display: flex; flex-wrap: wrap; gap: 0.2rem 0.9rem; margin: 0.55rem 0 0;
             font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
  .metrics div { display: flex; gap: 0.3rem; }
  .metrics dt::after { content: ":"; }
  .metrics dd { margin: 0; color: var(--ink-2); }
  .error { font-family: var(--mono); font-size: 0.74rem; color: var(--critical); }
  .note { font-size: 0.78rem; color: var(--ink-3); }
</style>
</head>
<body>
<main>
  <header>
    <h1>rulecast stress</h1>
    <p class="lede">Loads nobody designed rulecast for: large repositories, hostile input, parallel
      hooks on one session, and long agent sessions. Each scenario runs in its own process under a
      watchdog, so a run that wedges is a result rather than a wedged harness.</p>
    <div class="meta">
      <span>${html(generated.toISOString())}</span>
      <span>${results.length} scenarios</span>
      <span>${driven.length} of ${TARGETS.length} targets</span>
      <span>${ms(wall)} wall clock</span>
    </div>
  </header>

  <section class="hero">
    <div class="hero-n">${found} <span class="unit">of ${results.length} found something</span></div>
    <p class="lede">A scenario “finds something” when it hangs, crashes, or completes with a check
      that did not hold. The numbers below are this machine’s, under whatever load it was carrying.</p>
  </section>

  <section>
    <h2>Outcomes</h2>
    <div class="legend">${legend}</div>
    <div class="tiles">
      ${(Object.keys(OUTCOMES) as Outcome[])
        .map(
          (key) => `<div class="tile">
        <span class="tile-k">${OUTCOMES[key].label}</span>
        <span class="tile-v"><span class="glyph" style="color: var(--${OUTCOMES[key].role})">${
          OUTCOMES[key].glyph
        }</span>${counts[key]}</span>
      </div>`,
        )
        .join("")}
    </div>
  </section>

  <figure>
    <figcaption>What each measured check used of its ceiling</figcaption>
    <p class="sub">Every check with a numeric limit, as a share of that limit. 100% is the ceiling,
      so a bar past it is the finding. A scenario that hung has no bar here — it never got far
      enough to measure anything, which is what the table and the outcome counts above are for.</p>
    <div class="legend">
      <span class="legend-item"><span class="key good"></span><span class="glyph">✓</span> within its limit</span>
      <span class="legend-item"><span class="key critical"></span><span class="glyph">!</span> over its limit</span>
    </div>
    ${headroomChart(measuredChecks(results))}
  </figure>

  <section>
    <h2>Every scenario</h2>
    <table>
      <caption>The same results as the chart, with each scenario’s checks and measurements.</caption>
      <thead>
        <tr><th scope="col">Scenario</th><th scope="col">Target</th><th scope="col">Outcome</th>
        <th scope="col">Elapsed</th><th scope="col">Checks and measurements</th></tr>
      </thead>
      <tbody>${tableRows(results)}</tbody>
    </table>
  </section>
</main>
</body>
</html>
`
}
