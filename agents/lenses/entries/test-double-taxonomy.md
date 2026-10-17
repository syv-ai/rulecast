<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Test Double taxonomy (dummy, stub, spy, mock, fake)

`test-double-taxonomy` · design patterns, testing

A test double is any stand-in for a real collaborator in a test, and it comes in five kinds that do different jobs. A dummy only fills a parameter. A stub hands back canned answers. A spy records how it was called. A mock checks the calls it gets against expectations. A fake is a working but simplified version, such as an in-memory store.

*Names:* Named by Gerard Meszaros in xUnit Test Patterns (2007), with Test Double as the umbrella term (after a stunt double). Fowler's bliki entry TestDouble and his article Mocks Aren't Stubs spread the vocabulary. In everyday speech, and in most libraries, "mock" is used for all five.

*Matters most for:* web-api, fullstack-web, distributed, event-driven

## But

Using doubles at real boundaries is good practice: the network, the clock, other services, payment providers and anything slow or with side effects should be doubled in unit tests. The taxonomy is a tool for choosing the weakest double that does the job (dummy, then stub, then fake or spy, then mock), not an argument against doubles. The classical (Detroit) school, Beck's and Fowler's, prefers real objects and doubles only the awkward; the London (mockist) school of Freeman and Pryce mocks roles on purpose to drive interface design. Both are defensible. Libraries blur the lines: a Mockito or unittest.mock object is a stub, spy and mock at once depending on how it's used, so the names describe roles in a test rather than classes.

## Quality axes

- **change_cost** ⊕ (primary): Picking the weakest double that does the job keeps tests from pinning call order and arguments that don't matter, so refactors break fewer tests.

**Flips:** Doubling cheap, deterministic collaborators (mock everything) pins the implementation and turns change_cost "-"; policing the vocabulary in review when a test is already clear costs time for nothing.

## Warranted when

- The code under test talks to something slow, nondeterministic or with side effects (network, clock, randomness, email, payments).
- A team argues about "too many mocks" without words to say which doubles are the problem.
- Tests need to show an interaction happened (a message sent, an event published) where no return value or state shows it.
- A collaborator is needed only to satisfy a signature.

## How it shows

- Every stand-in in a test suite called a mock, whatever it does, so reviewers can't tell a canned answer from a checked expectation.
- Tests that set up a return value on a double and also verify the double was called, mixing stub and mock roles on one object.
- Hand-written in-memory classes (InMemoryRepo, FakeClock) next to library-made mocks, with no shared naming for when to use which.
- Doubles concentrated at the boundaries of the code (HTTP client, clock, queue, payment provider).

## Overdone when

- Doubling collaborators that are cheap and deterministic, such as value objects, plain data and pure functions, which is mock-everything.
- Reaching for mocks (expectation checking) where a stub would do, so tests pin call order and arguments that don't matter.
- Policing the vocabulary in review when the test is already clear.

## Example

Before:

```
test "reset sends a link":
    clock = Mock()
    clock.now.returns(t0)
    mailer = Mock()
    audit = Mock()
    service = PasswordReset(clock, mailer, audit)
    service.request("ana@example.com")
    verify(clock.now).called_once()
    verify(mailer.send).called_once()
    verify(audit.record).called_once()
```

After:

```
test "reset sends a link":
    clock = StubClock(now=t0)           # stub: canned answer, never verified
    mailer = SpyMailer()                # spy: records what was sent
    audit = StubAudit()                 # stub: accepts record() and does nothing
    service = PasswordReset(clock, mailer, audit)
    service.request("ana@example.com")
    assert mailer.sent[0].to == "ana@example.com"
    assert mailer.sent[0].link_expires == t0 + 1h
```

Each double does one job, the clock is no longer verified for being asked the time, and the test checks the email that went out rather than that a method ran.

## By language

**python:** unittest.mock's Mock and MagicMock serve as stub, spy or mock depending on use; create_autospec or spec= keeps the double's surface matched to the real class. pytest's monkeypatch and pytest-mock patch at module level. Fakes are usually small hand-written classes.

**typescript:** jest.fn and vi.fn create spies that can also stub; sinon separates stubs, spies and mocks explicitly. For HTTP boundaries, msw intercepts requests rather than mocking the client. Structural typing makes a hand-written object literal an easy fake or stub.

**java:** Mockito is the default, and its mocks verify after the fact, so in Meszaros's terms they are mostly stubs and spies. WireMock doubles HTTP services, and Testcontainers replaces fakes with real databases or brokers in containers.

**csharp:** Moq, NSubstitute and FakeItEasy are the common libraries; NSubstitute and FakeItEasy lean towards stub-and-spy usage. EF Core's in-memory provider is a fake that Microsoft itself discourages for testing query behaviour; SQLite in-memory or Testcontainers are the usual alternatives.

**go:** Idiomatic Go favours hand-written fakes and stubs against small consumer-defined interfaces; httptest gives a real server for HTTP boundaries. gomock (now maintained as go.uber.org/mock) and testify/mock exist but are used less than in Java or C#.

**rust:** Doubles need a trait seam, or generics, at the boundary. mockall generates mocks from traits; many projects hand-write fakes instead. wiremock and httpmock double HTTP services.

## Related

[Mocking Everything (over-mocking)](mock-everything.md) · [Prefer Fakes over Mocks](fake-over-mock.md) · [Fragile Test](fragile-test.md) · [Hard-to-Test Code](hard-to-test-code.md) · [Contract Test](contract-test.md)

## Overlaps

test-double-taxonomy gives the words. mock-everything is the failure (mocking until nothing real is tested), and fake-over-mock the contested preference for in-memory fakes of owned stateful collaborators.

## Sources

- [Gerard Meszaros, xUnit Test Patterns (2007), Test Double and its variations](http://xunitpatterns.com/Test%20Double.html) (recalled)
- [Martin Fowler, bliki, TestDouble](https://martinfowler.com/bliki/TestDouble.html) (read)
- [Martin Fowler, Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) (recalled)
- [Steve Freeman and Nat Pryce, Growing Object-Oriented Software, Guided by Tests (2009)](http://www.growing-object-oriented-software.com/) (recalled)
