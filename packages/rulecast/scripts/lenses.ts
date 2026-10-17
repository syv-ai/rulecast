import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "yaml"

/**
 * The lens catalog (packages/lenses) as pages coding agents read at a pinned tag: agents/lenses/.
 * The YAML is the source; the pages are committed and checked like the manifest, so a tag always
 * carries the pages that match its catalog. The catalog is validated first: a broken catalog
 * writes nothing.
 */

export const AXES = ["security", "reliability", "change_cost", "delivery", "runtime", "operability"] as const

const AXIS_MEANS: Record<(typeof AXES)[number], string> = {
  security: "what an attacker, a leaked secret or a compromised dependency can do",
  reliability: "whether it keeps working and fails visibly when it doesn't",
  change_cost: "what the next change costs, including how easy it is to test",
  delivery: "how fast the team ships now",
  runtime: "speed and resource use when it runs",
  operability: "what it takes to run, observe and debug it in production",
}

const FILES = [
  ["principles", "Principles"],
  ["practices", "Practices"],
  ["laws", "Laws"],
  ["patterns", "Design patterns"],
  ["antipatterns", "Anti-patterns"],
  ["smells", "Smells"],
] as const

const FAMILY_FILE: Record<string, string> = {
  principle: "principles",
  practice: "practices",
  law: "laws",
  pattern: "patterns",
  "anti-pattern": "antipatterns",
  smell: "smells",
}

export const KINDS: Record<string, string> = {
  "cli-devtool": "CLIs and developer tools",
  tui: "Terminal UIs",
  "library-sdk": "Libraries and SDKs",
  "web-api": "Web APIs and backend services",
  "web-frontend": "Web front ends",
  "fullstack-web": "Full-stack web apps",
  mobile: "Mobile apps",
  desktop: "Desktop apps",
  "data-pipeline": "Data pipelines",
  "ml-training": "Machine-learning training",
  distributed: "Distributed systems",
  "event-driven": "Event-driven workers",
  serverless: "Serverless functions",
  iac: "Infrastructure as code",
  embedded: "Embedded and firmware",
  games: "Games",
  "plugins-extensions": "Plugins and extensions",
  "plugin-host": "Plugin hosts",
  "compilers-tooling": "Compilers and language tooling",
  "databases-storage": "Databases and storage",
  scientific: "Scientific computing",
  platforms: "Platforms",
}

const LANGS: Record<string, string> = {
  python: "py",
  typescript: "ts",
  javascript: "js",
  java: "java",
  csharp: "cs",
  go: "go",
  rust: "rs",
  c: "c",
  cpp: "cpp",
  iac: "iac",
}

