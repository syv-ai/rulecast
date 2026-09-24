import type { Measurement } from "../perf-fixture"
import { CHARS_PER_TOKEN, type ScenarioResult, tokens } from "./measure"

/**
 * The benchmark's HTML report: one self-contained page, no network, both themes.
 *
 * Charts are inline SVG generated here rather than drawn by a library in the browser, so the page
 * renders identically wherever it is opened and the numbers in it are the numbers that were
 * measured. The hover layer is the only script.
 *
 * Palette: slots 1 and 2 of the reference categorical palette, validated in both modes
 * (worst adjacent CVD ΔE 24.7 light / 26.8 dark; normal-vision 33.6 / 31.8; all six checks pass).
 */

const html = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const comma = (value: number): string => Math.round(value).toLocaleString("en-US")

/** A round axis maximum at or above `value`: 1, 2 or 5 × a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (magnitude * step >= value) return magnitude * step
  }
  return magnitude * 10
}

interface Plot {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

const PLOT: Plot = { width: 352, height: 186, left: 44, right: 52, top: 16, bottom: 30 }

/** Delivered tokens per turn, one small multiple per scenario. The shape is the finding. */
function perTurnChart(result: ScenarioResult): string {
  const withMemory = result.withMemory.steps.map((step) => tokens(step.deliveredChars))
  const without = result.withoutMemory.steps.map((step) => tokens(step.deliveredChars))
  const max = niceMax(Math.max(...withMemory, ...without, 1))
  const innerWidth = PLOT.width - PLOT.left - PLOT.right
  const innerHeight = PLOT.height - PLOT.top - PLOT.bottom
  const count = Math.max(withMemory.length, 2)
  const x = (index: number) => PLOT.left + (index / (count - 1)) * innerWidth
  const y = (value: number) => PLOT.top + innerHeight - (value / max) * innerHeight
  const line = (series: number[]) =>
    series.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ")

  const ticks = [0, max / 2, max]
  const grid = ticks
    .map(
      (tick) =>
        `<line class="grid" x1="${PLOT.left}" y1="${y(tick).toFixed(1)}" x2="${PLOT.left + innerWidth}" y2="${y(tick).toFixed(1)}"/>` +
        `<text class="tick" x="${PLOT.left - 8}" y="${(y(tick) + 3.5).toFixed(1)}" text-anchor="end">${comma(tick)}</text>`,
    )
    .join("")

  const dots = (series: number[], cls: string) =>
    series
      .map(
        (value, index) =>
          `<circle class="dot ${cls}" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" data-turn="${index + 1}" data-series="${cls === "s1" ? "without session memory" : "rulecast"}" data-value="${comma(value)}" data-label="${html(result.withMemory.steps[index]?.label ?? "")}"/>`,
      )
      .join("")

  // Direct labels on the two endpoints, nudged apart when the series converge. A label that
  // collides with its neighbour is worse than no label, and both carry the story's last value.
  const lastIndex = withMemory.length - 1
  const endWithout = without[lastIndex] ?? 0
  const endWith = withMemory[lastIndex] ?? 0
  let yWithout = y(endWithout)
  let yWith = y(endWith)
  const MIN_GAP = 12
  if (Math.abs(yWithout - yWith) < MIN_GAP) {
    const middle = (yWithout + yWith) / 2
    const above = endWithout >= endWith
    yWithout = middle + (above ? -MIN_GAP / 2 : MIN_GAP / 2)
    yWith = middle + (above ? MIN_GAP / 2 : -MIN_GAP / 2)
  }
  const endLabel = (value: number, atY: number, cls: string) =>
    `<text class="end ${cls}" x="${(x(lastIndex) + 9).toFixed(1)}" y="${(atY + 3.5).toFixed(1)}">${comma(value)}</text>`

  return `
<figure class="chart">
  <figcaption>
    <span class="chart-title">${html(result.name)}</span>
    <span class="chart-sub">${html(result.about)}</span>
  </figcaption>
  <svg viewBox="0 0 ${PLOT.width} ${PLOT.height}" role="img" aria-label="Tokens delivered per turn for ${html(result.name)}: without session memory against rulecast. The table below carries every value.">
    ${grid}
    <line class="axis" x1="${PLOT.left}" y1="${PLOT.top + innerHeight}" x2="${PLOT.left + innerWidth}" y2="${PLOT.top + innerHeight}"/>
    <path class="line s1" d="${line(without)}"/>
    <path class="line s2" d="${line(withMemory)}"/>
    ${dots(without, "s1")}
    ${dots(withMemory, "s2")}
    ${endLabel(endWithout, yWithout, "s1")}
    ${endLabel(endWith, yWith, "s2")}
    <text class="tick" x="${PLOT.left}" y="${PLOT.height - 10}">turn 1</text>
    <text class="tick" x="${(PLOT.left + innerWidth).toFixed(1)}" y="${PLOT.height - 10}" text-anchor="end">turn ${withMemory.length}</text>
  </svg>
</figure>`
}

