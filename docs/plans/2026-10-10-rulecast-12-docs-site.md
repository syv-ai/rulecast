# rulecast Plan 12 — Documentation Site Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `https://syv-ai.github.io/rulecast/`: a documentation site built from the repository's own Markdown, with a landing page, a logo, a hook-flow diagram, an animated terminal demo of real output, and an annotated rule.

**Approach:** A private workspace package, `packages/site`, built with Astro Starlight. A sync module reads `README.md` and the `agents/` docs and writes the doc pages at build time (gitignored), so a page cannot drift from its source: the README is split into pages by `##` section through one mapping table, and a section the table does not place fails the build. The visuals are Astro components that read the README's own example rule and output, and the renderer's golden outputs, at build time. A GitHub Actions workflow deploys to Pages on every push to `main`.

**Stack:** Astro 7, Starlight 0.42, TypeScript, vitest, GitHub Pages (Actions build type).

**Status:** Done (2026-10-10). Changes from the plan as written:

- `astro check` does not run in this workspace (`@astrojs/check` 0.9.10 fails to load `@emnapi/core` under pnpm), so `typecheck` is `tsc` over `scripts/`, `test/` and `astro.config.ts`. The `.astro` components are type-checked by nobody; the build catches what breaks rendering.
- The hook flow is an HTML/CSS grid, not an SVG: it reflows to one column at phone width, which a fixed-width SVG cannot.
- Biome cannot see a `.astro` template's use of frontmatter names, so `biome.json` turns off `noUnusedVariables`/`noUnusedImports` for `*.astro`.
- The README links the site in a line under its title; `readmeSections()` drops any paragraph that contains the site URL, so the site never links itself.
- The two agents/ pages open with a note that they are written for agents, linking the raw file at the released tag (`PAGES[].intro`).
- Redesigned the same day for simplicity: the landing page is one component (`Landing.astro`) with a statement headline, a copy-to-clipboard install command and three sections; the rule anatomy lights only the message and the doc section in both panes (no numbered callouts), its HTML built in `scripts/anatomy.ts`; the hook flow is a plain two-column list; the header is translucent, and Starlight's layered styles are overridden without `!important`.
- `BASE`, `SITE` and `SITE_URL` live in `sources.ts` (not `links.ts`), since the README filter needs them and `links.ts` imports `sources.ts`.

Prerequisite: plan 11 is done (0.5.0 released).

---

## Decisions this plan implements

Decided by the user on 2026-10-10 (handoff): Starlight; single-source content from `README.md`, `agents/reference/rule-format.md`, `agents/reference/detectors.md`, `agents/SETUP.md`, `agents/DRAFT-RULES.md`; all four visuals (hook flow, animated terminal demo of real output, logo and palette, rule anatomy); hosting at `syv-ai.github.io/rulecast` deployed by Actions; `docs/plans`, `docs/specs`, `docs/evidence` are never published.

Decided in planning (the handoff left these open):

1. **Generated at build time, not committed.** `packages/rulecast/scripts/readme.ts` commits its output because npm publishes it and a reviewer should see it. Site pages are only ever seen built, so they are generated into `src/content/docs/` (gitignored) by `predev`/`prebuild`. There is nothing to go stale, so no `--check` mode is needed for the pages; the build failing on an unplaced README section is the check, and CI builds the site on every pull request.
2. **Page structure.** Sidebar groups: *Start here* (Getting started, How it works), *Guides* (Writing rules, Adopting rules, Git hooks & CI, Agents), *Reference* (Commands, Rule format, Detectors), *For agents* (SETUP, DRAFT-RULES). The README's "Detectors" overview table is the head of the Detectors reference page, followed by `agents/reference/detectors.md`.
3. **Version** is shown on the landing page, read from `packages/rulecast/package.json` at build time. The site is not versioned and gets no changesets.
4. **Search:** Starlight's built-in Pagefind.
5. **The README's example rule produces the README's opening output.** Today the rule's `message` ("…raises HTTPException({{args}}). Raise a domain exception.") does not produce the opening block's message ("…in the service layer. Raise a domain exception; the API layer maps it to a response."). The rule-anatomy graphic connects the two, so the README's rule message is changed to the one that produces the output, and the build asserts it does.

## Files

