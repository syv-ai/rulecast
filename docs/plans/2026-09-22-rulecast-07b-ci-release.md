# rulecast Plan 7b — README, CI and the release pipeline Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything that has to be true before `@syv-ai/rulecast` 0.1.0 can be published and the repository can be shown to anyone: a README, continuous integration that actually runs the suite on hardware other than one Apple M3 Pro, and a release pipeline that turns a merge into a tagged npm package plus standalone binaries on a GitHub Release.

**Approach:** Three GitHub Actions workflows with one job shape each. `ci.yml` gates every push and pull request on `typecheck`, `lint`, the generated-file checks and the full test suite, and reports the perf numbers without gating on them. `release.yml` runs changesets on `main`: it opens a version PR, and when that merges it publishes to npm and cuts the GitHub Release. `binaries.yml` fires on that release and attaches one `bun build --compile` binary per platform, built natively on each runner — bun cannot cross-compile a binary that embeds `@ast-grep/napi`'s platform-specific native module. The README is written once at the repository root and mirrored into the package by a script with a `--check` mode, exactly as `.rulecast-rules.yaml` already is.

**Stack:** GitHub Actions, pnpm 10, changesets, bun 1.3, tsup, vitest.

Prerequisite: `2026-09-22-rulecast-07a-doctor.md`. Continue with `07c-public-dogfood.md`.

---

## Decisions this plan implements