/** Total delivered per scenario, the two runs side by side. */
function totalsChart(results: ScenarioResult[]): string {
  const rowHeight = 52
  const barHeight = 18
  const left = 150
  const right = 74
  const width = 720
  const height = results.length * rowHeight + 18
  const innerWidth = width - left - right
  const max = niceMax(Math.max(...results.map((one) => tokens(one.withoutMemory.totalDeliveredChars))))

  const rows = results
    .map((result, index) => {
      const top = index * rowHeight + 8
      const without = tokens(result.withoutMemory.totalDeliveredChars)
      const withMemory = tokens(result.withMemory.totalDeliveredChars)
      const scale = (value: number) => (value / max) * innerWidth
      // 2px surface gap between the two touching bars, per the mark spec.
      return `
    <text class="row-label" x="${left - 12}" y="${top + barHeight}" text-anchor="end">${html(result.name)}</text>
    <rect class="bar s1" x="${left}" y="${top}" width="${scale(without).toFixed(1)}" height="${barHeight}" rx="4"
      data-series="without session memory" data-label="${html(result.name)}" data-value="${comma(without)}"/>
    <rect class="bar s2" x="${left}" y="${top + barHeight + 2}" width="${scale(withMemory).toFixed(1)}" height="${barHeight}" rx="4"
      data-series="rulecast" data-label="${html(result.name)}" data-value="${comma(withMemory)}"/>
    <text class="bar-value" x="${(left + scale(without) + 8).toFixed(1)}" y="${top + 13}">${comma(without)}</text>
    <text class="bar-value" x="${(left + scale(withMemory) + 8).toFixed(1)}" y="${top + barHeight + 15}">${comma(withMemory)} <tspan class="saved">−${result.savedPercent}%</tspan></text>`
    })
    .join("")

  return `
<figure class="chart wide">
  <figcaption>
    <span class="chart-title">Tokens delivered over the whole session</span>
    <span class="chart-sub">Every rule, finding and convention rulecast put in front of the agent.</span>
  </figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Total tokens delivered per scenario, without session memory against rulecast. The table below carries every value.">
    ${rows}
  </svg>
</figure>`
}

/** Where a single event's time goes, by event kind. One series, so no legend. */
function timingChart(results: ScenarioResult[]): string {
  const perKind = new Map<string, { total: number; count: number }>()
  for (const result of results) {
    for (const step of result.withMemory.steps) {
      const entry = perKind.get(step.kind) ?? { total: 0, count: 0 }
      entry.count++
      perKind.set(step.kind, entry)
    }
    for (const [kind, ms] of Object.entries(result.wallClock.perKind)) {
      const entry = perKind.get(kind) ?? { total: 0, count: 0 }
      entry.total += ms
      perKind.set(kind, entry)
    }
  }
  const rows = [...perKind.entries()]
    .map(([kind, entry]) => ({ kind, mean: entry.count === 0 ? 0 : entry.total / entry.count }))
    .sort((a, b) => b.mean - a.mean)
  const max = niceMax(Math.max(...rows.map((row) => row.mean), 1))
  const left = 92
  const right = 78
  const width = 720
  const rowHeight = 30
  const height = rows.length * rowHeight + 10

  const bars = rows
    .map((row, index) => {
      const top = index * rowHeight + 6
      const barWidth = (row.mean / max) * (width - left - right)
      return `
    <text class="row-label" x="${left - 12}" y="${top + 14}" text-anchor="end">${html(row.kind)}</text>
    <rect class="bar s2" x="${left}" y="${top}" width="${Math.max(barWidth, 1).toFixed(1)}" height="18" rx="4"
      data-series="mean time in process" data-label="${html(row.kind)} event" data-value="${row.mean.toFixed(1)} ms"/>
    <text class="bar-value" x="${(left + Math.max(barWidth, 1) + 8).toFixed(1)}" y="${top + 13}">${row.mean.toFixed(1)} ms</text>`
    })
    .join("")

  return `
<figure class="chart wide">
  <figcaption>
    <span class="chart-title">Time inside one event</span>
    <span class="chart-sub">Mean, in process. Node start-up and config compile are on top of this — see the end-to-end figure.</span>
  </figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mean in-process time per event kind. The table below carries every value.">${bars}</svg>
</figure>`
}

