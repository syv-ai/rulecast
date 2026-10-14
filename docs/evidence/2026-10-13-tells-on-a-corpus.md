# The lens catalog's tells, run as rules on a corpus, 2026-10-13

A **tell** is a lens's claim that one file's text shows the problem, so a check could flag it. The best tells become rulecast rules. Two field tests found tells misfiring on real code; one empty-catch tell fired 20 times in one codebase for about 3 real cases. So the 30 tells on agent-prone lenses were turned into real rulecast rules and run over a corpus.

## How

- **Corpus:** twelve repositories, 9,660 files: rulecast, the FastAPI full-stack template, Spring PetClinic, eShopOnWeb, glow, mdBook, httpie, umami, lazygit, bat, mealie and jasontaylordev/CleanArchitecture.
- **Rules:** three agents each took 10 tells and wrote one rule per language the tell named. The detectors were regex, path and ast-grep; ast-grep covers only Python, JavaScript and TypeScript in rulecast, so Java, C#, Go and Rust were regex. Each rule passed `rulecast validate` and its own good and bad examples.
- **Measurement:** each rule ran with `rulecast test --against corpus`. An agent read up to 15 sampled hits per rule and classified each as real (what the lens describes) or false (fine code, or code the lens's counter-view excuses).
- **Verdicts:**
  - **keep:** 70% or more real in each language.
  - **rewrite:** the tell narrowed to what measured well.
  - **null:** no one-file check got there.

152 rules were written. Per-rule numbers are in `packages/lenses/tells-tested.yaml`, and the rules are in `packages/lenses/tell-rules/`.

## Result

| Verdict | Tells |
|---|---|
| **keep (4)** | `test-logic-in-production` (Python 5/5), `dead-code` (2/2), `hard-coded-secrets` and `user-enumeration`. The last two had no hits outside tests, so they don't misfire but their precision is unmeasured. |
| **rewrite (14)** | `long-parameter-list` (Python 12/12 once only required positional parameters count; TypeScript 13/15, Go 14/15), `conditional-test-logic` (Python 14/15, if-guarded assertions only), `global-state` (TypeScript 13/14), `copy-and-paste-programming` (Go 13/15), `long-method` (Python 12/14), `init-time-side-effects` (Python 6/6), `switch-statements`, `large-class`, `duplicate-code`, `primitive-obsession`, `swallowed-errors`, `mass-assignment`, `sensitive-data-in-logs`, `lava-flow` |
| **null (12)** | `injection` (0/18: one file can't show whether a value came from the user), `comments` (a pattern can't tell "what" from "why"), `middle-man` (0/15: every hit a deliberate facade or decorator), `speculative-generality` (the test fake that justifies an interface is in another file), `mock-everything` (1/4), `assertion-free-test` (6/29), `wrong-abstraction` (4/41), `generic-repository` (0/15), `broken-object-level-authorization` (0/15: the scoping lived in a base class), `poltergeist` and `business-logic-in-helpers` (no hits), `n-plus-one-queries` (the corpus has no raw SQL) |

## What it shows

- **A tell rarely holds across languages.** The same shape is a smell in one language and the idiom in another:
  - an if-guarded assertion is type narrowing in TypeScript and the table-test branch in Go;
  - a long function is a state machine in Rust;
  - a comparison against a literal is a literal-union type in TypeScript.

  Most surviving tells are limited to one or two languages.
- **The lenses agents most need help with are the ones a single file can't show.** Injection, broken authorisation, mock-everything, speculative generality and middle man all need either the caller, the base class or the test in another file. They belong to the touch rules and the interview, or to checks that see more than one file, not to one-file tells.
- **Precision is cheap to measure, and worth it.** Several tells went from below 50% to 90% real with one narrowing that only the measurement suggested. An example is counting required positional parameters, not all parameters.
- **The evidence is thin in places.** Several samples are small or come from one repository, and two keeps rest on zero hits. More corpus code, especially raw SQL and real secrets, would sharpen those verdicts.

## Two rulecast defects found along the way

1. **A regex that backtracks catastrophically reports "0 violations" and exits 0.** Reproduced: the pattern `"(a+)+"` on one file of 40 `a`s followed by `!` spent 60 seconds of CPU, then printed `0 violations in 0 of 1 matching files`. A rule that never finished is reported exactly like a clean one. In the corpus run, a BOLA rule showed 0 hits over two minutes; once the regex was fixed, it found 38 in two seconds. `test --against` should report the rule that ran out of time, and the hook path should treat it as a rule error.
2. **`rulecast test --against` lists only the top 10 files,** so measuring precision needed a separate script to see every hit. An option to print all hits, or to sample them, would make this a rulecast workflow.

## Rerun with structural detectors, 2026-10-14

In the first run, 83 of the 91 rules were regex, because the brief allowed only regex, path and ast-grep. Most tells are structural (what's inside an `except`, a call inside a log statement, how long a function is), and a regex can't tell code from strings or comments. The 18 tells kept or rewritten were measured again on the same corpus, with each rule's detector chosen in the order: an existing lint rule (`linter`), an established tool (`command`), `ast-grep`, and regex only for textual tells or as a marked fallback for Go, Rust, Java and C#, where no tool was installed.

| Tell | First run (real/sampled) | Rerun | Detectors | Verdict |
|---|---|---|---|---|
| `lava-flow` | 10/19 | 13/13 | ast-grep, regex | keep |
| `copy-and-paste-programming` | 37/53 | 34/37 | regex | keep |
| `global-state` | 23/34 | 15/15 | ast-grep | keep |
| `hard-coded-secrets` | 0/0 | 1/1 (gitleaks) | linter (gitleaks) | keep |
| `mass-assignment` | 0/3 | 0/0 | linter, ast-grep | keep, unmeasured |
| `sensitive-data-in-logs` | 3/3 | 3/3 | ast-grep, regex | rewrite |
| `user-enumeration` | 0/0 | 0/0 | ast-grep, regex | keep, unmeasured |
| `swallowed-errors` | 5/28 | 2/2 | linter | keep |
| `init-time-side-effects` | 7/7 | 7/7 | regex, ast-grep | keep |
| `conditional-test-logic` | 16/33 | 14/15 | ast-grep | keep |
| `test-logic-in-production` | 5/5 | 5/5 | ast-grep, regex | keep |
| `dead-code` | 2/2 | 0/0 | ast-grep, linter, regex | keep, unmeasured |
| `duplicate-code` | 23/53 | 6/7 | regex | keep |
| `large-class` | 16/23 | 5/5 | ast-grep, regex | keep |
| `long-method` | 37/56 | 11/15 | ast-grep | keep |
| `long-parameter-list` | 44/49 | 37/43 | ast-grep, regex | rewrite |
| `primitive-obsession` | 7/19 | 4/4 | ast-grep, regex | keep |
| `switch-statements` | 16/24 | 8/9 | ast-grep, regex | keep |

- **Precision rose, but not only because of the detectors.** The rerun followed the tell texts as narrowed after the first run (Python only for `swallowed-errors`, required positional parameters for `long-parameter-list`), so the two columns don't measure the same check. Several samples are small; `dead-code`, `mass-assignment` and `user-enumeration` never fired.
- **An existing lint rule is not automatically the tell.** ruff `ERA001` gave 16 real of 40 for commented-out code (it flags single lines and "uncomment to enable" templates), and ruff `S105`/`S106` gave 0 real of 6 for hard-coded secrets (`token_type = "bearer"`). Both were tried first, recorded, and replaced by ast-grep rules that follow the tell. ruff `S110` (swallowed errors) and `DJ007` (Django forms with `fields = "__all__"`) were kept.
- **Secrets belong to a secrets scanner.** gitleaks was added to rulecast's `linter` detector for `hard-coded-secrets`: outside test fixtures it found one hit, a committed ASP.NET Core data-protection key under `src/`, and it was real. With fixtures it found 26 (scraped HTML, fake tokens in auth tests, deliberately committed test certificates). The corpus measures its false positives, not its recall.
- **An ast-grep gotcha:** a rule that looks for a later sibling (`precedes`, `follows`) can match the file's root node, so it fires on files with no repeat at all. Rules that use these relations need `not: { kind: module }` (Python) or the equivalent.

## A third rulecast defect, fixed

3. **A `linter` rule only reported what the project's config already enabled.** rulecast ran ruff, oxlint and eslint with the project's own selection and filtered by the rule ids, so a rule asking for ruff `S110` found nothing in a project that didn't select it, which is most projects. Fixed on 2026-10-14: the detector now turns on the rules it names (ruff `--extend-select`, oxlint `-D`, eslint `--rule`); inline suppressions, ruff's `per-file-ignores` and oxlint's `overrides` still apply.