1. **The perf test reports in CI; it does not gate.** (The user's decision, 2026-09-22.) A shared GitHub runner spawning `ruff`, `oxlint` and `command` subprocesses is several times slower than the M3 Pro every number in the spec comes from, and a build that goes red because a runner was busy is the fastest way to teach people to ignore CI. So the perf job prints p50 and p95 into the job summary and always succeeds.

   It does **not** do this with `continue-on-error`, which leaves a failed step annotated on a "green" build — a fake green is worse than no signal. The test gets an explicit switch: `RULECAST_PERF_GATE=0` makes it measure, print and skip the assertion. The 500 ms promise stays a local check on real hardware, and **spec §13 says so** instead of its current claim that "CI … fails if p95 exceeds 500 ms", which has never been true.

2. **The standalone binary ships in 0.1, built natively per platform.** (The user's decision, 2026-09-22.) `bun build --compile --target=bun-linux-x64` would embed whatever `@ast-grep/napi` resolved on the *building* machine — on macOS, the darwin `.node` — and the resulting Linux binary would fail at the first ast-grep rule, in a way no test on the build machine can see. So each platform builds on its own runner: `ubuntu-latest` (linux x64), `ubuntu-24.04-arm` (linux arm64), `macos-latest` (darwin arm64), `macos-13` (darwin x64).

   **No Windows binary in 0.1.** `src/detectors/linter/resolve.ts` and `src/core/which.ts` run `command -v` under `/bin/sh`, and `src/commands/spawn.ts` assumes POSIX detached spawning; rulecast has never run on Windows and nothing in the suite would catch a regression there. The README says so rather than shipping a binary that half works.

3. **The npm/Node install is the documented default; the binary is for CI and one-off runs.** The binary pays ~260 ms to extract and `dlopen` the native module on every run (spec §16): a `rulecast run` that takes ~110 ms under Node takes ~370 ms as a binary. That is invisible for `rulecast run` in CI and unacceptable for an edit hook fired on every file an agent writes. The README and `rulecast doctor` both say which to use for what, and this plan does not try to fix the dlopen cost.

4. **Releases go through changesets, as spec §16 already says.** One changeset per change, a bot-maintained "Version Packages" PR, and publishing on its merge. Only `@syv-ai/rulecast` is an npm package — `packages/rules-general`, `rules-python` and `rules-react` have no `package.json` and are consumed by git checkout at a tag, so the git tag changesets creates is what versions them. That is what spec §16's "one tag versions the CLI and the rule packages" means in practice.

5. **`src/core/version.ts` is generated from `package.json` during versioning.** `VERSION` is a literal because it has to survive bundling into `dist/` and into a `bun --compile` binary, and `test/core/version.test.ts` already keeps it equal to `package.json`. Changesets writes only `package.json`, so the `version` script it runs also runs `sync-version`, and the existing test is what fails if that ever comes apart.

6. **Generated files are checked, not regenerated, in CI.** `.rulecast-rules.yaml` already has `pnpm manifest --check`. The mirrored package README gets the same treatment (`pnpm readme --check`), and so does `src/core/version.ts` (`pnpm sync-version --check`). A CI that regenerates and commits is a CI that can push while a human is mid-review.

## Conventions

Same as 7a: pnpm workspace, commands from the repository root, per-task commits ending with a blank line and `Via [syv-ai/dash](https://github.com/syv-ai/dash)`, straight to `main`, never `git add -A`, never bypass lefthook, `pnpm lint:fix` before committing.

Two more for this plan:

- **Workflow files cannot be tested by running them.** Every workflow step that is more than one line of YAML must be a script in the repository that can be run locally — `pnpm readme --check`, `pnpm binary`, `pnpm sync-version --check`. The workflow calls the script; the script is what has a test.
- **Nothing in this plan publishes anything.** The final task ends at `pnpm publish --dry-run`. The actual 0.1.0 release is the user's to trigger, and 7c hands it over together with the visibility flip.

## File structure

| File | Responsibility |
|---|---|
| `README.md` | The canonical README: what rulecast is, install, quickstart, the commands, the rule format at a glance, which distribution to use |
| `packages/rulecast/README.md` | A generated copy, so the npm page renders it; header line says it is generated |
| `packages/rulecast/scripts/readme.ts` | `pnpm readme` / `pnpm readme --check`, after `scripts/generate-manifest.ts` |
| `packages/rulecast/scripts/sync-version.ts` | Writes `src/core/version.ts` from `package.json`; `--check` compares |
| `packages/rulecast/scripts/build-binary.ts` | `pnpm binary`: `pnpm build`, then `bun build --compile` to `dist/rulecast-<os>-<arch>` |
| `packages/rulecast/test/perf/edit-hook.test.ts` | `RULECAST_PERF_GATE=0` measures without asserting |
| `packages/rulecast/test/scripts/readme.test.ts` | The mirror is byte-identical and `--check` fails when it is not |
| `packages/rulecast/test/scripts/sync-version.test.ts` | Generated `version.ts` parses and equals `package.json` |
| `.changeset/config.json` | changesets, `access: public`, `baseBranch: main` |
| `.changeset/README.md` | The changesets default, kept |
| `.github/workflows/ci.yml` | `check`, `test`, `binary`, `perf` |
| `.github/workflows/release.yml` | changesets version PR and publish |
| `.github/workflows/binaries.yml` | On `release: published`, attach the four binaries |
| `.github/dependabot.yml` | Weekly updates for `github-actions` and `npm` |
| `package.json` (root) | `readme`, `sync-version`, `binary`, `version-packages`, `release` scripts |
| `packages/rulecast/package.json` | The same scripts, `repository`, `homepage`, `bugs`, `keywords`, `publishConfig` |
| `docs/specs/2026-09-15-rulecast-design.md` | §13's perf-test paragraph corrected; §16 gains the per-platform build note |

---

## Task 1: the README

**Files:** create `README.md` · create `packages/rulecast/scripts/readme.ts` · create `packages/rulecast/README.md` (generated) · modify `package.json`, `packages/rulecast/package.json` · test `packages/rulecast/test/scripts/readme.test.ts`

**Behaviour:** `pnpm readme` writes `packages/rulecast/README.md` from `README.md`; `pnpm readme --check` exits 1 with `packages/rulecast/README.md is stale: run pnpm readme` when they differ. The copy carries a one-line generated-by header, matching `MANIFEST_HEADER`'s convention in `packages/rulecast/scripts/manifest.ts:6`.

The README is the first thing anyone sees on npm and on GitHub. Sections, in order:

1. **One paragraph** — what rulecast is: it delivers a project's conventions to a coding agent at the moment the agent is about to break them, as hook output, instead of hoping the agent read `AGENTS.md`.
2. **The 60-second version** — `npx @syv-ai/rulecast init`, what it writes, and a screenshot-free example of what the agent then sees on an edit.
3. **A rule** — one annotated `.rulecast-config.yaml` excerpt: `id`, `files`, `detect`, `message`, `context`. Link to `agents/reference/rule-format.md` for the rest.
4. **Detectors** — the six, one line each, saying what they cost and when they run: `regex`, `path`, `ast-grep`, `command`, `linter` (ruff, oxlint, eslint), `llm` (verify only).
5. **Commands** — the table from spec §12, trimmed to one line per command.
6. **Install** — npm (`npx`, or `pnpm add -D @syv-ai/rulecast`) and the GitHub Releases binary, with Decision 3's guidance stated plainly: **use the npm/Node install for editor and agent hooks; the binary is for CI and one-off `rulecast run`**, because the binary pays ~260 ms per run to load its embedded native module. Linux and macOS only.
7. **Agents** — point at `agents/SETUP.md` and `agents/DRAFT-RULES.md` and say an agent can set rulecast up itself from them.
8. **Status** — 0.1: what works, what 0.2 adds (spec §17's rows, compressed), and that the config format may still change.
9. **License** — MIT, linking `LICENSE`.

Write it as prose a developer would actually read: no marketing adjectives, no feature-bullet wall, every claim checkable against the code. Where a number appears (the 500 ms edit-hook budget, the binary's startup cost), say on what hardware it was measured.

- [ ] Write `README.md`.
- [ ] Write `packages/rulecast/scripts/readme.ts`, modelled on `scripts/generate-manifest.ts:1-20`: read `../../README.md`, prepend `<!-- Generated from the repository README by \`pnpm readme\`. Do not edit by hand. -->\n\n`, write or `--check`.
- [ ] Add `"readme": "tsx scripts/readme.ts"` to `packages/rulecast/package.json` and `"readme": "pnpm --filter @syv-ai/rulecast readme"` to the root.
- [ ] Write `test/scripts/readme.test.ts`: the committed copy equals what the script generates (the same assertion `test/scripts/manifest.test.ts` makes for the manifest), and the header line is present.
- [ ] Run `pnpm readme`, commit both files.
- [ ] Verify: `pnpm vitest run test/scripts` → passes; `pnpm readme --check` → exit 0.
- [ ] Commit.

## Task 2: `sync-version`

**Files:** create `packages/rulecast/scripts/sync-version.ts` · modify `packages/rulecast/package.json`, `package.json` · test `packages/rulecast/test/scripts/sync-version.test.ts`

**Behaviour:** `pnpm sync-version` rewrites the `VERSION` literal in `src/core/version.ts` from `package.json`'s `version`; `pnpm sync-version --check` exits 1 with `src/core/version.ts is stale: run pnpm sync-version` when they differ. Everything else in `version.ts` — `parseVersion`, `isOlder` and their comments — is untouched: the script replaces one line, matched by `/^export const VERSION = "[^"]*"$/m`, and fails loudly if that line is not found exactly once.

- [ ] Write `test/scripts/sync-version.test.ts`: the replacement is exact on a copy of the real file; a file with no `VERSION` line throws; `--check` agrees with `test/core/version.test.ts` on the committed state.
- [ ] Implement the script; add `sync-version` to both `package.json`s.
- [ ] Verify: `pnpm sync-version --check` → exit 0 (both are `0.0.0` today).
- [ ] Commit.

## Task 3: `ci.yml` — the hard gates

**Files:** create `.github/workflows/ci.yml` · create `.github/dependabot.yml`

**Behaviour:** Every push to `main` and every pull request runs two jobs that must pass.

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

**`check`** (ubuntu-latest, Node 24): `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm manifest --check`, `pnpm readme --check`, `pnpm sync-version --check`. Each as its own step, so a failure names itself.

**`test`** (ubuntu-latest, `node-version: [20, 24]`): `pnpm install --frozen-lockfile`, `pnpm build` (several tests run `dist/cli.js`; `test/build.test.ts` builds it too, but building once up front keeps the first test from paying 60 s), then `pnpm test`.

Node 20 is the floor spec §16 sets and has never been run; Node 24 is what the machine the whole project was written on uses. Both matter.

`bun` is deliberately **not** installed in `test`, so `test/binary.test.ts` skips — the binary gets its own job in Task 4, and building it four times inside the matrix would double the suite's wall time for no extra signal.

Setup steps, once, as a shared prefix in both jobs:

```yaml
- uses: actions/checkout@v4
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: ${{ matrix.node || 24 }}, cache: pnpm }
```

- [ ] Write the workflow.
- [ ] Write `.github/dependabot.yml`: weekly `github-actions` and `npm` (root and `packages/rulecast`), grouped, so pinned action versions do not rot.
- [ ] Verify locally, the only way a workflow can be verified before it runs: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm manifest --check && pnpm readme --check && pnpm sync-version --check` all exit 0, and `pnpm build && pnpm test` passes. Then check the YAML parses: `node -e "console.log(require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8')).jobs)"`.
- [ ] Commit. **The workflow only runs once the commit is pushed** — after pushing, `gh run watch` (or `gh run list --workflow ci.yml`) until it is green, and fix what the runner finds before starting Task 4. This is the first time the suite has run on anything but one machine; expect it to find something.

## Task 4: the binary, and the job that proves it works

**Files:** create `packages/rulecast/scripts/build-binary.ts` · modify `packages/rulecast/package.json`, `package.json` · modify `.github/workflows/ci.yml`

**Behaviour:** `pnpm binary` produces `packages/rulecast/dist/rulecast-<platform>-<arch>` (`rulecast-darwin-arm64`, `rulecast-linux-x64`, …) from the current machine, and prints its path and size. It runs `pnpm build` first, then `bun build dist/cli.js --compile --outfile <target>`.

The CI job **`binary`** runs on the four runners of Decision 2, builds it, and runs the one check that matters — the binary works with no `node_modules` anywhere in reach:

```yaml
binary:
  strategy:
    fail-fast: false
    matrix:
      include:
        - { os: ubuntu-latest,   target: linux-x64 }
        - { os: ubuntu-24.04-arm, target: linux-arm64 }
        - { os: macos-latest,    target: darwin-arm64 }
        - { os: macos-13,        target: darwin-x64 }
  runs-on: ${{ matrix.os }}
```

with `oven-sh/setup-bun@v2` added to the shared setup, `pnpm binary`, then `RULECAST_BINARY=<path> pnpm vitest run test/binary.test.ts`.

`test/binary.test.ts` currently builds the binary itself in `beforeAll` (`test/binary.test.ts:39-46`). Give it a `RULECAST_BINARY` escape hatch: when the variable names an existing file, use it and skip the build. Locally, with no variable set, it behaves exactly as it does today. That keeps one definition of "the binary works" for both the machine and CI.

- [ ] Write `scripts/build-binary.ts`; add `binary` to both `package.json`s. The output name comes from `process.platform` and `process.arch`, so the script needs no argument and the workflow's `matrix.target` is only a label.
- [ ] Modify `test/binary.test.ts` for `RULECAST_BINARY`; the existing assertions do not change.
- [ ] Add the `binary` job to `ci.yml`.
- [ ] Verify locally: `pnpm binary` → a file in `dist/`; `RULECAST_BINARY=packages/rulecast/dist/rulecast-darwin-arm64 pnpm vitest run test/binary.test.ts` → passes; `pnpm vitest run test/binary.test.ts` with no variable → still passes, building its own.
- [ ] Confirm the binary is not tracked: the root `.gitignore` already has `dist/`, so `git status --short` must stay clean after `pnpm binary`.
- [ ] Commit, push, watch the four runners. A failure on `ubuntu-24.04-arm` or `macos-13` is the real finding here: those are the platforms whose native modules have never been exercised.

## Task 5: the perf job that reports and never fails

**Files:** modify `packages/rulecast/test/perf/edit-hook.test.ts:93-119` · modify `.github/workflows/ci.yml` · modify `docs/specs/2026-09-15-rulecast-design.md` §13

**Behaviour:** `RULECAST_PERF=1 RULECAST_PERF_GATE=0 pnpm vitest run test/perf` measures 50 edit events, prints `edit hook: p50 <n> ms, p95 <n> ms`, and passes whatever the numbers are. Without `RULECAST_PERF_GATE=0` — which is how `pnpm test:perf` runs it locally — the `expect(p95).toBeLessThan(500)` assertion still applies.

The test keeps its existing shape; the last line becomes conditional and the console line always prints. The assertion that each event produced the expected finding stays unconditional in both modes: a perf run that measured a hook doing nothing would be worse than no measurement.

The CI job **`perf`** (ubuntu-latest, Node 24, not gating anything):

```yaml
- run: pnpm build
- run: RULECAST_PERF=1 RULECAST_PERF_GATE=0 pnpm test:perf 2>&1 | tee perf.log
- run: |
    echo "### edit hook performance" >> "$GITHUB_STEP_SUMMARY"
    echo '```' >> "$GITHUB_STEP_SUMMARY"
    grep 'edit hook:' perf.log >> "$GITHUB_STEP_SUMMARY" || echo "no measurement" >> "$GITHUB_STEP_SUMMARY"
    echo '```' >> "$GITHUB_STEP_SUMMARY"
```

`pnpm test:perf` currently hard-codes `RULECAST_PERF=1`; it also needs `oxlint` (a workspace devDependency, forwarded by `linkTool`) — no extra setup.

Spec §13's **Perf test** paragraph is rewritten. Replace "CI runs a fixture project with 30 rules … and fails if p95 exceeds 500 ms" with: the fixture and the replay are the same, `pnpm test:perf` on a developer machine is the gate, and CI runs the same fixture on a shared runner and reports p50/p95 into the job summary without asserting, because a shared runner spawning one subprocess per external tool per event is several times slower than the hardware the 500 ms promise is made about. Keep the measured numbers already recorded and add the date.

- [ ] Modify the test.
- [ ] Verify: `RULECAST_PERF=1 RULECAST_PERF_GATE=0 pnpm test:perf` → passes and prints the line; `pnpm test:perf` → still asserts (it should pass on this machine, ~171/214 ms).
- [ ] Add the `perf` job; rewrite spec §13.
- [ ] Commit and push; check the job summary shows the runner's numbers. **Record them in spec §13** as a second measured row — the whole point of this task is that the project stops having one machine's numbers only.

## Task 6: changesets

**Files:** create `.changeset/config.json`, `.changeset/README.md` · modify `package.json` · modify `packages/rulecast/package.json`

**Behaviour:** `pnpm changeset` records a change; `pnpm version-packages` applies every pending changeset, bumps `packages/rulecast/package.json`, writes `CHANGELOG.md`, and re-runs `sync-version`; `pnpm release` builds and publishes.

- [ ] `pnpm add -Dw @changesets/cli` and `pnpm changeset init`.
- [ ] `.changeset/config.json`: `"access": "public"` — the `@syv-ai` scope is private by default on npm and a scoped package will not publish without it — plus `"baseBranch": "main"` and `"commit": false`. `"ignore"` stays empty: `packages/rules-*` have no `package.json`, so changesets never sees them.
- [ ] Root scripts:

  ```json
  "changeset": "changeset",
  "version-packages": "changeset version && pnpm sync-version",
  "release": "pnpm build && changeset publish"
  ```

- [ ] `packages/rulecast/package.json` gains the fields an npm page needs and a publish requires:

  ```json
  "repository": { "type": "git", "url": "git+https://github.com/syv-ai/rulecast.git", "directory": "packages/rulecast" },
  "homepage": "https://github.com/syv-ai/rulecast#readme",
  "bugs": "https://github.com/syv-ai/rulecast/issues",
  "keywords": ["claude-code", "coding-agent", "lint", "conventions", "agents", "hooks", "ast-grep"],
  "publishConfig": { "access": "public" }
  ```

- [ ] Verify on a throwaway copy, so nothing has to be undone in the working tree: `cp -R . "$(mktemp -d)/rulecast"`, then in the copy write a scratch changeset and run `pnpm version-packages`. Expect `0.1.0` in both `packages/rulecast/package.json` and `src/core/version.ts`, and `pnpm vitest run test/core/version.test.ts` green. Delete the copy. The real 0.1.0 changeset is Task 8's.
- [ ] Commit.

## Task 7: `release.yml` and `binaries.yml`

**Files:** create `.github/workflows/release.yml`, `.github/workflows/binaries.yml`

**Behaviour:**

**`release.yml`**, on push to `main`, `permissions: { contents: write, pull-requests: write, id-token: write }`:

```yaml
- uses: changesets/action@v1
  with:
    version: pnpm version-packages
    publish: pnpm release
    title: "release: version packages"
    commit: "release: version packages"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

with `.npmrc` written from `NPM_TOKEN` before the action, and `npm` ≥ 11 so npm provenance works with `id-token: write` (add `NPM_CONFIG_PROVENANCE: true`). With pending changesets it opens or updates the version PR; with none and an unpublished version it publishes and creates the git tag and the GitHub Release.

**`binaries.yml`**, on `release: { types: [published] }`, the same four-runner matrix as Task 4: check out the release tag, `pnpm install --frozen-lockfile`, `pnpm binary`, then

```yaml
- run: gh release upload "${{ github.event.release.tag_name }}" "packages/rulecast/dist/rulecast-${{ matrix.target }}" --clobber
  env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

plus a `sha256` checksum file per binary, uploaded alongside — a downloaded binary nobody can verify is a binary nobody should run.

**Two secrets this plan cannot create:** `NPM_TOKEN` (an automation token for the `@syv-ai` scope) must exist in the repository's secrets, and `npm whoami` on this machine currently fails with `ENEEDAUTH` although `npm access list packages @syv-ai` answers — so the publishing identity is not established here either. Both go on 7c's hand-over list. Until `NPM_TOKEN` exists, `release.yml` will open version PRs and fail at publish; that is the correct order.

- [ ] Write both workflows.
- [ ] Verify the YAML parses, as in Task 3. Verify the tag/asset names the two workflows agree on by grepping both for `rulecast-`: `binaries.yml`'s `matrix.target` must equal what `scripts/build-binary.ts` derives from `process.platform`/`process.arch` on that runner. This is the one place where a typo is invisible until release day — write the mapping down in `build-binary.ts` as an exported constant and have the workflow's matrix use the same four strings.
- [ ] Commit and push. `release.yml` will run on the push and should open a "release: version packages" PR only once Task 8 adds a changeset — with none pending it exits cleanly.

## Task 8: the 0.1.0 changeset and a publish dry run

**Files:** create `.changeset/<name>.md` · modify `docs/specs/2026-09-15-rulecast-design.md` §16

**Behaviour:** A changeset describing 0.1.0 exists, and the package publishes cleanly in a dry run.

- [ ] Write the changeset: `"@syv-ai/rulecast": minor` and a short summary of what 0.1 is — the pre-commit-style config and rule repos, six detectors, the Claude Code adapter, the eleven commands, the rule packages, agent docs, the npm package and the standalone binary. This is what lands in `CHANGELOG.md` and on the GitHub Release, so write it for someone who has never seen the project.
- [ ] `pnpm build && cd packages/rulecast && pnpm publish --dry-run --no-git-checks` → inspect the printed file list: it must contain `dist/` and `README.md` and nothing else of consequence, and the tarball must be well under 5 MB. Anything unexpected means `files` or `.npmignore` needs a look.
- [ ] Spec §16: add one sentence to the distribution bullets recording that binaries are built natively per platform because a cross-compiled one would embed the wrong native module, and that Windows is not supported in 0.1.
- [ ] Verify: `pnpm test && pnpm typecheck && pnpm lint` clean.
- [ ] Commit and push; confirm `release.yml` opens the version PR. **Do not merge it** — 7c hands the release over.

---

## End-to-end verification

1. `gh run list --limit 5` shows `ci` green on `main` for the `check`, `test` (Node 20 and 24), `binary` (four runners) and `perf` jobs.
2. The `perf` job's summary shows a p50/p95 pair from a GitHub runner, and spec §13 records it next to the M3 Pro numbers.
3. `gh pr list` shows one open PR titled `release: version packages` bumping `@syv-ai/rulecast` to `0.1.0`, with `src/core/version.ts` bumped in the same diff.
4. On this machine: `pnpm binary && ./packages/rulecast/dist/rulecast-darwin-arm64 --help` prints the usage text including the `doctor` line from 7a.
5. `cd packages/rulecast && pnpm publish --dry-run --no-git-checks` exits 0 and lists `dist/` plus `README.md`.