| File | Responsibility |
|---|---|
| `packages/site/package.json` | Private package `@syv-ai/rulecast-site`: `dev`, `build`, `preview`, `sync`, `typecheck`, `test` |
| `packages/site/astro.config.mjs` | Starlight config: `site`, `base: "/rulecast"`, title, logo, sidebar, custom CSS, social link |
| `packages/site/src/content.config.ts` | Starlight docs collection |
| `packages/site/scripts/sources.ts` | **Owner of every read of repository Markdown**: the page table, splitting the README by section, the README's example rule and opening output, the golden outputs |
| `packages/site/scripts/links.ts` | **Owner of link rewriting**: a relative link to a published source becomes a site route; any other relative link becomes a GitHub blob URL |
| `packages/site/scripts/sync.ts` | Writes the generated pages (frontmatter + body) into `src/content/docs/`; CLI entry for `predev`/`prebuild` |
| `packages/site/test/*.test.ts` | vitest: section placement, link rewriting, the example-rule assertion |
| `packages/site/src/content/docs/index.mdx` | Landing page (hand-written): hero, demo, anatomy, flow, cards |
| `packages/site/src/content/docs/how-it-works.mdx` | Hand-written frame around the hook-flow diagram, with README fragments imported |
| `packages/site/src/components/TerminalDemo.astro` | Animated terminal, CSS-only, scenes built from real output |
| `packages/site/src/components/HookFlow.astro` | Inline-SVG diagram of where rulecast sits between agent and tools |
| `packages/site/src/components/RuleAnatomy.astro` | The README rule, annotated, beside the output it produces |
| `packages/site/src/assets/logo-{light,dark}.svg`, `public/favicon.svg` | Brand mark |
| `packages/site/src/styles/theme.css` | Palette as Starlight accent/gray tokens, light and dark |
| `.github/workflows/pages.yml` | Build and deploy to Pages on push to `main` |
| `.github/workflows/ci.yml` | A `site` job that builds the site on pull requests |
| `.changeset/config.json` | `ignore: ["@syv-ai/rulecast-site"]` |
| `.gitignore` | Generated pages and Astro's `.astro/` |
| `README.md` | Example rule message (Decision 5); link to the site |

## Rules with one owner

- **Which source becomes which page, under which title and route:** the `PAGES` table in `sources.ts`. `links.ts` asks it for the route of a source path; the sidebar in `astro.config.mjs` lists routes the table defines (a test asserts every sidebar route is a page).
- **What a README section is:** `readmeSections()` in `sources.ts` (split on `^## ` outside fenced code). The page table, the fragments for `how-it-works.mdx` and the visuals all go through it.
- **The README's example rule and opening output:** `exampleRule()` and `openingOutput()` in `sources.ts`. `RuleAnatomy` and `TerminalDemo` import them; neither parses the README.
- **The base path `/rulecast`:** `BASE` exported from `links.ts`, imported by `astro.config.mjs`.
- **Palette:** CSS custom properties in `theme.css`. The SVG components use `var(--…)` only; the logo files carry their own fills because a favicon cannot read page CSS.

## Tasks

### Task 1: Package scaffold

**Files:** create `packages/site/{package.json,astro.config.mjs,tsconfig.json,src/content.config.ts}` · modify `.changeset/config.json`, `.gitignore`

**Behaviour:** `pnpm --filter @syv-ai/rulecast-site build` builds an empty Starlight site to `packages/site/dist` with base `/rulecast/`. The package is private and in changesets' `ignore`.

- [ ] Add the package (`astro`, `@astrojs/starlight`, `@astrojs/check`, `typescript`, `tsx`, `vitest`), private, `"type": "module"`
- [ ] Verify: build passes; `pnpm changeset status` does not list the site

### Task 2: Sources and link rewriting

**Files:** create `packages/site/scripts/{sources.ts,links.ts}` · test `packages/site/test/{sources,links}.test.ts`

**Behaviour:**
- `readmeSections()` returns the README's lead (text before the first `##`) and each `##` section by heading, ignoring `##` inside fenced code.
- `PAGES` places every README section on exactly one page or in `DROPPED` (only "License", linked in the footer). `pageBodies()` throws naming any section that is in neither, so a new README section fails the build until it is placed.
- An `agents/` doc's `# ` title becomes the page title and is removed from the body.
- `rewriteLinks(markdown, sourcePath)` resolves each relative link against the source's directory; a published source (with its `#anchor`) becomes `/rulecast/<route>/`, anything else (e.g. `LICENSE`) `https://github.com/syv-ai/rulecast/blob/main/<path>`. Absolute and `#` links are untouched.
- `exampleRule()` returns the first YAML block of "A rule"; `openingOutput()` the first code block of the lead. `assertExampleProducesOutput()` substitutes the rule's message template with the values in the output's location line and throws if the output does not contain the result.

- [ ] Write failing tests for each bullet, then implement
- [ ] Verify: `pnpm --filter @syv-ai/rulecast-site test` passes

### Task 3: README example message (Decision 5)

**Files:** modify `README.md` ("A rule"), regenerate `packages/rulecast/README.md` with `pnpm readme`

