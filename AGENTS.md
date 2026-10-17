# AGENTS.md

rulecast delivers a project's conventions to coding agents while they work. It runs as agent hooks: when an edit breaks a rule, the agent gets the finding and the doc section the rule cites in the same turn. Runs from CLI for git hooks and CI too.

## Commands

```sh
All standard pnpm commands, like install, build etc.
pnpm perf               # edit-hook latency budget (p95 < 500 ms)
pnpm binary             # standalone binary with bun
```

To run CLI from source: `packages/rulecast/node_modules/.bin/tsx packages/rulecast/src/cli.ts <command>`.

Docs site (`packages/site`, Astro Starlight, private):

```sh
pnpm --filter @syv-ai/rulecast-site dev     # or build / preview / test / typecheck
```

### Generated files: regenerate, never hand-edit

CI checks each of these with `--check`:

- `pnpm manifest` → `.rulecast-rules.yaml`, the catalog manifest built from `packages/rules-*/rules.yaml`.
- `pnpm lenses` → `agents/lenses/`, the pages agents read from the lens catalog in `packages/lenses/` (it validates the catalog first).
- `pnpm readme` → `packages/rulecast/README.md` and `LICENSE`, mirrored from the root ones. Edit the root `README.md`, then run this.
- `pnpm sync-version` → `packages/rulecast/src/core/version.ts` from `package.json`.

### Git hooks

- **pre-commit** (lefthook) runs biome with `--write` on staged files, then **rulecast on its own staged files**, then typecheck. The repository's own rules are in `.rulecast-config.yaml`.
- **pre-push** runs `pnpm test`.

### Releases

- Releases go through changesets: `pnpm changeset`, then pick `@syv-ai/rulecast`. On `main`, `release.yml` opens the version PR. When that is merged it publishes to npm, tags `vX.Y.Z`, cuts the GitHub Release, and then *calls* `binaries.yml` and `pages.yml`.
- Tags must be bare `vX.Y.Z`. The repository is also a rule repo, resolved by tag.

## Architecture

### CLI package (`packages/rulecast/src`)

Every hook invocation is a **fresh process**, with no daemon. Each event flows through `core/pipeline.ts`. See CLI --help for overview.

Where things live:

- `adapters/` knows about one agent each (`claude-code`, `cli`). The core is agent-neutral: shell and session-start events are mapped by the adapter, but the working-tree comparison and the sweep live in `core/session/tree.ts`.
- `detectors/` holds `regex`, `path`, `ast-grep`, `command`, `hook` (pre-commit and lefthook hooks), `linter` (ruff, oxlint, eslint, gitleaks) and `llm`. Tool output is read in one place, `core/detection/outputs/`.
- `testing/` holds the exported detector and adapter contract suites.
- `commands/` has one file per CLI command. `init/` is the interactive setup.
- Catalog rules live in `packages/rules-general`, `rules-loop-safety`, `rules-python` and `rules-react`, each with `rules.yaml` and the docs its rules cite.
- `agents/` holds docs written for coding agents (`SETUP.md`, `DRAFT-RULES.md`, `reference/`). URLs to them are pinned to a tag, never to `main`; a test enforces this.


Tests sit under `packages/rulecast/test/` and mirror `src/`. Renderer and baseline behaviour is pinned by golden corpora in `test/goldens/`; recorded agent payloads are in `test/payloads/`.

### Docs site (`packages/site`)

Pages are generated at build time from `README.md` and `agents/` (`scripts/sources.ts` maps README sections)

## Conventions

None are written down yet. They are being settled with the developer through `agents/CONVENTIONS.md` (plan 14); until then `.rulecast-config.yaml` has no rules.