const HOW = ["read", "recalled", "developer"]
// Named codebases must not appear as verdicts or examples: the catalog judges code by its forces, not by name.
const CODEBASES = /petclinic|eshop|fastapi('s)? (full-stack )?template|\bglow\b|mdbook|rulecast/i
// Authoring residue: instructions to an editor that ended up as content.
const RESIDUE =
  /\b(replace (this|that) (line|field|with)|strip the trailing|change this to|todo:|\[object object\])|"fix:/i
const EDITOR_TELL =
  /(^|[.:;]\s+)(drop|keep only|replace|leave out)\b|\b(should be dropped|do not flag|don't flag|don't use it)\b/i

type Sign = "+" | "++" | "-"
export interface Source {
  cite: string
  url?: string | null
  how: string
}
export interface Axes {
  signs?: Record<string, Sign>
  why?: Record<string, string> | string
  flips?: string
  bears_on?: string[]
}
export interface Lens {
  id: string
  name: string
  family: string
  group?: string
  says: string
  names?: string
  counter: string
  axes?: Axes
  applies_to?: { kinds?: string[]; languages?: string[] }
  contested?: boolean
  agent_prone?: boolean
  matters_most_for?: string[]
  looks_like?: string[]
  forces?: string[]
  overuse?: string[]
  remedy?: string
  in?: Record<string, string>
  related?: string[]
  tell?: string
  interview_only?: boolean
  example?: { before: string; after: string; note?: string }
  example_reason?: string
  sources?: Source[]
}
export interface Probe {
  find: string
  ask: string
  settled_when: string
  grounded_in?: string[]
}
export interface Starter {
  hinge: string
  lenses: string[]
  probes?: Probe[]
}
export interface Stance {
  id: string
  stance: string
  ask?: string
  but: string
  grounded_in: string[]
  lenses?: string[]
  method?: boolean
  sources?: Source[]
}
export interface Methodology {
  id: string
  name: string
  frames?: string
  fits?: string
  signals?: string[]
  asks?: string[]
  lenses_first?: string[]
  stances_first?: string[]
  pairs_with?: string[]
}
export interface Catalog {
  entries: Lens[]
  starters: Record<string, Starter>
  thinking: Stance[]
  methodologies: Methodology[]
  overlaps: { ids: string[]; pick: string }[]
  grounds: { name: string; sources?: Source[] }[]
  /** The comment that opens methodologies.yaml: how to pick one. */
  methodologiesIntro?: string
}

async function yamlFile<T>(dir: string, name: string, empty: T): Promise<{ data: T; text: string }> {
  const text = await readFile(path.join(dir, `${name}.yaml`), "utf8").catch(() => null)
  return text === null ? { data: empty, text: "" } : { data: (parse(text) as T) ?? empty, text }
}

export async function loadCatalog(dir: string): Promise<Catalog> {
  const entries: Lens[] = []
  for (const [file] of FILES) entries.push(...(await yamlFile<Lens[]>(dir, file, [])).data)
  const methodologies = await yamlFile<Methodology[]>(dir, "methodologies", [])
  return {
    entries,
    starters: (await yamlFile<Record<string, Starter>>(dir, "starters", {})).data,
    thinking: (await yamlFile<Stance[]>(dir, "thinking", [])).data,
    methodologies: methodologies.data,
    overlaps: (await yamlFile<Catalog["overlaps"]>(dir, "overlaps", [])).data,
    grounds: (await yamlFile<Catalog["grounds"]>(dir, "grounds", [])).data,
    methodologiesIntro: methodologies.text
      .split("\n")
      .filter((l) => l.startsWith("#"))
      .map((l) => l.replace(/^#\s?/, ""))
      .join(" ")
      .replace(/^rulecast lens catalog: methodologies\.\s*/, "")
      .replace(/\s+Rewritten after.*?(?=Before any methodology)/, " ")
      .trim(),
  }
}

const isNegative = (e: Lens) => e.family === "anti-pattern" || e.family === "smell"

/** Everything wrong with the catalog, one line each; empty when it is sound. */
export function catalogProblems(c: Catalog): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const no = (e: Lens, m: string) => problems.push(`${FAMILY_FILE[e.family] ?? e.family}:${e.id}: ${m}`)
  for (const e of c.entries) {
    if (ids.has(e.id)) no(e, "duplicate id")
    ids.add(e.id)
  }
  for (const e of c.entries) {
    for (const k of ["id", "name", "family", "says", "counter"] as const) if (!e[k]) no(e, `missing ${k}`)
    if (!FAMILY_FILE[e.family]) no(e, `family ${e.family}`)
    for (const s of e.sources ?? []) if (!HOW.includes(s.how)) no(e, `source how ${s.how}`)
    if (!(e.sources ?? []).length) no(e, "no sources")
    for (const k of e.matters_most_for ?? []) if (!KINDS[k]) no(e, `kind ${k}`)
    for (const k of Object.keys(e.in ?? {})) if (!LANGS[k]) no(e, `in.${k}`)
    for (const r of e.related ?? []) if (!ids.has(r)) no(e, `related ${r} missing`)
    for (const k of ["looks_like", "forces", "overuse", "related", "matters_most_for"] as const) {
      const v = e[k]
      if (v == null) continue
      if (!Array.isArray(v)) no(e, `${k} is not a list`)
      else for (const [i, x] of v.entries()) if (typeof x !== "string") no(e, `${k}[${i}] is not text`)
    }
    if (e.example) {
      for (const k of Object.keys(e.example)) if (!["before", "after", "note"].includes(k)) no(e, `example key ${k}`)
      for (const k of ["before", "after"] as const) {
        const n = String(e.example[k] ?? "")
          .trimEnd()
          .split("\n").length
        if (n < 4 || n > 15) no(e, `example.${k} is ${n} lines`)
      }
    }
    const text = JSON.stringify(e)
    if (CODEBASES.test(text)) no(e, "names a specific codebase")
    const residue = text.match(RESIDUE)
    if (residue) no(e, `authoring residue: ${residue[0]}`)
    const editor = e.tell?.match(EDITOR_TELL)
    if (editor) no(e, `tell addresses an editor: ${editor[0]}`)
    // A restriction must not hide the lens from a kind it matters most for.
    const only = e.applies_to?.kinds ?? []
    if (only.length)
      for (const k of e.matters_most_for ?? [])
        if (!only.includes(k)) no(e, `applies_to excludes ${k}, which matters_most_for lists`)
    if (typeof e.names === "string" && /\.\s*\.(\s|$)/.test(e.names)) no(e, "stray '. .' in names")
    // No interview-only lenses: their substance lives in thinking.yaml and the starters' probes.
    if (e.interview_only) no(e, "interview_only lenses were dissolved into thinking.yaml")
    axesProblems(e, (m) => no(e, m))
  }

  const stanceIds = new Set<string>()
  for (const t of c.thinking) {
    const w = (m: string) => problems.push(`thinking:${t.id}: ${m}`)
    if (stanceIds.has(t.id)) w("duplicate id")
    stanceIds.add(t.id)
    for (const k of ["id", "stance", "but"] as const) if (!t[k]) w(`missing ${k}`)
    if (!(t.grounded_in ?? []).length) w("grounded_in is empty")
    if (!(t.sources ?? []).length) w("no sources")
    for (const s of t.sources ?? []) if (!HOW.includes(s.how)) w(`source how ${s.how}`)
    for (const i of t.lenses ?? []) if (!ids.has(i)) w(`lens ${i} missing`)
    if (CODEBASES.test(JSON.stringify(t))) w("names a specific codebase")
  }

  // Every name a probe is grounded in resolves to a lens, a stance's grounding, or grounds.yaml.
  const known = new Set(
    [
      ...c.entries.flatMap((e) => [e.name, e.name.replace(/\s*\(.*\)$/, "")]),
      ...c.thinking.flatMap((t) => t.grounded_in ?? []),
      ...c.grounds.map((g) => g.name),
    ].map((n) => n.toLowerCase()),
  )
  const used = new Set<string>()
  for (const [k, st] of Object.entries(c.starters)) {
    const w = (m: string) => problems.push(`starters:${k}${m}`)
    if (!KINDS[k]) w(": unknown kind")
    for (const i of st.lenses ?? []) if (!ids.has(i)) w(`: lens ${i} missing`)
    const probes = st.probes ?? []
    if (probes.length < 3 || probes.length > 5) w(`: ${probes.length} probes`)
    probes.forEach((p, i) => {
      for (const f of ["find", "ask", "settled_when"] as const) if (!p[f]) w(`.${i + 1}: probe without ${f}`)
      if (!(p.grounded_in ?? []).length) w(`.${i + 1}: probe without grounding`)
      for (const g of p.grounded_in ?? []) {
        used.add(g.toLowerCase())
        if (!known.has(g.toLowerCase())) w(`: grounding "${g}" has no lens, stance or grounds entry`)
      }
    })
  }
  for (const g of c.grounds) {
    if (!used.has(g.name.toLowerCase())) problems.push(`grounds:${g.name}: not used by any probe`)
    if (!(g.sources ?? []).length) problems.push(`grounds:${g.name}: no sources`)
  }
  for (const m of c.methodologies) {
    for (const i of m.lenses_first ?? []) if (!ids.has(i)) problems.push(`methodologies:${m.id}: lens ${i} missing`)
    for (const i of m.stances_first ?? [])
      if (!stanceIds.has(i)) problems.push(`methodologies:${m.id}: stance ${i} missing`)
  }
  return problems
}

/**
 * Positives sign one or two primary effects ("++") and say when a sign flips; negatives have no
 * primary effect; laws can't be followed, so they name the axes they bear on instead of signing them.
 */
function axesProblems(e: Lens, no: (m: string) => void): void {
  const a = e.axes
  if (!a) {
    no("no axes")
    return
  }
  if (e.family === "law") {
    if (!(a.bears_on ?? []).length || a.signs) no("law axes need bears_on only")
    for (const x of a.bears_on ?? []) if (!(AXES as readonly string[]).includes(x)) no(`axis ${x}`)
    if (typeof a.why !== "string") no("law axes.why is not text")
    return
  }
  const signs = a.signs ?? {}
  const why = typeof a.why === "object" ? a.why : {}
  for (const [x, v] of Object.entries(signs)) {
    if (!(AXES as readonly string[]).includes(x) || !["+", "++", "-"].includes(v)) no(`axes ${x}=${v}`)
    if (!why[x]) no(`axes: no reason for ${x}`)
  }
  const primary = Object.values(signs).filter((v) => v === "++").length
  if (isNegative(e) ? primary > 0 : primary < 1 || primary > 2) no(`${primary} primary effects`)
  if (!isNegative(e) && !a.flips) no("axes: no flips")
}

export const HEADER =
  "<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->\n\n"

const one = (s: unknown) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
const SHOW: Record<Sign, string> = { "++": "⊕", "+": "+", "-": "−" }

/** Compact axis signs for one line: primary effects first, then gains, then costs. */
function axesLine(e: Lens): string {
  const a = e.axes
  if (!a) return ""
  if (a.bears_on) return `bears on ${a.bears_on.join(", ")}`
  const order: Sign[] = ["++", "+", "-"]
  return Object.entries(a.signs ?? {})
    .sort(([, x], [, y]) => order.indexOf(x) - order.indexOf(y))
    .map(([axis, v]) => `${axis}${SHOW[v]}`)
    .join(" ")
}

/** The generated pages, keyed by path under agents/lenses/. */
export function lensDocs(c: Catalog): Map<string, string> {
  const docs = new Map<string, string>()
  const put = (page: string, lines: string[]) => docs.set(page, HEADER + lines.join("\n"))
  const byId = new Map(c.entries.map((e) => [e.id, e]))
  const label = (e: Lens) => FILES.find(([f]) => f === FAMILY_FILE[e.family])?.[1] ?? e.family
  const flags = (e: Lens) =>
    [e.contested && "C", e.agent_prone && "A", e.tell && "T", e.example && "E"].filter(Boolean).join("")
  const langs = (e: Lens) =>
    Object.keys(e.in ?? {})
      .map((l) => LANGS[l] ?? l)
      .join(",")
  const line = (e: Lens, base = "entries/") => {
    const meta = [
      `${e.family}/${e.group ?? "-"}`,
      flags(e) && `[${flags(e)}]`,
      axesLine(e) && `(${axesLine(e)})`,
      (e.matters_most_for ?? []).length && `{${e.matters_most_for!.join(",")}}`,
      langs(e) && `langs:${langs(e)}`,
    ]
      .filter(Boolean)
      .join(" ")
    const related = (e.related ?? []).length ? ` → ${e.related!.map((r) => `\`${r}\``).join(" ")}` : ""
    return `- [\`${e.id}\`](${base}${e.id}.md) **${e.name}** · ${meta}: ${one(e.says)}${related}`
  }
  const legend = (up = "") => [
    "Flags: **C** contested (offer it as a choice, with both sides) · **A** agents do this readily · **T** has a one-file tell · **E** has a pseudo-code example.",
    `Axes in brackets: ⊕ the lens's primary effect, the reason to reach for it · + also helps · − costs. Laws name the axes they bear on. See [AXES.md](${up}AXES.md).`,
    "`{kinds}`: where it matters most. `langs:` which languages have notes. `→` related lenses.",
  ]

  const index = [
    "# Lens index",
    "",
    "One line per lens. To read one in full, open `entries/<id>.md`. To start from a kind of project, open `kinds/<kind>.md`. How to think in the interview: [THINKING.md](THINKING.md). How to frame a project's conventions: [METHODOLOGIES.md](METHODOLOGIES.md).",
    "",
    ...legend().flatMap((l) => [l, ""]),
    "## Kinds",
    "",
    ...Object.entries(KINDS).map(
      ([k, n]) => `- [${n}](kinds/${k}.md) (${c.entries.filter((e) => (e.matters_most_for ?? []).includes(k)).length})`,
    ),
    "",
    "## Overlapping lenses",
    "",
    ...c.overlaps.map((g) => `- ${g.ids.map((i) => `\`${i}\``).join(", ")}: ${one(g.pick)}`),
    "",
  ]
  for (const [file, heading] of FILES) {
    const es = c.entries.filter((e) => FAMILY_FILE[e.family] === file)
    if (es.length) index.push(`## ${heading}`, "", ...es.map((e) => line(e)), "")
  }
  put("INDEX.md", index)

  const axes = [
    "# Quality axes",
    "",
    "Every lens is labelled with its effect on six quality axes. Ask the developer which axes matter most for this project, then bring up the lenses whose primary effect is on those axes, and name each one's costs from its other signs. The axes are one input: the kind of project, its forces and what the repository already shows still decide the order.",
    "",
    "⊕ marks a lens's primary effect: the reason to reach for it. A lens can help other axes too (+) and costs something on most (−); each lens's page says why, and when a sign flips. Anti-patterns and smells have no primary effect. Laws can't be followed, only planned for, so they name the axes they bear on.",
    "",
  ]
  for (const axis of AXES) {
    const primary = c.entries.filter((e) => e.axes?.signs?.[axis] === "++")
    const laws = c.entries.filter((e) => e.axes?.bears_on?.includes(axis))
    axes.push(`## ${axis}`, "", `${AXIS_MEANS[axis][0]!.toUpperCase()}${AXIS_MEANS[axis].slice(1)}.`, "")
    axes.push(
      `**Primary effect of (${primary.length}):** ${primary.map((e) => `[${e.name}](entries/${e.id}.md)`).join(", ") || "none yet"}`,
      "",
    )
    if (laws.length)
      axes.push(`**Laws that bear on it:** ${laws.map((e) => `[${e.name}](entries/${e.id}.md)`).join(", ")}`, "")
  }
  put("AXES.md", axes)

  for (const [k, n] of Object.entries(KINDS)) {
    const st = c.starters[k]
    const out = [`# ${n}: where to start`, ""]
    const tagged = c.entries.filter((e) => (e.matters_most_for ?? []).includes(k))
    if (st) {
      out.push(one(st.hinge), "", ...legend("../").flatMap((l) => [l, ""]), "## Look at these first, in order", "")
      out.push(
        ...st.lenses
          .filter((i) => byId.has(i))
          .map((i, j) => line(byId.get(i)!, "../entries/").replace(/^- /, `${j + 1}. `)),
        "",
      )
      if ((st.probes ?? []).length) {
        out.push(
          "## Probes for the interview",
          "",
          "Find first, in the code, docs, git history, CI and config. Ask only what the repository can't tell, in the project's own terms, with the evidence and a recommendation. Skip the question when the findings settle it. Also see the general stances in [THINKING.md](../THINKING.md).",
          "",
        )
        for (const [i, p] of st.probes!.entries())
          out.push(
            `### ${i + 1}. ${(p.grounded_in ?? []).join(", ")}`,
            "",
            `**Find:** ${one(p.find)}`,
            "",
            `**Ask:** ${one(p.ask)}`,
            "",
            `**Settled when:** ${one(p.settled_when)}`,
            "",
          )
      }
      const also = tagged.filter((e) => !st.lenses.includes(e.id))
      if (also.length) out.push("## Also relevant", "", ...also.map((e) => line(e, "../entries/")), "")
    } else {
      out.push(
        `The lenses tagged for ${n.toLowerCase()}.`,
        "",
        ...(tagged.length
          ? tagged.map((e) => line(e, "../entries/"))
          : ["No lens is tagged for this kind yet. Use the [index](../INDEX.md)."]),
        "",
      )
    }
    put(`kinds/${k}.md`, out)
  }

  const list = (title: string, items?: string[]) =>
    items?.length ? [`## ${title}`, "", ...items.map((x) => `- ${one(x)}`), ""] : []
  for (const e of c.entries) {
    const o = [
      `# ${e.name}`,
      "",
      `\`${e.id}\` · ${label(e).toLowerCase()}, ${e.group ?? "-"}${e.contested ? " · **contested**" : ""}${e.agent_prone ? " · **agents do this**" : ""}`,
      "",
      one(e.says),
      "",
    ]
    if (e.names) o.push(`*Names:* ${one(e.names)}`, "")
    if ((e.matters_most_for ?? []).length) o.push(`*Matters most for:* ${e.matters_most_for!.join(", ")}`, "")
    const only = [...(e.applies_to?.kinds ?? []), ...(e.applies_to?.languages ?? [])]
    if (only.length) o.push(`*Applies only to:* ${only.join(", ")}`, "")
    o.push("## But", "", one(e.counter), "")
    if (e.axes) {
      o.push("## Quality axes", "")
      if (e.axes.bears_on) o.push(`*Bears on:* ${e.axes.bears_on.join(", ")}. ${one(e.axes.why)}`, "")
      else {
        const why = typeof e.axes.why === "object" ? e.axes.why : {}
        const order: Sign[] = ["++", "+", "-"]
        const signs = Object.entries(e.axes.signs ?? {}).sort(([, x], [, y]) => order.indexOf(x) - order.indexOf(y))
        o.push(
          ...signs.map(([axis, v]) => `- **${axis}** ${SHOW[v]}${v === "++" ? " (primary)" : ""}: ${one(why[axis])}`),
          "",
        )
        if (e.axes.flips) o.push(`**Flips:** ${one(e.axes.flips)}`, "")
      }
    }
    const bad = isNegative(e)
    o.push(
      ...list(bad ? "Why people fall into it" : "Warranted when", e.forces),
      ...list("How it shows", e.looks_like),
      ...list(bad ? "Overcorrecting looks like" : "Overdone when", e.overuse),
    )
    if (e.remedy) o.push("## What to do", "", one(e.remedy), "")
    if (e.example) {
      o.push("## Example", "", "Before:", "", "```", e.example.before.trimEnd(), "```", "", "After:", "", "```")
      o.push(e.example.after.trimEnd(), "```", "", ...(e.example.note ? [one(e.example.note), ""] : []))
    } else if (e.example_reason) o.push("## Example", "", `None: ${one(e.example_reason)}`, "")
    if (e.tell) o.push("## One-file tell", "", one(e.tell), "")
    const notes = Object.entries(e.in ?? {})
    if (notes.length) o.push("## By language", "", ...notes.flatMap(([l, t]) => [`**${l}:** ${one(t)}`, ""]))
    if ((e.related ?? []).length)
      o.push("## Related", "", e.related!.map((r) => `[${byId.get(r)?.name ?? r}](${r}.md)`).join(" · "), "")
    const overlap = c.overlaps.find((g) => g.ids.includes(e.id))
    if (overlap) o.push("## Overlaps", "", one(overlap.pick), "")
    const stances = c.thinking.filter((t) => (t.lenses ?? []).includes(e.id))
    if (stances.length)
      o.push(
        "## In the interview",
        "",
        ...stances.map((t) => `- [${one(t.stance).split(/(?<=\.)\s/)[0]}](../THINKING.md#${t.id})`),
        "",
      )
    o.push(
      "## Sources",
      "",
      ...(e.sources ?? []).map((s) => `- ${s.url ? `[${one(s.cite)}](${s.url})` : one(s.cite)} (${s.how})`),
      "",
    )
    put(`entries/${e.id}.md`, o)
  }

  if (c.thinking.length) {
    const o = [
      "# How to think about a project in the interview",
      "",
      "General stances for any kind of project. Each one carries named laws forward as something to do or ask, not a fact to recite. Kind-specific probes are in `kinds/<kind>.md`.",
      "",
    ]
    for (const method of [false, true]) {
      o.push(method ? "## Running the interview" : "## About the project", "")
      for (const t of c.thinking.filter((x) => !!x.method === method)) {
        o.push(`### ${t.id}`, "", one(t.stance), "")
        if (t.ask) o.push(`**Ask:** ${one(t.ask)}`, "")
        o.push(`**But:** ${one(t.but)}`, "", `*Grounded in:* ${t.grounded_in.join(", ")}`, "")
        if ((t.lenses ?? []).length)
          o.push(`*Bears on:* ${t.lenses!.map((i) => `[${byId.get(i)?.name ?? i}](entries/${i}.md)`).join(", ")}`, "")
        o.push(
          `*Sources:* ${(t.sources ?? []).map((s) => (s.url ? `[${one(s.cite)}](${s.url})` : one(s.cite))).join("; ")}`,
          "",
        )
      }
    }
    put("THINKING.md", o)
  }

  if (c.methodologies.length) {
    const o = ["# Methodologies", "", ...(c.methodologiesIntro ? [c.methodologiesIntro, ""] : [])]
    const lensLink = (i: string) => (byId.has(i) ? `[${byId.get(i)!.name}](entries/${i}.md)` : `\`${i}\``)
    for (const m of c.methodologies) {
      o.push(`## ${m.name} (\`${m.id}\`)`, "", one(m.frames), "", `**Fits:** ${one(m.fits)}`, "")
      if ((m.signals ?? []).length) o.push(`**Signals in the code:** ${m.signals!.join("; ")}.`, "")
      if ((m.asks ?? []).length) o.push("**Ask:**", "", ...m.asks!.map((a) => `- ${one(a)}`), "")
      if ((m.lenses_first ?? []).length)
        o.push(`**Lenses to look at first:** ${m.lenses_first!.map(lensLink).join(", ")}`, "")
      if ((m.stances_first ?? []).length)
        o.push(`**Stances to lead with:** ${m.stances_first!.map((i) => `[${i}](THINKING.md#${i})`).join(", ")}`, "")
      if ((m.pairs_with ?? []).length) o.push(`**Pairs with:** ${m.pairs_with!.map((p) => `\`${p}\``).join(", ")}`, "")
    }
    put("METHODOLOGIES.md", o)
  }
  return docs
}

async function pagesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  return entries.filter((e) => e.endsWith(".md")).map((e) => e.split(path.sep).join("/"))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
  const out = path.join(repoRoot, "agents/lenses")
  const catalog = await loadCatalog(path.join(repoRoot, "packages/lenses"))
  const problems = catalogProblems(catalog)
  if (problems.length) {
    process.stderr.write(
      `packages/lenses has ${problems.length} problems:\n${problems.map((p) => `  ${p}\n`).join("")}`,
    )
    process.exit(1)
  }
  const docs = lensDocs(catalog)
  const existing = await pagesUnder(out)
  if (process.argv.includes("--check")) {
    const stale: string[] = []
    for (const [page, text] of docs)
      if ((await readFile(path.join(out, page), "utf8").catch(() => null)) !== text) stale.push(page)
    for (const page of existing) if (!docs.has(page)) stale.push(page)
    if (stale.length) {
      process.stderr.write(
        `agents/lenses is stale (${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""}): run pnpm lenses\n`,
      )
      process.exitCode = 1
    }
  } else {
    for (const page of existing) if (!docs.has(page)) await rm(path.join(out, page))
    for (const [page, text] of docs) {
      await mkdir(path.dirname(path.join(out, page)), { recursive: true })
      await writeFile(path.join(out, page), text)
    }
    process.stdout.write(`wrote agents/lenses: ${catalog.entries.length} lenses, ${docs.size} pages\n`)
  }
}