**Behaviour:** the README's rule message is `"{{file}}:{{line}} raises HTTPException({{args}}) in the service layer. Raise a domain exception; the API layer maps it to a response."`, and `assertExampleProducesOutput()` passes on the real README.

- [ ] Verify: `pnpm readme --check` passes; the Task 2 test against the real README passes

### Task 4: Sync and pages

**Files:** create `packages/site/scripts/sync.ts`, `src/content/docs/how-it-works.mdx` · modify `astro.config.mjs` (sidebar)

**Behaviour:** `pnpm --filter @syv-ai/rulecast-site sync` writes one `.md` per `PAGES` entry with `title`/`description` frontmatter and rewritten links; `predev` and `prebuild` run it. The built site has every page in the sidebar, no link to a `.md` path, and no page from `docs/`.

- [ ] Verify: build passes; `grep -r 'href="[^"]*\.md' dist` finds nothing; Pagefind index is built

### Task 5: Logo and palette

**Files:** create `src/assets/logo-light.svg`, `src/assets/logo-dark.svg`, `public/favicon.svg`, `src/styles/theme.css`

**Behaviour:** A mark and wordmark that reads at 16 px (favicon) and in the header, in both themes; Starlight's accent and gray scales come from the palette in both themes, and body text meets WCAG AA contrast on its background.

- [ ] Try two or three marks side by side before choosing one
- [ ] Verify: header and favicon in light and dark (browser)

### Task 6: Hook flow diagram

**Files:** create `src/components/HookFlow.astro` · used in `how-it-works.mdx` and `index.mdx`

**Behaviour:** One SVG showing agent → tool call → rulecast hook → what comes back, for: Read → `touch` (conventions); Edit/Write → `guard` before (refuse_write) and `edit` after (findings); Bash → `shell-before` / `shell-after` (working tree compared, findings after); Stop → `verify` (block or allow; swept changes reported, never blocking); SessionStart → `start`/`reset`. Facts from spec §7 and §12. Colours from theme tokens; legible at 360 px width (stacks or scrolls inside its own box, never the page).

### Task 7: Terminal demo

**Files:** create `src/components/TerminalDemo.astro`

**Behaviour:** A CSS-animated terminal that loops: the agent edits `app/services/users.py` → rulecast's reply (the README's opening output, via `openingOutput()`) → the agent fixes it → no reply (rulecast is silent when there is nothing to say) → the agent rewrites the file with `sed -i` → the `shell-edit` golden. Output text is read at build time, never typed into the component. `prefers-reduced-motion` shows the final frame with no animation.

### Task 8: Rule anatomy

**Files:** create `src/components/RuleAnatomy.astro`

**Behaviour:** The README's example rule (`exampleRule()`) with callouts on `id`, `files`, `detect`, `message`, `context`, beside the output it produces (`openingOutput()`), the message and the `--- conventions/backend.md#errors ---` section each linked visually to the key that produced them. Stacks vertically at phone width.

### Task 9: Landing page

**Files:** create `src/content/docs/index.mdx`

**Behaviour:** Splash page: logo, the README's first paragraph as the tagline, `npx @syv-ai/rulecast init` as the copyable install command (never `npx rulecast`), the current version, the terminal demo, the rule anatomy, the hook flow, and link cards to the guides. Claims beyond the README's (performance, platforms) are quoted from it, not restated.

### Task 10: Deploy and CI

**Files:** create `.github/workflows/pages.yml` · modify `.github/workflows/ci.yml`

**Behaviour:** Push to `main` (and `workflow_dispatch`) builds the site and deploys it with `actions/upload-pages-artifact` + `actions/deploy-pages`. Pull requests build the site in CI.

- [ ] Enable Pages with build type workflow: `gh api -X POST repos/syv-ai/rulecast/pages -f build_type=workflow`

### Task 11: Links to the site

**Files:** modify `README.md` (link near the top), `pnpm readme` · repository homepage

- [ ] `gh repo edit syv-ai/rulecast --homepage https://syv-ai.github.io/rulecast/`

## End-to-end verification

1. `pnpm --filter @syv-ai/rulecast-site test && pnpm --filter @syv-ai/rulecast-site build` pass; `pnpm lint`, `pnpm typecheck`, `pnpm readme --check` pass.
2. `pnpm --filter @syv-ai/rulecast-site preview`: every sidebar page renders; the landing page in light and dark and at 375 px wide with no horizontal page scroll; the demo animates and stops under reduced motion; search finds "refuse_write".
3. Add a `## Test` section to a scratch copy of the README → `sync` fails naming it.
4. After the push, the Pages workflow succeeds and `https://syv-ai.github.io/rulecast/` serves the landing page with working CSS and links under `/rulecast/`.