function operationsTable(results: ScenarioResult[]): string {
  const rows = results
    .map(
      (result) => `
      <tr>
        <td class="name">${html(result.name)}</td>
        <td>${result.steps}</td>
        <td>${result.withMemory.proactive}</td>
        <td>${result.withMemory.corrective}</td>
        <td>${result.withMemory.blocks}</td>
        <td>${result.withMemory.refusals}</td>
      </tr>`,
    )
    .join("")
  return `
<table class="grid">
  <caption>What rulecast asked of the agent</caption>
  <thead>
    <tr>
      <th scope="col">Scenario</th>
      <th scope="col">Turns</th>
      <th scope="col" title="Conventions arrived with nothing to correct">Preventive</th>
      <th scope="col" title="A delivery carrying findings">Corrective</th>
      <th scope="col" title="Stop-gate blocks: extra turns before the agent may finish">Turns forced</th>
      <th scope="col" title="Writes refused before they landed">Writes refused</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`
}

function dataTable(results: ScenarioResult[]): string {
  const rows = results
    .map(
      (result) => `
      <tr>
        <td class="name">${html(result.name)}</td>
        <td>${result.steps}</td>
        <td>${comma(tokens(result.withoutMemory.totalDeliveredChars))}</td>
        <td>${comma(tokens(result.withMemory.totalDeliveredChars))}</td>
        <td class="pos">${comma(result.savedTokens)}</td>
        <td>${result.savedPercent}%</td>
        <td>${result.wallClock.p50.toFixed(1)}</td>
        <td>${result.wallClock.p95.toFixed(1)}</td>
      </tr>`,
    )
    .join("")
  return `
<table class="grid">
  <caption>Every measured value</caption>
  <thead>
    <tr>
      <th scope="col">Scenario</th>
      <th scope="col">Turns</th>
      <th scope="col">Tokens, no session memory</th>
      <th scope="col">Tokens, rulecast</th>
      <th scope="col">Not re-sent</th>
      <th scope="col">Share</th>
      <th scope="col">p50 ms</th>
      <th scope="col">p95 ms</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`
}

/**
 * The page's own content: title, styles, body and hover script, with no document skeleton.
 * `renderReport` wraps it for a file on disk; a host that supplies its own skeleton — publishing
 * the same report as a shareable page — takes this instead, so both render from one source.
 */
