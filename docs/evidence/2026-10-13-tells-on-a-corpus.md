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
