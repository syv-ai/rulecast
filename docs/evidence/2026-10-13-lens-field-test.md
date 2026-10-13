# The lens catalog in the field, 2026-10-13

Six independent agents each took one real codebase and the lens catalog (148 entries: 56 laws, 22 patterns, 32 anti-patterns, 38 smells), consulted through a one-line-per-lens index, plus a note on four methodologies. None of them saw how the catalog was made. Each one:
1. oriented in the codebase;
2. chose a methodology;
3. picked 8 to 15 lenses;
4. applied them with `path:line` evidence, and either worded a convention or argued, from the counter-view, for leaving the code alone;
5. wrote the interview questions it would ask;
6. checked 5 or 6 factual claims;
7. judged the hub.

The test was whether an agent can look at a codebase, consult the catalog and reason about what would work.

| Codebase | Kind, language | Methodology chosen | Most useful entry |
|---|---|---|---|
| rulecast | CLI as agent hooks, TypeScript | Led by quality attributes, with Refactoring to Patterns | `long-method` |
| full-stack-fastapi-template | web API and front end, Python and TypeScript | Domain pattern language (FastAPI's idiom) | `data-class` |
| spring-petclinic | web app, Java | Domain pattern language (Spring MVC) | `duplicate-code` with `dry` |
| eShopOnWeb | Clean Architecture reference app, C# | Domain pattern language (Clean Architecture, DDD-lite) | `mock-everything` |
| glow | CLI and TUI, Go | Domain pattern language (Elm Architecture), by analogy | `lava-flow` with `dead-code` |
| mdBook | CLI, library and plugin host, Rust | Led by quality attributes (compatibility), with Refactoring to Patterns | `fragile-test` |

## What held

- **Agents could apply it.** All six produced concrete conventions with evidence, and as many decisions to leave code alone. Applying the lenses turned up likely real bugs in four of the codebases:
  - PetClinic: a duplicate-name check that fails on MySQL, and flash messages that are never shown.
  - eShopOnWeb: any signed-in user can read any order, and checkout commits three times with no transaction.
  - glow: unclosed response bodies, a `--config` flag with no effect, and a goroutine started per render.
  - mdBook: wildcard match arms that panic.
- **The counter-view is the most valuable field.** In every report, the most useful entry was one whose counter-view stopped a recommendation an agent would plausibly have made:
  - not flagging boundary DTOs as anemic (`data-class`);
  - not moving away from snapshot tests whose output is the contract (`fragile-test`);
  - not extracting copies that will diverge (`dry`, `duplicate-code`);
  - not flagging DI interfaces that exist for test fakes (`speculative-generality`);
  - not recommending State objects in an Elm Architecture app (`state`).
- **Facts mostly held.** Of 36 claims checked, 31 held outright, and the rest were partial or wrong:
  - `switch-statements`, Rust note: wrong. It ignores `#[non_exhaustive]`, where downstream matches need wildcard arms.
  - `dry`: sourced only to a secondary compendium, without its origin in Hunt and Thomas. It also conflates DRY with Once and Only Once.
  - `law-of-demeter`: the verification pass made it worse. Fowler's wording in "Mocks Aren't Stubs" is "the Occasionally Useful Suggestion of Demeter"; a verifier wrongly called "Occasionally Useful" a misquote, and the trimmed version was applied.
  - Missing attributions: Hyrum Wright for Hyrum's law, Spolsky for leaky abstractions, Cohn for the test pyramid, Don Roberts for the rule of three.
  - Minor: RFC 9413's co-author, and "from Freeman and Pryce" overstating the origin of mockist testing.

## What failed

1. **Coverage of the layer real codebases are built in.** Five of the six reports name the same gap:
   - the enterprise application patterns: Repository, Service Layer, Transaction Script, Active Record, Unit of Work, Domain Model, Anemic Domain Model;
   - DDD's tactical patterns: Aggregate, Value Object, Specification, Domain Service;
   - Clean, hexagonal, ports-and-adapters architecture and its dependency rule;
   - dependency injection, CQRS, fat controllers;
   - Pipes and Filters, Microkernel and plugin architecture, Tolerant Reader.

   The GoF patterns, the best-filled file, contributed little to the web codebases.
2. **Missing cross-cutting families,** where the most serious findings had no lens:
   - **Security:** broken object-level authorisation, hard-coded secrets.
   - **Error handling:** swallowed errors, panic against `Result`, exceptions for control flow, inconsistent error contracts.
   - **Resource and lifecycle:** leaks, init-time side effects.
   - **API evolution and compatibility:** `#[non_exhaustive]`, deprecation, semver in practice.
   - **Testing, as positive patterns:** contract tests, golden and snapshot tests.
   - **Type-driven design:** functional core with imperative shell, illegal states made unrepresentable, parse don't validate.
   - **Comments:** stale and lying comments.
3. **Navigation.** All six reports say the same thing.
   - `applies_to.kinds` is empty on about 140 of 148 entries, so filtering by kind finds nothing. The instruction "don't pad `applies_to`" overcorrected.
   - The kinds vocabulary has no TUI or plugin-host kind. The `cli-devtool` kind exists, but almost nothing carries it.

   What the testers asked for:
   - a starter list per kind;
   - a column showing which entries have notes for a given language;
   - one file or anchor per entry, not a 190 KB YAML file;
   - `related` links in the index;
   - the canonical pick among overlapping lenses (`dry`, `duplicate-code` and `copy-and-paste-programming`; `yagni`, `speculative-generality` and `over-engineering`).
4. **Tells are biased toward Python and TypeScript, and toward single files.**
   - Go's dead code is live code the compiler accepts, so the `lava-flow` and `dead-code` tells find none of it.
   - `copy-and-paste-programming` looks only within a file.
   - `state`'s tell fires on idiomatic Bubble Tea code, which its own overuse section defends.
   - `magic-number`'s allowlist exempts the `limit: 100` that silently truncates lists.
   - `principle-of-least-astonishment`'s tell found nothing in any codebase.
5. **The laws are thin.**
   - All 56 have empty `forces` and `overuse`, and 54 have no language notes.
   - Most cite only the secondary compendium, without the original source.
   - The 34 interview-only laws, about teams and psychology, crowd a code-lens index.
6. **Language notes are lopsided.** Patterns carry seven languages each, which is mostly noise for a reader working in one. Smells, anti-patterns and laws carry almost none.
7. **Hygiene:**
   - **Authoring residue:**
     - "I'd keep this name as canonical" in `interface-bloat`;
     - an editor instruction leaked into `dogma-over-pragma`'s signs;
     - a duplicated sentence in `big-ball-of-mud`;
     - "the page's ten-line threshold".
   - **Schema not enforced:** `mock-everything`'s signs are one string, not a list.
   - **Name-history trivia:** it fills the first field an agent reads.

## What it means for the methodologies

The four methodologies were too coarse:
- Nobody chose DDD-led, and nobody chose Refactoring to Patterns on its own.
- Three testers stretched "domain pattern language" to cover a framework's idiom.
- Two paired "led by quality attributes" with Refactoring to Patterns for the code level.

What they proposed instead:
- **Contract-led** (mdBook, rulecast): list every surface outsiders depend on (public API, wire protocol, CLI text, config schema). Conventions are strict and reviewed at those surfaces, with Refactoring to Patterns everywhere else.
- **Framework-idiom-led** (FastAPI, PetClinic, glow): the framework's documented idiom is the pattern language, and each departure from it is a decision.
- **Exemplar or reference code** (PetClinic, eShopOnWeb, FastAPI): for code that others copy, conventions optimise for consistency and readability for the copier.
- **Start from what is already enforced** (glow): the linter config and its suppressions are conventions already, to be stated, not rediscovered.
- **A primary and a secondary:** one framing for the project's surfaces and one for its internal code.

## Round two, same day

The catalog was then fixed and widened. It went from 148 to 233 entries, adding:
- enterprise application patterns, DDD and architecture styles;
- security;
- errors, resources and API evolution;
- testing practice and type-driven design.

The 85 new entries were verified (45 findings, all applied). Every entry was tagged with the kinds it matters most for. The hub was rebuilt with a starter list per kind and one file per entry, and the methodologies were rewritten to six (Refactoring to Patterns, framework idiom, quality attributes, contract-led, DDD-led, exemplar), chosen as a primary and a secondary.

Six fresh agents ran the same brief on the same six codebases. They were not told about round one. **The test was not fully blind:** the coverage writers knew which six codebases the field test used, and some entries name them (below).

| Codebase | Round one | Round two | Most useful entry, round two |
|---|---|---|---|
| rulecast | quality attributes + R2P | quality attributes + contract-led | `tolerant-reader` |
| FastAPI template | "domain pattern language", stretched | framework idiom + exemplar | `user-enumeration` |
| PetClinic | "domain pattern language", stretched | framework idiom + exemplar | `mass-assignment` |
| eShopOnWeb | "domain pattern language", stretched | exemplar + framework idiom | `broken-object-level-authorization` |
| glow | "domain pattern language", by analogy | framework idiom + contract-led | `init-time-side-effects` |
| mdBook | quality attributes (compatibility) | contract-led + R2P | `tolerant-reader` |

### What improved

- **Coverage held.** In round one, the most serious findings had no lens. In round two, five of the six most useful entries are new ones, and each led straight to a real problem:
  - eShopOnWeb: any signed-in user can read any order, and a unit test locks it in.
  - FastAPI: signup reveals whether an account exists, while login and recovery hide it.
  - PetClinic: the nested pet fields can be bound through the owner form, bypassing the pet validator.
  - glow: config is read in `init()` before flags are parsed, so `--config` is ignored.
  - mdBook and rulecast: strict config parsing against tolerant payload parsing, and where the split is wrong.
- **The methodologies fit.** Every agent found a primary and secondary pair without stretching. Contract-led and framework idiom, both new, were chosen four times each. Each agent also said what the project already enforces before choosing: mdBook's `cargo semver-checks`, rulecast's latency budget and spec, PetClinic's checkstyle.
- **Facts held.** Of 39 claims checked, about 27 held outright and most of the rest were partial or unverifiable. All three that were outright wrong were claims about the test codebases themselves.

### What failed

1. **Contamination.** Entries name the test codebases: PetClinic in five, the FastAPI template in four, eShopOnWeb in several. Some of those verdicts are out of date or wrong (PetClinic is packaged by feature, not layered; its rules sit in controllers, not services; eShopOnWeb's core does reference an outward project). Worse, they tell an agent the code is fine and to stop looking. The catalog must not name specific codebases as verdicts.
2. **Starter lists are inconsistent across related kinds.** `fullstack-web` lists 64 lenses, too many to start from, yet it omits the security and boundary lenses that `web-api` has. `dry` was tagged only for infrastructure as code. `cli-devtool` left out `long-method` and `premature-optimization`, which decided the rulecast analysis. Per-entry tagging recorded where a lens is common, not where it matters most, and nothing checked consistency across kinds.
3. **Authoring residue and rendering bugs:**
   - a verifier's instruction pasted as content in `entity` and `error-handling-policy`;
   - `[object Object]` bullets in four entries;
   - a "Pryce's's" typo;
   - `applies_to` restrictions contradicting `matters_most_for` and the per-language notes.
4. **Tells still misfire on real code:**
   - the `swallowed-errors` empty-catch tell: 20 hits, about 3 real;
   - `switch-statements` on every Bubble Tea Update and View;
   - decorator missing concrete-typed wrappers;
   - hard-coded secrets missing short passwords;
   - user enumeration missing the signup case.
5. **Missing lenses named:**
   - Model-View-Update (the Elm Architecture);
   - a plugin protocol versioned apart from its package;
   - one type read strictly by one audience and tolerantly by another;
   - a test patch aimed at the wrong module;
   - validation rules drifting between front end and back end;
   - 401 against 403 semantics;
   - one environment flag that switches on several risky behaviours;
   - a methodology for a project that already has a numbered spec it cites from code.
