<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Patching where defined, not where looked up

`patch-where-looked-up` · anti-patterns, testing · **agents do this**

A test patches or mocks a name in the module that defines it, but the code under test looks the name up somewhere else (its own import, a captured reference), so the patch never takes effect and the real code runs.

*Names:* The rule "patch where an object is looked up, not where it is defined" is from Python's unittest.mock documentation, section "Where to patch". Practitioners often just say "patching the wrong target". The same failure appears in other languages as a module mock that doesn't match how the code imports, or a mock object that the code under test never receives.

*Matters most for:* web-api, cli-devtool, data-pipeline, fullstack-web

## But

Patching the defining module is correct when the code under test looks the name up through it at call time ("import a" then "a.thing()"), and for attributes on objects or classes that every caller reaches through the same object. Some argue patching should be rare anyway (Freeman and Pryce's "only mock types you own"; the classical school's preference for real objects and fakes), which makes the rule moot. For integration tests that should hit the real thing, the absence of a patch is the point.

## Quality axes

- **reliability** −: The case the mock was meant to simulate is never exercised while the real dependency runs, so bugs on that path ship behind a passing test.
- **change_cost** −: Tests silently depend on import style and real services, so they turn flaky or start making real calls when unrelated imports change.

## Why people fall into it

- The defining module is the obvious place to point a patch at, and it works for code that uses "import module" style.
- Import style differs between files, so a patch that works in one test silently fails in another.
- A wrong-target patch fails quietly; nothing errors, and the test passes if it asserts on nothing the mock would change.
- Coding agents copy patch targets from the import line of the defining module rather than the module under test.

## How it shows

- In Python, patch("pkg.mailer.send") while the module under test did "from pkg.mailer import send", so it holds its own reference.
- A patch that is set up but never asserted on, and tests that still work only because some other patch (a fake host, a missing credential) makes the real call fail harmlessly.
- Tests that pass alone but make real network calls, write real files or send real email.
- References captured at import time (default arguments, handler tables, decorators registering a function) that a later patch can't reach.
- Mock objects created in a test while the class under test builds its own dependency with new.

## Overcorrecting looks like

- Rewriting every import to "import module" style only so tests can patch the defining module.
- Patching the same name in every module that could reach it, to be safe, which hides which one matters.
- Leaning harder on patching instead of giving the code a seam where the dependency is passed in.

## What to do

Patch the name in the module under test (the place the lookup happens), and assert on the mock so a wrong target fails loudly; autospec catches signature drift too. Better still, pass the dependency in (a parameter, a constructor argument, a FastAPI dependency override) so no patch is needed.

## Example

Before:

```
# reminders.py
from sms import send_text
fn remind_overdue(invoices):
    for inv in invoices:
        if inv.overdue: send_text(inv.phone, "Invoice overdue")

# test_reminders.py
with patch("sms.send_text") as fake:     # patches sms, but reminders kept its own reference
    remind_overdue([overdue_invoice])     # the real send_text runs
```

After:

```
# test_reminders.py
with patch("reminders.send_text") as fake:  # where reminders looks it up
    remind_overdue([overdue_invoice])
fake.assert_called_once_with(overdue_invoice.phone, "Invoice overdue")

# or give it a seam and skip patching
fn remind_overdue(invoices, send=send_text): ...
remind_overdue([overdue_invoice], send=fake_sender)
```

The patch now replaces the name the code actually calls, and the assertion would fail if it ever didn't.

## By language

**python:** The canonical case. With "from a import X" in module b, patch b.X; with "import a" and a.X used at call time, patch a.X. patch.object on the module the code under test imports is a clear way to say which. Captured references (default args, dicts of callbacks built at import) need the dependency passed in instead.

**typescript:** jest.mock and vi.mock replace a whole module in the registry by its specifier, which is hoisted, so they reach every importer. The trap is spyOn on an exported function: calls from inside the same module use the local binding and aren't intercepted, and ES module namespaces often can't be spied on at all.

**java:** Mockito has no patching; a mock works only if it is injected. Creating a mock while the class calls new or a static factory itself is the same failure; mockConstruction and mockStatic exist but are a sign the class needs a seam.

**csharp:** Moq and NSubstitute replace only injected interfaces or virtual members. A static call, a new inside the class, or a non-virtual method can't be intercepted, so the mock is never used.

**go:** Go can't monkey-patch. The common seam is a package-level function variable (var now = time.Now) that tests reassign; it fails the same way when code copies the variable into a struct or closure before the test reassigns it. Interfaces passed in avoid this.

**rust:** No runtime patching. The mockall_double crate's #[double] attribute, used on an import, swaps a type for its mockall mock under cfg(test), which is the "where it's looked up" rule enforced at compile time; otherwise traits passed in are the seam.

## Related

[Mocking Everything (over-mocking)](mock-everything.md) · [Test Double taxonomy (dummy, stub, spy, mock, fake)](test-double-taxonomy.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Global state](global-state.md) · [Init-Time Side Effects](init-time-side-effects.md) · [Dependency Injection](dependency-injection.md) · [Assertion-Free Test](assertion-free-test.md)

## Sources

- [Python documentation, unittest.mock, Where to patch](https://docs.python.org/3/library/unittest.mock.html#where-to-patch) (read)
- [Jest documentation, Manual mocks and jest.mock](https://jestjs.io/docs/manual-mocks) (recalled)
- [mockall documentation, mocking structs and mockall_double](https://docs.rs/mockall/latest/mockall/) (recalled)
- Freeman and Pryce, Growing Object-Oriented Software, Guided by Tests (2009), only mock types you own (recalled)
