# rulecast Plan 7c — the public repository and the the dogfood Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository fit to be public and prove rulecast works on a codebase nobody wrote it against. The dogfood is the last item in 0.1 that can still say the design is wrong; the public flip is what makes the agent-onboarding path — `agents/SETUP.md` and the drafting prompt, both of which are raw GitHub URLs — work at all.

**Approach:** Sweep the repository for anything that should not be published and for links that will break, then hand the user one `gh repo edit` line: **this plan never changes the repository's visibility.** Then dogfood on a throwaway local clone of the dogfood target (a local path, kept out of this repository) — never its working tree — by walking the real onboarding path an agent would walk: `init`, then `agents/DRAFT-RULES.md` against its `CLAUDE.md`, then a full `run`. Whatever that turns up is fixed in rulecast and written down.

**Stack:** `gh`, git, the built rulecast CLI.

Prerequisite: `2026-09-22-rulecast-07a-doctor.md` and `07b-ci-release.md`. This is the last part of plan 7.

---

## Decisions this plan implements

1. **Prepare for public; the user flips it.** (The user's decision, 2026-09-22.) Visibility is irreversible in practice — a repository that has been public has been cloned and indexed — so this plan produces the evidence and the exact command, and stops. `gh` on this machine is authenticated as `nthomsencph` with `admin:org` and `delete_repo` scopes, so nothing stands between a careless call and a public repository except this rule.
2. **The dogfood runs on a local clone, never on the user's checkout.** `git clone --local $DOGFOOD_TARGET <tmp>` gives a complete, independent repository in a second and leaves nothing behind in theirs — not even a `git worktree` registration. `init` writes `.rulecast-config.yaml` and `.claude/settings.json`, and the drafting loop writes more; none of that belongs in a repository whose last commit is a release.
3. **The dogfood's output is a document in this repository, not rules in theirs.** Adopting rulecast in the dogfood target is their decision on their timeline. What plan 7 owes 0.1 is the evidence: the rules that were drafted, what they found on 1,945 real files, and every place rulecast made the job harder than it should have been. The drafted config is recorded verbatim in that document so it can be handed over whole later.
4. **A dogfood finding is a defect until proven otherwise.** The temptation at the end of a plan is to write findings down as "known limitations". Spec §15 lists dogfooding as a test. Anything that a developer would call a bug gets fixed in Task 6 before 0.1 is called done; anything deferred is deferred explicitly, with a reason, into spec §17's 0.2 row.

## Conventions

Same as 7a and 7b. Two that matter more here:

- **Never commit, push or otherwise write in the dogfood target (a local path, kept out of this repository).** Read it; clone it; leave it exactly as found. Check with `git -C $DOGFOOD_TARGET status --short` before and after — identical output, both times.
- **Never run `gh repo edit`, `gh repo delete`, or anything else that changes the GitHub repository's settings.** Print the command for the user instead.

## File structure

| File | Responsibility |
|---|---|
| `.gitignore` | Gains `.claude/settings.local.json`, `.claude/worktrees/`, `.dash/`, and the compiled binaries |
| `packages/rulecast/test/agents-docs.test.ts` | Gains a check that no agent-doc URL points at a path outside the repository *and* that the ref used is a tag form, not `main` |
| `docs/dogfooding/2026-09-22-private-platform.md` | The dogfood record: the drafted rules, what ran, what was found, what it cost |
| `docs/specs/2026-09-15-rulecast-design.md` | §15's dogfooding line gains the result; §17's 0.1 row is ticked and 0.2 gains whatever was deferred |
| `docs/plans/2026-09-15-rulecast-00-index.md` | Row 7 marked done |
| `HANDOVER.md` *(temporary, not committed)* | The commands the user runs: `gh repo edit`, the `NPM_TOKEN` secret, merging the version PR |

---

## Task 1: the sweep

**Files:** modify `.gitignore` · no other code changes

**Behaviour:** Nothing in the repository embarrasses or endangers anyone when it becomes world-readable, and the exclusions that currently work do so because of the repository, not because of one machine's configuration.

Already established (2026-09-22, on `4a6a754`): 291 tracked files; `git grep` for `sk-…`, `ghp_…`, `AKIA…` and PEM private-key headers finds nothing; no tracked file contains `/Users/nicolaibthomsen`. So the sweep's real work is the untracked side.

Two concrete hazards found:

- **`.dash/`** is untracked and matched by no ignore rule anywhere. A `git add -A` would commit it. It is not rulecast's; leave the directory alone, ignore the path.
- **`.claude/`** *looks* ignored but is not the repository's doing: `.claude/worktrees/` is in `.git/info/exclude` (local, never cloned) and `.claude/settings.local.json` is matched by `~/.config/git/ignore` (this machine only). On any other clone both are untracked and stageable. `.claude/settings.local.json` is personal settings by name and convention; `.claude/worktrees/` holds entire working copies of the repository.

- [ ] Add to `.gitignore`, with a comment on each group:

  ```gitignore
  node_modules/
  dist/

  # Personal agent settings and agent worktrees; .claude/settings.json is shared and stays tracked.
  .claude/settings.local.json
  .claude/worktrees/

  # Not ours.
  .dash/
  ```

- [ ] Confirm `git status --short` now shows a clean tree apart from this plan's own work, and that `git check-ignore -v .dash .claude/settings.local.json` names `.gitignore` rather than a file under `$HOME`.
- [ ] Re-run the secret scan on the full history, not just the working tree — a secret removed in a later commit is still public once the repository is:

  ```sh
  git log --all -p | grep -nEi '(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key["'\'':= ]+[A-Za-z0-9/_-]{20,})' | head -40
  ```

  Expect no hits. If there is one, **stop and tell the user**: a rewrite of history is theirs to decide, and it must happen before the repository is public, not after.
- [ ] Read `docs/plans/` and `docs/specs/` with a publishing eye: they are going public with everything else, and they record decisions, costs and dates. Nothing seen so far needs redacting; confirm it, and say so in the hand-over rather than silently.
- [ ] Verify: `pnpm test` → passes. Commit.

## Task 2: every agent-doc URL will resolve

**Files:** modify `packages/rulecast/test/agents-docs.test.ts` · possibly `packages/rulecast/src/init/draft-prompt.ts`

**Behaviour:** The suite already checks that every `raw.githubusercontent.com/syv-ai/rulecast/<ref>/<path>` and `github.com/syv-ai/rulecast/blob/<ref>/<path>` URL in `agents/` and `src/` names a path that exists in the repository (`test/agents-docs.test.ts:74-84`). What it does not check is the *ref*: a URL pinned to `main` resolves only as long as `main` has that file, and one pinned to a tag resolves forever. The drafting prompt interpolates the catalog's rev, which is a tag; nothing stops a future doc from hard-coding `main`.

- [ ] Add a test: for every rulecast URL in `agents/` and `src/`, the ref segment is either a tag-like string (`v<major>.<minor>.<patch>`), a template placeholder (`<tag>`, `${…}`, `%s`), or appears in an explicit allowlist in the test with a comment saying why. `main` is not allowed. Fix whatever it catches — the two occurrences in `test/agents-docs.test.ts:65-67` are the test's own fixture strings and are outside `agents/` and `src/`, so they are unaffected.
- [ ] Check by hand what the tests structurally cannot: every one of the four `agents/` docs and the drafting prompt names a URL whose `<path>` exists **at the tag that will be cut**, not only on `main`. At 0.1.0 those are the same commit, so this is a read-through, not a fetch. Record the five URLs and their paths in the hand-over document so the user can spot-check two of them in a browser the moment the repository is public.
- [ ] Verify: `pnpm vitest run test/agents-docs.test.ts` → passes. Commit.

## Task 3: the hand-over

**Files:** create `HANDOVER.md` at the repository root — **not committed**, deleted at the end of the plan

**Behaviour:** One document holding every action that is the user's to take, in the order they have to happen, each a command that can be pasted.

- [ ] Write it, with these sections:

  1. **Make the repository public** — what was swept and what was found (Task 1), then:

     ```sh
     gh repo edit syv-ai/rulecast --visibility public --accept-visibility-change-consequences
     ```

     and the two URLs to open afterwards to confirm the agent docs resolve (Task 2).
  2. **Repository metadata** — description is already set; add topics and the homepage so the repository is findable:

     ```sh
     gh repo edit syv-ai/rulecast --homepage https://github.com/syv-ai/rulecast#readme \
       --add-topic claude-code --add-topic coding-agents --add-topic linter --add-topic ast-grep --add-topic conventions
     ```

  3. **npm** — `npm whoami` fails on this machine with `ENEEDAUTH` although `npm access list packages @syv-ai` answers, so the publishing identity was never confirmed here. The user needs to: confirm publish rights on the `@syv-ai` scope, create an automation token, and add it as the `NPM_TOKEN` repository secret (`gh secret set NPM_TOKEN`). Without it `release.yml` opens version PRs and fails at publish.
  4. **Cut 0.1.0** — merge the open `release: version packages` PR; `release.yml` publishes to npm, tags, and cuts the GitHub Release; `binaries.yml` then attaches four binaries and their checksums. What to check on each.
  5. **What the dogfood found** — a pointer to `docs/dogfooding/2026-09-22-private-platform.md` and the one-paragraph verdict.

- [ ] Do **not** run any command in it.

## Task 4: dogfood — onboarding

**Files:** none in this repository yet; work happens in a throwaway clone

**Behaviour:** rulecast is set up in a clone of the dogfood target the way an agent would set it up, and every friction is written down as it happens.

The target, at `8759f51ab` (2026-09-17, `chore(release): v1.98.0`): 1,945 tracked files — 854 `.py`, 444 `.tsx`, 401 `.ts` — a `backend/` and a `frontend/`, a `docs/` directory, an `azure-pipelines.yml`, and **a standalone `CLAUDE.md` with no `AGENTS.md`**, which is one of the doc cases `init`'s detection handles explicitly (spec §12, `init` step 1) and has only ever been tested against a fixture.

- [ ] `git -C $DOGFOOD_TARGET status --short` → record the output; it must be identical at the end of Task 6.
- [ ] Clone and set up:

  ```sh
  DOG=$(mktemp -d)/the dogfood target
  git clone --local $DOGFOOD_TARGET "$DOG"
  cd "$DOG" && git log --oneline -1   # expect 8759f51ab
  ```

- [ ] Run `doctor` **before** `init`, on a repository with no config: it must give the "no `.rulecast-config.yaml`" error and exit 2 rather than throwing. First real use of 7a's Decision 5.
- [ ] Run the drafting agent's own first step, verbatim from `agents/SETUP.md`, but against the local build rather than npm:

  ```sh
  node ~/repos/agentic-linting/packages/rulecast/dist/cli.js init --yes --agent claude-code
  ```

  Record: what it detected (stack tags, docs, agents), which catalog rules it preselected, what it wrote, and what the drafting prompt said. The catalog fetch reaches `https://github.com/syv-ai/rulecast` and needs the repository to be **public or reachable over SSH** — if it fails, `init` warns and skips the step, which is itself a result worth recording. If it does fail, re-run with `RULECAST_CATALOG=~/repos/agentic-linting` pointing at the local checkout, so the rest of the path is still exercised.
- [ ] Run `doctor` again, now on a configured project, and read every line of it critically. This is the first time it has met a project it was not written against: 854 Python files, `uv`, no `node_modules` at the root, `ruff` configured in `backend/pyproject.toml`, `oxlint` absent. Every line that is wrong, confusing or missing is a defect for Task 6.
- [ ] Run `node …/cli.js run --all-files --format terminal` and time it. Record the wall time, the number of findings, and how readable the output is at that volume — `--all-files` over 1,945 files with the catalog's rules is the largest run rulecast has ever done.
- [ ] Write everything so far into `docs/dogfooding/2026-09-22-private-platform.md` as it happens, not from memory afterwards.

## Task 5: dogfood — drafting the project's own rules

**Files:** `docs/dogfooding/2026-09-22-private-platform.md`

**Behaviour:** The four conventions spec §15 names are drafted as rules by following `agents/DRAFT-RULES.md` exactly, as the developer's own agent would, and each is measured against the real codebase.

the target's `CLAUDE.md` states them (lines 11-18 and the Frontend section):

| Convention | The doc's words | Expected detector |
|---|---|---|
| Service/CRUD layering | "DB access via CRUD only → never query Session directly in services" | `regex` or `ast-grep` over `backend/app/services/` |
| No `HTTPException` in services | "Services use custom exceptions (`app/core/exceptions.py`) → never raise HTTPException in services" | `regex` over `backend/app/services/` |
| No edits to the generated client | "Auto-generated — `npm run generate-client` (DO NOT EDIT `src/client/`)" | `path` over `frontend/src/client/` |
| `useUnsavedWork` on close paths | "a surface holding unsaved user input declares it with `useUnsavedWork` … every close path awaits the hook's `confirmClose()`" | `llm`, `verify` only — nothing mechanical expresses "a surface holding unsaved user input" |

The last one is the point of the exercise: it is exactly the case the `llm` detector exists for, and it has never been pointed at a question a person actually wrote.

- [ ] Follow `agents/DRAFT-RULES.md` step by step — including its instruction to read a few of the files each convention talks about before writing the pattern. Note every place the document is wrong, vague or missing a step for this project. The document is as much under test as the CLI.
- [ ] For each rule: add it under `repo: local`, run `rulecast validate`, then `rulecast run <id> --all-files --format json`, and record **how many existing matches it has**. A rule with 300 pre-existing matches is not a rule anyone will keep; that is a finding about the rule, and possibly about baseline classification.
- [ ] Draft the two conventions that are *not* mechanically checkable as `stages: [touch]` context rules — "RBAC and sharing isolation is CRITICAL — always test both" and "user-facing errors always in Danish" — and check that they deliver as context on a touch rather than as findings.
- [ ] Run the `llm` rule for real, once, with `provider: claude-code` and `model: haiku`, over a small `--files` set of three or four dialog components. Record the wall time, what it found, and whether what it found is true. **This is the only place in plan 7 that calls a model**; it is a CLI run by hand, not a test.
- [ ] Record the complete drafted `.rulecast-config.yaml` verbatim in the dogfood document.

## Task 6: fix what the dogfood found

**Files:** whatever Tasks 4 and 5 turn up · `docs/dogfooding/2026-09-22-private-platform.md` · `docs/specs/2026-09-15-rulecast-design.md` §15, §17 · `docs/plans/2026-09-15-rulecast-00-index.md`

**Behaviour:** Every defect the dogfood exposed is either fixed with a test that would have caught it, or deferred on the record with a reason.

- [ ] Triage the findings into: **fix now** (anything a developer would call a bug — wrong output, a misleading message, a crash, a detector that misses the obvious case), **fix in a doc** (`agents/DRAFT-RULES.md` and `agents/SETUP.md` are the two documents the dogfood road-tested), and **defer** (a feature that is genuinely 0.2).
- [ ] Fix the first group, test-first, one commit per fix. Use the systematic-debugging skill on anything whose cause is not obvious — plans 5 and 6 both found that a "small" dogfood-style defect was a real one underneath.
- [ ] Finish `docs/dogfooding/2026-09-22-private-platform.md`: what was set up, what was drafted, what was found, what was fixed, what was deferred, and a straight answer to the question the exercise exists to ask — **would a developer on this project keep these rules on?**
- [ ] Spec §15: the dogfooding line gains "Done 2026-09-22; see `docs/dogfooding/2026-09-22-private-platform.md`" and names the four conventions actually drafted, if they differ from the four it names now.
- [ ] Spec §17: anything deferred joins the 0.2 row with its reason.
- [ ] Plan index: row 7's `Status` becomes `Done (2026-09-22), in three parts executed in order: 2026-09-22-rulecast-07a-doctor.md, 07b-ci-release.md, 07c-public-dogfood.md`, with the edit-hook p50/p95 recorded as every other row does.
- [ ] Remove the clone: `rm -rf "$(dirname "$DOG")"`. Confirm `git -C $DOGFOOD_TARGET status --short` is byte-identical to Task 4's recording.
- [ ] Verify: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:perf` all clean; `ls ~/.cache/rulecast` → no such directory.
- [ ] Commit and push.

## Task 7: the final review

**Files:** none

**Behaviour:** A fresh pair of eyes reads plan 7's whole diff before 0.1 is called done. This paid for itself at the end of plan 5 and again at the end of plan 6, where it found three real defects after the plan was already marked done — a provider fallback that could never fire, a cache key missing `base_url`, and a test that pinned a broken Ollama URL as correct.

- [ ] `git diff <the commit before 7a> HEAD` and review it with fresh context, looking for: a check that can never fail, a test that asserts the bug, an error message that names the wrong thing, and anything in the new workflows that only works because of something on this machine.
- [ ] Fix what it finds, test-first.
- [ ] Hand `HANDOVER.md` to the user in the final report, then delete the file — it is a message, not a document the repository keeps.

---

## End-to-end verification

1. `git status --short` in this repository: clean. `git check-ignore -v .dash .claude/settings.local.json` names `.gitignore`.
2. `git -C $DOGFOOD_TARGET status --short` is identical to what it was before Task 4, and `git -C $DOGFOOD_TARGET worktree list` shows only their own worktrees.
3. `gh repo view syv-ai/rulecast --json visibility` still says `PRIVATE` — this plan did not flip it.
4. `docs/dogfooding/2026-09-22-private-platform.md` exists and answers whether a developer on that project would keep the rules on.
5. The plan index's row 7 says Done, and every row in spec §17's 0.1 list is true or has been moved to 0.2 with a reason.
6. The user has `HANDOVER.md`'s contents and can, in four commands, make the repository public, set the npm secret, merge the version PR and watch 0.1.0 publish.
