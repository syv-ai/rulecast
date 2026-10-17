import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { type Catalog, catalogProblems, type Lens, lensDocs, loadCatalog } from "../../scripts/lenses"
import { run } from "../helpers/script"

const packageDir = fileURLToPath(new URL("../../", import.meta.url))
const lensesDir = path.join(packageDir, "../lenses")

function lens(overrides: Partial<Lens> = {}): Lens {
  return {
    id: "fail-fast",
    name: "Fail fast",
    family: "principle",
    group: "errors",
    says: "Stop at the first sign of a broken assumption.",
    counter: "A long batch job may be better off collecting errors.",
    sources: [{ cite: "Jim Shore, Fail Fast (2004)", url: null, how: "recalled" }],
    axes: {
      signs: { reliability: "++", delivery: "-" },
      why: { reliability: "Errors surface where they start.", delivery: "Every assumption needs a check." },
      flips: "In a batch job, stopping early loses the rest of the run.",
    },
    ...overrides,
  }
}

function catalog(entries: Lens[], rest: Partial<Catalog> = {}): Catalog {
  return { entries, starters: {}, thinking: [], methodologies: [], overlaps: [], grounds: [], ...rest }
}

describe("catalogProblems", () => {
  test("the committed catalog has none", async () => {
    expect(catalogProblems(await loadCatalog(lensesDir))).toEqual([])
  })

  test("a positive lens signs one or two primary effects and says when a sign flips", () => {
    const none = lens({ axes: { signs: { reliability: "+" }, why: { reliability: "x" }, flips: "y" } })
    const noFlips = lens({ axes: { signs: { reliability: "++" }, why: { reliability: "x" } } })
    expect(catalogProblems(catalog([none]))).toEqual(["principles:fail-fast: 0 primary effects"])
    expect(catalogProblems(catalog([noFlips]))).toEqual(["principles:fail-fast: axes: no flips"])
  })

  test("every sign has a reason and a known axis", () => {
    const e = lens({ axes: { signs: { speed: "+", reliability: "++" }, why: { reliability: "x" }, flips: "y" } })
    expect(catalogProblems(catalog([e]))).toEqual([
      "principles:fail-fast: axes speed=+",
      "principles:fail-fast: axes: no reason for speed",
    ])
  })

  test("negatives have no primary effect, and laws only name the axes they bear on", () => {
    const smell = lens({
      id: "long-method",
      family: "smell",
      axes: { signs: { change_cost: "++" }, why: { change_cost: "x" } },
    })
    const law = lens({ id: "hyrums-law", family: "law", axes: { signs: { reliability: "-" }, why: "x" } })
    expect(catalogProblems(catalog([smell, law]))).toEqual([
      "smells:long-method: 1 primary effects",
      "laws:hyrums-law: law axes need bears_on only",
    ])
  })

  test("related ids, starter lenses and methodology lenses must exist", () => {
    const e = lens({ related: ["dry"] })
    const probes = [1, 2, 3].map(() => ({ find: "f", ask: "a", settled_when: "s", grounded_in: ["Fail fast"] }))
    const problems = catalogProblems(
      catalog([e], {
        starters: { "cli-devtool": { hinge: "h", lenses: ["fail-fast", "kiss"], probes } },
        methodologies: [{ id: "exemplar", name: "Exemplar", lenses_first: ["yagni"] }],
      }),
    )
    expect(problems).toEqual([
      "principles:fail-fast: related dry missing",
      "starters:cli-devtool: lens kiss missing",
      "methodologies:exemplar: lens yagni missing",
    ])
  })
})

describe("lensDocs", () => {
  test("writes the index, the stances, the methodologies, the axes, every kind and every lens", async () => {
    const c = await loadCatalog(lensesDir)
    const docs = lensDocs(c)
    for (const page of ["INDEX.md", "THINKING.md", "METHODOLOGIES.md", "AXES.md"])
      expect(docs.has(page), page).toBe(true)
    for (const kind of Object.keys(c.starters)) expect(docs.has(`kinds/${kind}.md`), kind).toBe(true)
    for (const e of c.entries) expect(docs.has(`entries/${e.id}.md`), e.id).toBe(true)
    expect(c.entries.some((e) => e.family === "practice")).toBe(true)
  })

  test("every page says it is generated", async () => {
    for (const [page, text] of lensDocs(await loadCatalog(lensesDir))) {
      expect(text.startsWith("<!-- Generated from packages/lenses by `pnpm lenses`."), page).toBe(true)
    }
  })

  test("a lens page shows its primary effect as a ringed plus, never as ++", () => {
    const page = lensDocs(catalog([lens()])).get("entries/fail-fast.md")!
    expect(page).toContain("## Quality axes")
    expect(page).toContain("- **reliability** ⊕ (primary): Errors surface where they start.")
    expect(page).toContain("- **delivery** −: Every assumption needs a check.")
    expect(page).toContain("**Flips:** In a batch job, stopping early loses the rest of the run.")
    expect(page).not.toContain("++")
  })

  test("a law page names what it bears on", () => {
    const law = lens({ id: "hyrums-law", family: "law", axes: { bears_on: ["reliability"], why: "Users rely on it." } })
    expect(lensDocs(catalog([law])).get("entries/hyrums-law.md")).toContain(
      "*Bears on:* reliability. Users rely on it.",
    )
  })

  test("AXES.md lists each axis's primary lenses and the laws that bear on it", () => {
    const law = lens({
      id: "hyrums-law",
      name: "Hyrum's law",
      family: "law",
      axes: { bears_on: ["reliability"], why: "x" },
    })
    const axes = lensDocs(catalog([lens(), law])).get("AXES.md")!
    const reliability = axes.slice(axes.indexOf("## reliability"), axes.indexOf("## change_cost"))
    expect(reliability).toContain("[Fail fast](entries/fail-fast.md)")
    expect(reliability).toContain("[Hyrum's law](entries/hyrums-law.md)")
  })
})

describe("pnpm lenses --check", () => {
  test("exits 1 when a page is stale or extra, and 0 when the pages match the catalog", async () => {
    const script = path.join(packageDir, "scripts/lenses.ts")
    await expect(run(script)).resolves.toBe(0)
    const index = path.join(packageDir, "../../agents/lenses/INDEX.md")
    const extra = path.join(packageDir, "../../agents/lenses/entries/not-a-lens.md")
    const original = await readFile(index, "utf8")
    try {
      await writeFile(index, `${original}stale\n`)
      await expect(run(script)).resolves.toBe(1)
      await writeFile(index, original)
      await writeFile(extra, "# Not a lens\n")
      await expect(run(script)).resolves.toBe(1)
    } finally {
      await writeFile(index, original)
      await rm(extra, { force: true })
    }
  })
})