export function reportBody(results: ScenarioResult[], hook: (Measurement & { budgetMs: number }) | null): string {
  const savedTokens = results.reduce((sum, one) => sum + one.savedTokens, 0)
  const withoutTotal = results.reduce((sum, one) => sum + tokens(one.withoutMemory.totalDeliveredChars), 0)
  const sharePercent = withoutTotal === 0 ? 0 : Math.round((savedTokens / withoutTotal) * 100)
  const turns = results.reduce((sum, one) => sum + one.steps, 0)
  const p50 = results.map((one) => one.wallClock.p50).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? 0
  const blocks = results.reduce((sum, one) => sum + one.withMemory.blocks, 0)
  const refusals = results.reduce((sum, one) => sum + one.withMemory.refusals, 0)

  const hookTile =
    hook === null
      ? `<div class="tile"><span class="tile-k">End to end</span><span class="tile-v">—</span><span class="tile-n">Run <code>pnpm bench --hook</code> for the spawned-CLI figure.</span></div>`
      : `<div class="tile"><span class="tile-k">End to end, p95</span><span class="tile-v">${hook.p95.toFixed(0)} <span class="unit">ms</span></span><span class="tile-n">${hook.rules} rules, ${hook.events} events, budget ${hook.budgetMs} ms.</span></div>`

  return `<title>rulecast benchmark</title>
<style>
  :root {
    color-scheme: light;
    --surface: #fcfcfb;
    --raise: #ffffff;
    --rule: #e3e3df;
    --ink: #0b0b0b;
    --ink-2: #52514e;
    --ink-3: #78776f;
    --s1: #2a78d6;
    --s2: #eb6834;
    --pos: #0f7a4f;
    --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface: #1a1a19;
      --raise: #232322;
      --rule: #34342f;
      --ink: #ffffff;
      --ink-2: #c3c2b7;
      --ink-3: #91908a;
      --s1: #3987e5;
      --s2: #d95926;
      --pos: #4bb383;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface: #1a1a19;
    --raise: #232322;
    --rule: #34342f;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --ink-3: #91908a;
    --s1: #3987e5;
    --s2: #d95926;
    --pos: #4bb383;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--surface); color: var(--ink);
    font-family: var(--sans); font-size: 15px; line-height: 1.55;
    padding-block: 2.5rem 4rem; padding-left: 16px; padding-right: 16px;
  }
  .wrap { max-width: 62rem; margin: 0 auto; display: grid; gap: 2.2rem; }
  h1 { font-family: var(--mono); font-size: 1.45rem; letter-spacing: -0.02em; margin: 0; }
  h2 { font-family: var(--mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); font-weight: 500; margin: 0 0 0.9rem; }
  p { margin: 0; }
  code { font-family: var(--mono); font-size: 0.86em; }
  header { display: grid; gap: 0.45rem; border-bottom: 1px solid var(--rule); padding-bottom: 1.3rem; }
  .meta { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-3); display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }

  .hero { display: grid; grid-template-columns: minmax(230px, 1fr) 2fr; gap: 1.6rem; align-items: center; }
  .hero-n { font-family: var(--mono); font-size: clamp(2.6rem, 8vw, 3.9rem); line-height: 1; letter-spacing: -0.03em; color: var(--pos); font-variant-numeric: tabular-nums; }
  .hero-n .unit { font-size: 0.32em; color: var(--ink-3); letter-spacing: 0.06em; text-transform: uppercase; }
  .hero-k { font-family: var(--mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--ink-3); }
  .hero p { color: var(--ink-2); font-size: 0.95rem; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .tile { background: var(--raise); padding: 0.8rem 0.95rem; display: grid; gap: 0.2rem; }
  .tile-k { font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
  .tile-v { font-family: var(--mono); font-size: 1.32rem; font-variant-numeric: tabular-nums; }
  .tile-v .unit { font-size: 0.6em; color: var(--ink-3); }
  .tile-n { font-size: 0.76rem; color: var(--ink-3); line-height: 1.4; }

  .legend { display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; font-size: 0.82rem; color: var(--ink-2); margin-bottom: 1rem; }
  .legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
  .key { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
  .key.s1 { background: var(--s1); }
  .key.s2 { background: var(--s2); }

  .grid-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 1.3rem; }
  .chart { margin: 0; background: var(--raise); border: 1px solid var(--rule); padding: 0.9rem 1rem 0.6rem; overflow-x: auto; }
  .chart.wide { grid-column: 1 / -1; }
  figcaption { display: grid; gap: 0.15rem; margin-bottom: 0.5rem; }
  .chart-title { font-family: var(--mono); font-size: 0.86rem; }
  .chart-sub { font-size: 0.78rem; color: var(--ink-3); line-height: 1.4; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }

  .grid line.grid { stroke: var(--rule); stroke-width: 1; }
  svg .grid { stroke: var(--rule); stroke-width: 1; }
  svg .axis { stroke: var(--rule); stroke-width: 1; }
  svg .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  svg .line.s1 { stroke: var(--s1); }
  svg .line.s2 { stroke: var(--s2); }
  svg .dot { stroke: var(--raise); stroke-width: 2; }
  svg .dot.s1 { fill: var(--s1); }
  svg .dot.s2 { fill: var(--s2); }
  svg .bar.s1 { fill: var(--s1); }
  svg .bar.s2 { fill: var(--s2); }
  svg .tick, svg .row-label, svg .bar-value, svg .end {
    font-family: var(--mono); font-size: 10px; fill: var(--ink-3); font-variant-numeric: tabular-nums;
  }
  svg .row-label, svg .bar-value { font-size: 11px; fill: var(--ink-2); }
  svg .end { font-size: 10.5px; fill: var(--ink-2); }
  svg .saved { fill: var(--pos); }

  table.grid { border-collapse: collapse; width: 100%; font-size: 0.83rem; font-variant-numeric: tabular-nums; }
  table.grid caption { text-align: left; font-family: var(--mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); padding-bottom: 0.6rem; }
  table.grid th, table.grid td { border: 1px solid var(--rule); padding: 0.4rem 0.6rem; text-align: right; }
  table.grid th { color: var(--ink-3); font-weight: 500; text-align: right; }
  table.grid th:first-child, table.grid td.name { text-align: left; font-family: var(--mono); }
  table.grid td.pos { color: var(--pos); }
  .scroller { overflow-x: auto; }

  #tip {
    position: fixed; pointer-events: none; opacity: 0; transition: opacity 90ms;
    background: var(--ink); color: var(--surface); font-family: var(--mono); font-size: 11px;
    padding: 0.35rem 0.5rem; border-radius: 3px; max-width: 250px; z-index: 9; line-height: 1.45;
  }
  @media (prefers-reduced-motion: reduce) { #tip { transition: none; } }
  @media (max-width: 680px) { .hero { grid-template-columns: 1fr; } }
</style>
<!--SPLIT-->
<div class="wrap">
  <header>
    <h1>rulecast benchmark</h1>
    <div class="meta">
      <span>${new Date().toISOString().slice(0, 10)}</span>
      <span>${results.length} scenarios · ${turns} turns</span>
      <span>tokens = characters ÷ ${CHARS_PER_TOKEN}</span>
      <span>budget 9,000 chars (Claude Code)</span>
    </div>
  </header>

  <section class="hero">
    <div>
      <div class="hero-k">Not re-sent to the agent</div>
      <div class="hero-n">${comma(savedTokens)} <span class="unit">tokens</span></div>
    </div>
    <p>
      Every scenario runs twice over identical files: once as rulecast runs it, and once with a fresh
      session for every event so nothing is remembered. The difference is what session memory kept out
      of the agent's context window — <strong>${sharePercent}%</strong> of everything that would otherwise
      have been sent.
    </p>
  </section>

  <section>
    <h2>At a glance</h2>
    <div class="tiles">
      <div class="tile"><span class="tile-k">Median event</span><span class="tile-v">${p50.toFixed(1)} <span class="unit">ms</span></span><span class="tile-n">rulecast's own work, in process.</span></div>
      ${hookTile}
      <div class="tile"><span class="tile-k">Turns forced</span><span class="tile-v">${blocks}</span><span class="tile-n">Stop-gate blocks: extra rounds before the agent could finish.</span></div>
      <div class="tile"><span class="tile-k">Writes refused</span><span class="tile-v">${refusals}</span><span class="tile-n">Violations stopped in the tool call, never written to disk.</span></div>
    </div>
  </section>

  <section>
    <h2>Per turn</h2>
    <div class="legend">
      <span><i class="key s1"></i> without session memory</span>
      <span><i class="key s2"></i> rulecast</span>
    </div>
    <div class="grid-charts">
      ${results.map(perTurnChart).join("")}
    </div>
  </section>

  <section>
    <h2>Totals and time</h2>
    <div class="legend">
      <span><i class="key s1"></i> without session memory</span>
      <span><i class="key s2"></i> rulecast</span>
    </div>
    <div class="grid-charts">
      ${totalsChart(results)}
      ${timingChart(results)}
    </div>
  </section>

  <section>
    <h2>Agent operations</h2>
    <div class="scroller">${operationsTable(results)}</div>
  </section>

  <section>
    <h2>Table view</h2>
    <div class="scroller">${dataTable(results)}</div>
  </section>
</div>
<div id="tip" role="status" aria-live="polite"></div>
<script>
  const tip = document.getElementById("tip")
  const show = (event) => {
    const mark = event.target
    const series = mark.getAttribute("data-series")
    if (series === null) return
    const label = mark.getAttribute("data-label")
    const turn = mark.getAttribute("data-turn")
    const value = mark.getAttribute("data-value")
    tip.textContent = [turn ? "turn " + turn : null, label, series + ": " + value].filter(Boolean).join(" · ")
    tip.style.opacity = "1"
    const box = mark.getBoundingClientRect()
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, box.left) + "px"
    tip.style.top = Math.max(8, box.top - tip.offsetHeight - 8) + "px"
  }
  const hide = () => { tip.style.opacity = "0" }
  for (const mark of document.querySelectorAll("[data-series]")) {
    mark.addEventListener("mouseenter", show)
    mark.addEventListener("mouseleave", hide)
  }
  document.addEventListener("scroll", hide, { passive: true })
</script>
`
}

/** Title and styles, then the markup and its hover script. */
function split(results: ScenarioResult[], hook: (Measurement & { budgetMs: number }) | null): [string, string] {
  const [head = "", markup = ""] = reportBody(results, hook).split("<!--SPLIT-->")
  return [head.trim(), markup.trim()]
}

/** The report as a standalone file, for `pnpm bench` to write to disk. */
export function renderReport(results: ScenarioResult[], hook: (Measurement & { budgetMs: number }) | null): string {
  const [head, markup] = split(results, hook)
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    head,
    "</head>",
    "<body>",
    markup,
    "</body>",
    "</html>",
    "",
  ].join("\n")
}

/** The same report for a host that supplies its own document skeleton. */
export function renderReportFragment(
  results: ScenarioResult[],
  hook: (Measurement & { budgetMs: number }) | null,
): string {
  return `${split(results, hook).join("\n")}\n`
}
