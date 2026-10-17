<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Prefer Fakes over Mocks

`fake-over-mock` · practices, testing · **contested**

For a stateful collaborator you own, such as a repository, cache or queue, write one small in-memory fake that behaves like the real thing and use it across tests, instead of configuring a mock with expected calls in each test. Tests then check the resulting state rather than the calls made.

*Names:* The ordering of real implementation first, then fake, then stub or mock comes from Google's testing practice, written up in Software Engineering at Google (Winters, Manshreck and Wright, 2020), ch. 13. The terms fake and mock are Meszaros's. The order real implementation, then fake, then mock is set out by Andrew Trenk and Dillon Bly in Software Engineering at Google, ch. 13.

*Matters most for:* web-api, fullstack-web, databases-storage, event-driven

## But

The London (mockist) school holds that interaction tests with mocks are a design tool: they make you define roles and protocols between objects, and a fake hides that conversation. Freeman and Pryce would mock the role and test the real implementation's contract separately. A fake is code that has to be maintained and can drift; it is only trustworthy when it passes the same contract suite as the real implementation, ideally maintained by whoever owns the real one, as Google recommends. Where the interaction is the behaviour (an email sent, an event published, a charge made) a spy or mock states it more directly than inspecting a fake. And for a database, a real instance in a container often beats both.

## Quality axes

- **change_cost** ⊕ (primary): Tests check resulting state rather than call order, so they don't all break when the collaborator's interface or the call sequence changes.
- **delivery** −: The fake is real code that has to be written, maintained and ideally run through the same contract suite as the real implementation.

**Flips:** A fake of a third-party service you don't understand encodes guesses, and one never checked against the real thing drifts, so reliability turns "-". Where the interaction is the behaviour (an email sent), a spy says it more directly.

## Warranted when

- A collaborator with state that several calls depend on, so mocks have to script a sequence of answers.
- Many tests mocking the same interface in slightly different ways, which all break when it changes.
- Tests that pin call order and arguments the behaviour doesn't care about (Fragile Test).
- The real thing (a database, a broker) is too slow or awkward for unit tests.

## How it shows

- In-memory implementations of repository or gateway interfaces in a test-support package.
- Tests that call the code, then read back from the fake to assert what was stored.
- The fake run through the same contract suite as the production implementation.
- Before adopting it, every test stubs repo.get and verifies repo.save with slightly different setups.

## Overdone when

- Fakes for third-party services whose real behaviour you don't know well, so the fake encodes guesses.
- Fakes that grow into a second implementation with their own bugs, never checked against the real one.
- A fake where a one-line stub would do because the test needs a single canned answer.
- Fakes of things cheap enough to use for real, such as SQLite or a container started once per run.

## Example

Before:

```
test "booking takes a seat":
    seats = Mock()
    seats.find(show, "A7").returns(Seat("A7", free=true))
    service = Booking(seats)
    service.book(show, "A7", guest)
    verify(seats.save).called_with(Seat("A7", free=false, guest=guest))

test "can't double-book":
    seats.find(show, "A7").returns(Seat("A7", free=false))
    ...
```

After:

```
class InMemorySeats implements Seats:
    rows: Map
    fn find(show, id): return rows[(show, id)]
    fn save(seat): rows[(seat.show, seat.id)] = seat

test "can't double-book":
    seats = InMemorySeats(with_free_seat(show, "A7"))
    service = Booking(seats)
    service.book(show, "A7", guest)
    assert raises(SeatTaken, service.book, show, "A7", other_guest)
    assert seats.find(show, "A7").guest == guest
```

The fake keeps state between calls, so the test books twice and checks what is stored instead of scripting each answer and verifying calls.

## By language

**python:** A small class with a dict inside, implementing the same Protocol as the real repository; Protocols keep the fake honest under a type checker. For SQL, an in-memory SQLite database may differ from production Postgres in ways that matter.

**typescript:** A class or object literal implementing the repository interface over a Map. Structural typing means the fake checks against the interface without inheriting anything.

**java:** Hand-written in-memory implementations of the repository interface; for Spring Data, Testcontainers with the real database is the common alternative to faking JPA behaviour.

**csharp:** In-memory implementations of the repository interface. Microsoft advises against the EF Core in-memory provider as a fake for the database, because it doesn't behave like a relational one.

**go:** Fakes are the idiomatic default: a struct with a map and a mutex implementing a small interface, often exported from a package's own testing helpers.

**rust:** A struct holding a HashMap (behind a RefCell or Mutex as needed) implementing the trait; usually preferred to mockall for stateful collaborators.

## Related

[Mocking Everything (over-mocking)](mock-everything.md) · [Test Double taxonomy (dummy, stub, spy, mock, fake)](test-double-taxonomy.md) · [Contract Test](contract-test.md) · [Fragile Test](fragile-test.md)

## Overlaps

test-double-taxonomy gives the words. mock-everything is the failure (mocking until nothing real is tested), and fake-over-mock the contested preference for in-memory fakes of owned stateful collaborators.

## In the interview

- [Ask which tests break when nothing they cover changed.](../THINKING.md#tests-by-what-they-cost)

## Sources

- [Titus Winters, Tom Manshreck and Hyrum Wright, Software Engineering at Google (2020), ch. 13 Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html) (recalled)
- [Martin Fowler, Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) (recalled)
- [Steve Freeman and Nat Pryce, Growing Object-Oriented Software, Guided by Tests (2009)](http://www.growing-object-oriented-software.com/) (recalled)
- [Martin Fowler, bliki, TestDouble](https://martinfowler.com/bliki/TestDouble.html) (read)
- [Andrew Trenk and Dillon Bly, Test Doubles, ch. 13 of Software Engineering at Google (2020)](https://abseil.io/resources/swe-book/html/ch13.html) (read)
