<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# How to think about a project in the interview

General stances for any kind of project. Each one carries named laws forward as something to do or ask, not a fact to recite. Kind-specific probes are in `kinds/<kind>.md`.

## About the project

### ownership-before-boundaries

Before proposing conventions about modules, layers or services, ask who owns which parts and who must agree to a change. Boundaries tend to follow the people who build them. A boundary that cuts across teams, or teams split by technical layer, shows up as changes that need several owners to coordinate.

**Ask:** Who owns which parts of this, and does a typical feature need more than one of them to sign off?

**But:** A solo developer or one small team has a single communication path, so this says little about their code. Layers inside one codebase owned by one team are fine; the problem is layers as team boundaries. A platform team serving many product teams is a horizontal split that often works well.

*Grounded in:* Conway's law, Horizontalism

*Bears on:* [Bounded Context](entries/bounded-context.md), [Context Map](entries/context-map.md), [Drifting terminology](entries/drifting-terminology.md), [Under-Modularization](entries/under-modularization.md), [Distributed Monolith](entries/distributed-monolith.md), [Shotgun Surgery](entries/shotgun-surgery.md), [Layered Architecture](entries/layered-architecture.md)

*Sources:* [Melvin E. Conway, How Do Committees Invent?, Datamation, April 1968](https://www.melconway.com/Home/Committees_Paper.html); [Milanović, Laws of Software Engineering, Conway's Law](https://lawsofsoftwareengineering.com/laws/conways-law/); [INNOQ, Architecture Antipatterns, Horizontalism](https://architecture-antipatterns.tech/patterns/horizontalism.html)

### find-where-changes-concentrate

Spend the interview where the work is. Look at the history for the few modules that change most and break most, and for the files almost every change has to touch (a central registry, a shared types file, one big routes file). Conventions pay off there. Files everyone must edit at once also hold up parallel work, by people or by several agents running side by side. Adding more people or agents won't speed up work that all has to pass through those files; it adds coordination instead.

**Ask:** Which files does nearly every change touch, and which modules do most of your bugs come from?

**But:** Churn alone doesn't make code bad: a config table or a changelog changes constantly by design, and a single registry can be the clearest place to look things up. On a young or solo project the history is too short to say much.

*Grounded in:* Pareto principle, Brooks's law

*Bears on:* [Pareto Principle](entries/pareto-principle.md), [Amdahl's Law](entries/amdahls-law.md), [Shotgun Surgery](entries/shotgun-surgery.md), [Divergent Change](entries/divergent-change.md), [God object (The Blob)](entries/god-object.md)

*Sources:* Joseph M. Juran, who named the Pareto principle in quality management, after Vilfredo Pareto; Frederick P. Brooks Jr., The Mythical Man-Month (1975); [Milanović, Laws of Software Engineering, Brooks's Law](https://lawsofsoftwareengineering.com/laws/brooks-law/)

### start-from-failure

Ask what would hurt most if it went wrong, and work back to the conventions that stop it. The worst failure a project can have (a data leak, a corrupted file, a bricked device, a wrong published number) ranks the conventions better than a list of good practices does.

**Ask:** What's the worst thing this code could do to a user, and what stops it today?

**But:** Listing failures can turn into defensive overbuilding. Keep to the failures the developer says are real for this project, and pair this with what the project is for, since avoiding failure isn't the same as reaching the goal.

*Grounded in:* Inversion

*Bears on:* [Murphy's Law](entries/murphys-law.md), [Fail Open vs Fail Closed](entries/fail-open-vs-fail-closed.md), [Fail Fast](entries/fail-fast.md), [Defense in depth](entries/defense-in-depth.md)

*Sources:* [Milanović, Laws of Software Engineering, Inversion](https://lawsofsoftwareengineering.com/laws/inversion/); Charlie Munger, who popularised Carl Jacobi's "invert, always invert" as a habit of thought; [Gary Klein, Performing a Project Premortem, Harvard Business Review, September 2007](https://hbr.org/2007/09/performing-a-project-premortem)

### reasons-not-precedent

For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project. A choice whose only justification is that a well-known project uses it is a candidate for a stated exception or a rethink, not a convention to spread further.

**Ask:** What did splitting this into services (or adding this event bus, this mediator layer) solve for you that the simpler setup didn't?

**But:** Copying a proven, boring default you understand is usually better than inventing one, and exemplar code is meant to be copied. If the developer adopted it knowingly and it fits, the precedent is a fine reason. Don't make them defend every library.

*Grounded in:* Blind Pattern Following, First principles thinking

*Bears on:* [Dogma over pragma](entries/dogma-over-pragma.md), [Cargo cult programming](entries/cargo-cult-programming.md), [Golden hammer](entries/golden-hammer.md), [Over-Modularization](entries/over-modularization.md), [Distributed Monolith](entries/distributed-monolith.md), [Over-Engineering](entries/over-engineering.md)

*Sources:* [INNOQ, Architecture Antipatterns, Blind Pattern Following](https://architecture-antipatterns.tech/patterns/cargo_culting.html); [Milanović, Laws of Software Engineering, First Principles Thinking](https://lawsofsoftwareengineering.com/laws/first-principles-thinking/)

### kept-for-what-it-does

When the project keeps a home-grown framework, an in-house replacement for a standard tool, or an old component everyone works around, ask whether it stays because it still does the job best or because of what it cost and who built it. The answer decides whether conventions protect it or steer new code away from it.

**Ask:** If you were starting today, would you build this yourself again, or use what's out there?

**But:** Past investment often stands for real knowledge and working code, so switching isn't free. Building in-house can be right for what makes the product different, and for a library a small copy can beat a new dependency. Re-evaluating isn't a verdict on whoever built it; say so.

*Grounded in:* Sunk cost fallacy, Emotional Attachment, Not Invented Here

*Bears on:* [Second-System Effect](entries/second-system-effect.md), [Boat anchor](entries/boat-anchor.md), [Reinventing the wheel](entries/reinventing-the-wheel.md), [Inner-Platform Effect](entries/inner-platform-effect.md), [Lindy Effect](entries/lindy-effect.md)

*Sources:* [Milanović, Laws of Software Engineering, Sunk Cost Fallacy](https://lawsofsoftwareengineering.com/laws/sunk-cost-fallacy/); [INNOQ, Architecture Antipatterns, Emotional Attachment](https://architecture-antipatterns.tech/patterns/emotional_misattachment.html); Ralph Katz and Thomas J. Allen, Investigating the Not Invented Here (NIH) syndrome, R&D Management 12(1), 1982; [Joel Spolsky, In Defense of Not-Invented-Here Syndrome (2001)](https://www.joelonsoftware.com/2001/10/14/in-defense-of-not-invented-here-syndrome/)

### frozen-code-gets-its-own-rule

Find the parts nobody touches and the parts only one person understands, and ask which is which. Frozen, feared code needs different conventions from the rest: characterisation tests before any change, small changes shipped often, no drive-by refactoring, and no new wrappers around it. Code only one person knows is where written conventions do the most good.

**Ask:** Which parts does nobody touch, and is that because they're finished or because they're scary?

**But:** Some code is genuinely done, certified or tied to hardware, and leaving it alone is the right call. On a solo project a bus factor of one is just the situation; the useful question is what's written down, not who else knows it.

*Grounded in:* Never Change a Running System, Bus factor

*Bears on:* [Strangler Fig](entries/strangler-fig.md), [Golden Master Test (approval, snapshot or golden-file test)](entries/golden-master-test.md), [Lava flow](entries/lava-flow.md), [Technical Debt](entries/technical-debt.md), [The Boy Scout Rule](entries/boy-scout-rule.md)

*Sources:* [INNOQ, Architecture Antipatterns, Never change a running system](https://architecture-antipatterns.tech/patterns/never_change_a_running_system.html); [Milanović, Laws of Software Engineering, Bus Factor](https://lawsofsoftwareengineering.com/laws/bus-factor/)

### numbers-are-signals

When a convention would be enforced through a number (coverage, complexity, line or file length, a lint count), ask what the number stands for and how code could meet it without meeting the goal. An agent working in a loop will satisfy the letter of a rule, so name the cheap way to pass it before it becomes one.

**Ask:** If a coverage floor is the rule, what would stop tests that run the code without checking anything?

**But:** A rough number is still better than none for something that matters, and some targets are hard to game and close to the goal, such as a latency budget measured in a test. Don't let the risk of gaming become a reason to measure nothing.

*Grounded in:* Goodhart's law, Gilb's law, Cobra effect

*Bears on:* [Dogma over pragma](entries/dogma-over-pragma.md), [Assertion-Free Test](entries/assertion-free-test.md), [Testing Pyramid](entries/testing-pyramid.md)

*Sources:* Charles Goodhart, Problems of Monetary Management, the U.K. Experience (1975); Marilyn Strathern, Improving ratings: audit in the British University system, European Review 5(3), 1997 (source of the common wording); Tom DeMarco and Timothy Lister, Peopleware (1987), the section "Gilb's Law", which names Tom Gilb's measurement principle; [Milanović, Laws of Software Engineering, Gilb's Law](https://lawsofsoftwareengineering.com/laws/gilbs-law/); [Milanović, Laws of Software Engineering, Goodhart's Law](https://lawsofsoftwareengineering.com/laws/goodharts-law/); Horst Siebert, Der Kobra-Effekt (2001)

### tests-by-what-escaped

Ask about the bugs that got past the tests, not about coverage. Where recent bugs escaped, and whether tests fail when the code is broken, decides which test conventions matter. If the team writes few tests, find out why (no time, code that is hard to test, a painful setup) before proposing a rule.

**Ask:** When a bug last reached users, was there a test that should have caught it, and why didn't it?

**But:** No suite catches everything; some bugs only show under real load, data or users, and that's what monitoring and staged rollouts are for. Prototypes, spikes and one-off scripts often don't earn tests at all.

*Grounded in:* Production Bugs, Buggy Tests, Developers Not Writing Tests

*Bears on:* [Assertion-Free Test](entries/assertion-free-test.md), [Obscure Test](entries/obscure-test.md), [Conditional Test Logic](entries/conditional-test-logic.md), [Frequent Debugging](entries/frequent-debugging.md), [Manual Intervention](entries/manual-intervention.md), [Slow Tests](entries/slow-tests.md), [Erratic Test](entries/erratic-test.md), [Hard-to-Test Code](entries/hard-to-test-code.md)

*Sources:* [Meszaros, xUnit Test Patterns, Production Bugs](http://xunitpatterns.com/Production%20Bugs.html); [Meszaros, xUnit Test Patterns, Buggy Tests](http://xunitpatterns.com/Buggy%20Tests.html); [Meszaros, xUnit Test Patterns, Developers Not Writing Tests](http://xunitpatterns.com/Developers%20Not%20Writing%20Tests.html)

### tests-by-what-they-cost

Ask which tests break when nothing they cover changed. A suite that needs fixing after every small change points to over-mocking, tests tied to implementation detail, and copied setup, and the conventions worth proposing are the ones that cut that cost.

**Ask:** Which tests do you end up fixing when you change something they shouldn't care about?

**But:** Some test churn is the honest cost of changing behaviour, and a suite that never needs touching may not check much. Weigh the upkeep against the bugs the tests catch before proposing to loosen or delete them.

*Grounded in:* High Test Maintenance Cost

*Bears on:* [Prefer Fakes over Mocks](entries/fake-over-mock.md), [Mocking Everything (over-mocking)](entries/mock-everything.md), [Fragile Test](entries/fragile-test.md), [Obscure Test](entries/obscure-test.md), [Test Code Duplication](entries/test-code-duplication.md), [Test Data Builder](entries/test-data-builder.md)

*Sources:* [Meszaros, xUnit Test Patterns, High Test Maintenance Cost](http://xunitpatterns.com/High%20Test%20Maintenance%20Cost.html)

## Running the interview

### find-first

Never ask the developer what the repository can tell you. Look first, in the code, docs, git history, CI and config, then ask only what it can't: what they intend, which way things should go, which inconsistencies are deliberate exceptions, and what counts as a promise. Arrive with the evidence and a recommendation, so the developer corrects a finding instead of recalling a fact. Where the findings already answer the question, say what you found in one line and ask only whether it should hold going forward.

**Ask:** <N> routes check auth in middleware and <M> in the handler. Is that split deliberate? I'd do it in middleware for new routes so no handler can forget.

**But:** The code shows what the project does, not what it wants. Mid-migration, inherited or rushed code is a poor guide to intent, so a consistent pattern there is still a question, not an answer. Some things never show up in a repo: bugs users hit, who owns what outside it, consumers you can't see. Ask those plainly, with whatever evidence there is. And don't spend an hour of exploring to save the developer a ten-second answer.

*Grounded in:* The map is not the territory, Cunningham's law

*Sources:* Developer decision: probes find in the repository first and ask only what it can't tell, 2026-10-14; [Milanović, Laws of Software Engineering, The Map Is Not the Territory](https://lawsofsoftwareengineering.com/laws/map-is-not-the-territory/); [Milanović, Laws of Software Engineering, Cunningham's Law](https://lawsofsoftwareengineering.com/laws/cunninghams-law/)

### propose-a-draft

Put a concrete draft convention in front of the developer, with your recommendation and the evidence from the code, rather than asking how they'd like something done. People correct a specific proposal faster and more precisely than they answer an open question.

**But:** A confident draft anchors the conversation. Where the evidence is thin or the call is contested, say it's a strawman and lay out the alternatives side by side instead of leading with one. Never present a guess as something you found in the code.

*Grounded in:* Cunningham's law

*Sources:* [Milanović, Laws of Software Engineering, Cunningham's Law](https://lawsofsoftwareengineering.com/laws/cunninghams-law/); Steven McGeady, reader comment on Schott's Vocab, The New York Times, May 2010, which named the law after Ward Cunningham; Cunningham has called it a misquote and says he never advised posting wrong answers

### check-the-draft-against-the-code

Before proposing a convention, count where the code already breaks it and what an enforced rule would flag on day one. Where the docs, a diagram or a decision record say one thing and the code another, show both and ask which is wrong. You'll tend to notice the files that confirm the rule you already have in mind, so look for the ones that don't.

**Ask:** The design notes say handlers never touch the database directly, but I found a dozen that do. Is the note out of date, or are those the bugs?

**But:** Not every gap is drift. A precise, checked model (types, schemas, a generated client) is close to the truth, and a handful of counterexamples can be deliberate exceptions worth writing down rather than a sign the rule is wrong. Don't check every low-stakes draft this hard.

*Grounded in:* Confirmation bias, The map is not the territory

*Bears on:* [Law of Unintended Consequences](entries/law-of-unintended-consequences.md), [Lehman's Laws of Software Evolution](entries/lehmans-laws.md), [Drifting terminology](entries/drifting-terminology.md)

*Sources:* [Milanović, Laws of Software Engineering, Confirmation Bias](https://lawsofsoftwareengineering.com/laws/confirmation-bias/); [Raymond S. Nickerson, Confirmation Bias, a Ubiquitous Phenomenon in Many Guises, Review of General Psychology 2(2), 1998](https://doi.org/10.1037/1089-2680.2.2.175); [Milanović, Laws of Software Engineering, The Map Is Not the Territory](https://lawsofsoftwareengineering.com/laws/map-is-not-the-territory/); Alfred Korzybski, Science and Sanity (1933)

### ask-the-history-first

When something looks odd or inconsistent, ask why it is that way before calling it a violation. Odd code usually has a reason: an old constraint, an incident, a workaround for a dependency. The answer decides whether the convention protects it, records it as an exception, or removes it.

**Ask:** These two modules handle retries differently. Is there a story behind that, or did they just drift apart?

**But:** Sometimes there is no reason and nobody remembers. Once the developer says so, stop digging and propose the convention. In security-sensitive code, an inconsistency can also be a real hole, so flag it as one rather than assuming it was meant.

*Grounded in:* Chesterton's fence

*Bears on:* [Lava flow](entries/lava-flow.md), [Dogma over pragma](entries/dogma-over-pragma.md)

*Sources:* G. K. Chesterton, The Thing (1929), the chapter "The Drift from Domesticity"
